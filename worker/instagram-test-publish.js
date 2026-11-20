import {privatePage,inspectInstagram} from './instagram-tools.js';
const BASE='https://rene-social-hub-api-test.renevaservices.workers.dev';
const GRAPH='https://graph.facebook.com/v22.0';
export const CAPTION=`Keeping your business organised doesn’t have to be complicated. 💻

I help with documents, forms, data entry and day-to-day admin, giving you more time to focus on your business.

Send me a message to discuss the support you need.

renevaservices.co.za

#ReneVAServices #VirtualAssistant #AdminSupport #SmallBusinessSupport`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function context(env,id){
 if(!/^[a-f0-9]{64}$/.test(id||''))return null;
 const accounts=await env.DB.prepare('SELECT instagram_account_id,username,encrypted_access_token FROM instagram_connections LIMIT 2').all();
 if(accounts.results.length!==1)return null;
 const asset=await env.DB.prepare('SELECT id,width,height FROM instagram_media_assets WHERE id=? AND expires_at>?').bind(id,Date.now()+600000).first();
 if(!asset||asset.width/asset.height<0.8||asset.width/asset.height>1.91)return null;
 const account=accounts.results[0];
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([account.instagram_account_id,id,CAPTION])));
 const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 return {account,asset,key};
}
const back='<p><a href="/admin/instagram">Return to Instagram preparation</a></p>';
export async function reviewTest(env,id){
 const c=await context(env,id);if(!c)return privatePage('Image needs preparation','<p>Choose an unexpired image with an Instagram feed aspect ratio (4:5 to 1.91:1).</p>'+back,400);
 const job=await env.DB.prepare('SELECT status,media_id FROM instagram_test_posts WHERE id=?').bind(c.key).first();
 let action='<p>This publishes one public Instagram post when you press the button. Automatic Instagram posting stays off.</p><form method="post" action="/admin/instagram/publish-test"><input type="hidden" name="image" value="'+id+'"><button>Publish ONE test post</button></form>';
 if(job?.status==='published')action='<p><strong>This test post was published successfully.</strong> Instagram post ID: '+esc(job.media_id)+'.</p><p>Automatic Instagram posting remains off.</p>';
 else if(job&&job.status!=='container_ready')action='<p>This test is '+esc(job.status)+'. Do not submit another copy. Check your Instagram profile before doing anything further.</p><p>Automatic Instagram posting remains off.</p>';
 else if(job?.status==='container_ready')action='<p>Meta is preparing your image. This button checks preparation and publishes once ready.</p><form method="post" action="/admin/instagram/publish-test"><input type="hidden" name="image" value="'+id+'"><button>Check and publish this test</button></form>';
 return privatePage('Review Instagram test post','<p>Account: <strong>@'+esc(c.account.username)+'</strong></p><img alt="Your prepared post image" src="/instagram-media/'+id+'.jpg"><section style="white-space:pre-wrap">'+esc(CAPTION)+'</section>'+action+back);
}
export async function publishTest(request,env,decrypt,fetchImpl=fetch){
 let form;try{form=await request.formData();}catch{return privatePage('Invalid request',back,400);}
 const id=form.get('image');const c=await context(env,id);if(!c)return privatePage('Image needs preparation',back,400);
 const redirect=()=>new Response(null,{status:303,headers:{Location:'/admin/instagram/review?image='+id,'Cache-Control':'no-store'}});
 const existing=await env.DB.prepare('SELECT status FROM instagram_test_posts WHERE id=?').bind(c.key).first();
 if(existing&&!['container_ready'].includes(existing.status))return redirect();
 const report=await inspectInstagram(env,decrypt,fetchImpl);
 if(!report.permissionCheckPassed)return privatePage('Test was not published','<p>Instagram readiness must pass before publishing. <a href="/admin/instagram/check">Check readiness</a>.</p>'+back,400);
 // Bind the token to the exact account checked above, including during reconnects.
 const current=await env.DB.prepare('SELECT instagram_account_id,username,encrypted_access_token FROM instagram_connections LIMIT 2').all();
 if(current.results.length!==1||current.results[0].instagram_account_id!==c.account.instagram_account_id||current.results[0].encrypted_access_token!==c.account.encrypted_access_token)return privatePage('Connection changed','<p>Review the connected account again.</p>'+back,409);
 const token=await decrypt(c.account.encrypted_access_token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY);
 const api=async(path,method='GET',body)=>{
  const response=await fetchImpl(GRAPH+'/'+path,{method,headers:{Authorization:'Bearer '+token},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok||data.error)throw Error('Meta request failed');return data;
 };
 const save=async(status,container=null,media=null)=>env.DB.prepare('UPDATE instagram_test_posts SET status=?,container_id=COALESCE(?,container_id),media_id=COALESCE(?,media_id),updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,container,media,c.key).run();
 let stage='preparing';
 try{
  if(!existing){
   const claim=await env.DB.prepare('INSERT OR IGNORE INTO instagram_test_posts(id,asset_id,account_id,status) VALUES(?,?,?,?) RETURNING id').bind(c.key,id,c.account.instagram_account_id,'preparing').first();
   if(!claim)return redirect();
   const container=await api(encodeURIComponent(c.account.instagram_account_id)+'/media','POST',{image_url:BASE+'/instagram-media/'+id+'.jpg',caption:CAPTION});
   if(!/^\d+$/.test(String(container.id||'')))throw Error('Missing container');
   await save('container_ready',String(container.id));
  }
  // Atomic claim prevents concurrent button presses from publishing twice.
  const job=await env.DB.prepare("UPDATE instagram_test_posts SET status='checking',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='container_ready' RETURNING container_id").bind(c.key).first();
  if(!job)return redirect();
  const container=await api(encodeURIComponent(job.container_id)+'?fields=status_code');
  if(container.status_code==='IN_PROGRESS'){await save('container_ready');return redirect();}
  if(container.status_code!=='FINISHED')throw Error('Container not ready');
  stage='publishing';await save('publishing');
  const published=await api(encodeURIComponent(c.account.instagram_account_id)+'/media_publish','POST',{creation_id:job.container_id});
  if(!/^\d+$/.test(String(published.id||'')))throw Error('Missing media');
  await save('published',null,String(published.id));
  return redirect();
 }catch{
  // An ambiguous publish result is never retried automatically.
  await save(stage==='publishing'?'review_required':'preparation_failed');
  return privatePage('Check test post status','<p>The request could not be confirmed. Check your Instagram profile before trying anything further. No automatic retry will run.</p>'+back,502);
 }
}
