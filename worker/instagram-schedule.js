import {privatePage,inspectInstagram} from './instagram-tools.js';
const BASE='https://rene-social-hub-api-test.renevaservices.workers.dev';
const GRAPH='https://graph.facebook.com/v22.0';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
const when=ms=>new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(ms));
const go=id=>new Response(null,{status:303,headers:{Location:id?'/admin/instagram/planner/review?id='+id:'/admin/instagram/planner','Cache-Control':'no-store'}});
const back='<p><a href="/admin/instagram/planner">Back to Instagram planner</a></p>';
const error=message=>privatePage('Post not scheduled','<p>'+esc(message)+'</p>'+back,400);
async function account(env){const r=await env.DB.prepare('SELECT instagram_account_id,username,encrypted_access_token FROM instagram_connections LIMIT 2').all();return r.results.length===1?r.results[0]:null;}
export function parseSast(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return NaN;const n=Date.parse(value+':00+02:00');return Number.isFinite(n)&&new Date(n+7200000).toISOString().slice(0,16)===value?n:NaN;}
async function asset(env,id,until){if(!/^[a-f0-9]{64}$/.test(id||''))return null;const a=await env.DB.prepare('SELECT id,width,height,expires_at FROM instagram_media_assets WHERE id=? AND expires_at>?').bind(id,until).first();return a&&a.width/a.height>=0.8&&a.width/a.height<=1.91?a:null;}
export async function plannerPage(env,now=Date.now()){
 const a=await account(env);
 const images=await env.DB.prepare('SELECT id,width,height,created_at FROM instagram_media_assets WHERE expires_at>? ORDER BY created_at DESC LIMIT 50').bind(now+3600000).all();
 const posts=await env.DB.prepare('SELECT id,caption,scheduled_at,status,error_message,media_id FROM instagram_scheduled_posts ORDER BY scheduled_at DESC LIMIT 50').all();
 const options=images.results.filter(i=>i.width/i.height>=0.8&&i.width/i.height<=1.91).map((i,n)=>'<option value="'+i.id+'">Image '+(n+1)+' — '+i.width+' × '+i.height+' — '+esc(i.created_at)+'</option>').join('');
 return privatePage('Instagram planner','<p>Account: <strong>'+esc(a?'@'+a.username:'No account connected')+'</strong></p><p>Only posts you review and schedule here will publish automatically. Times are South African time (SAST, UTC+2). Posts normally publish within five minutes of the chosen time; image preparation can take longer. Keep this page closed if you wish—the server handles scheduled posts.</p><p><a href="/admin/instagram">Upload another image or check connection</a></p>'+(a&&options?'<section><h2>Prepare your next post</h2><form method="post" action="/admin/instagram/planner/draft"><input type="hidden" name="id" value="'+crypto.randomUUID()+'"><label for="image">Prepared image</label><select id="image" name="image" required>'+options+'</select><label for="caption">Caption</label><textarea id="caption" name="caption" rows="9" maxlength="2200" required style="width:100%;box-sizing:border-box;font:inherit"></textarea><label for="when">Date and time (South Africa)</label><input id="when" type="datetime-local" name="when" min="'+new Date(now+5*60000+7200000).toISOString().slice(0,16)+'" required><p>Choose at least five minutes ahead and before your image link expires (up to 29 days).</p><button>Review post — do not schedule yet</button></form></section>':'<p>Connect your account and prepare an image to begin.</p>')+'<h2>Your posts</h2>'+(posts.results.length?posts.results.map(p=>'<section><p><strong>'+esc(when(p.scheduled_at))+' SAST</strong> — '+esc(p.status.replaceAll('_',' '))+'</p><p style="white-space:pre-wrap">'+esc(p.caption)+'</p>'+(p.error_message?'<p>'+esc(p.error_message)+'</p>':'')+(p.media_id?'<p>Instagram post ID: '+esc(p.media_id)+'</p>':'')+'<a href="/admin/instagram/planner/review?id='+p.id+'">View post</a></section>').join(''):'<p>No Instagram posts scheduled yet.</p>'));
}
export async function saveDraft(request,env,now=Date.now()){
 const f=await request.formData();const id=f.get('id'),image=f.get('image'),caption=f.get('caption'),date=parseSast(f.get('when'));
 if(!validId(id)||typeof caption!=='string'||!caption.trim()||[...caption].length>2200||!Number.isFinite(date)||date<now+5*60000||date>now+29*86400000)return error('Enter a caption up to 2,200 characters and a time at least five minutes ahead, within 29 days.');
 const a=await account(env);if(!a)return error('Connect one Instagram account first.');
 if(!await asset(env,image,date+3600000))return error('Prepare an image that will remain available for at least an hour after your chosen time.');
 await env.DB.prepare('INSERT OR IGNORE INTO instagram_scheduled_posts(id,account_id,asset_id,caption,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,a.instagram_account_id,image,caption.trim(),date,'draft',now,now).run();
 return go(id);
}
export async function scheduleReview(env,id){
 const p=validId(id)?await env.DB.prepare('SELECT * FROM instagram_scheduled_posts WHERE id=?').bind(id).first():null;if(!p)return privatePage('Post not found',back,404);
 const a=await account(env);const matches=a?.instagram_account_id===p.account_id;
 const hidden='<input type="hidden" name="id" value="'+p.id+'">';
 const approve=p.status==='draft'&&matches?'<form method="post" action="/admin/instagram/planner/approve">'+hidden+'<p>Pressing this button authorizes Rene Social Hub to publish this exact image and caption to @'+esc(a.username)+' at the time shown.</p><button>Schedule this Instagram post</button></form>':'';
 const cancel=['draft','scheduled','waiting'].includes(p.status)?'<form method="post" action="/admin/instagram/planner/cancel">'+hidden+'<p><button>Cancel this post</button></p></form>':'';
 return privatePage('Review scheduled post','<p>Account: '+esc(matches?'@'+a.username:'Saved account is no longer connected')+'</p><p><strong>'+esc(when(p.scheduled_at))+' SAST (UTC+2)</strong></p><p>Status: '+esc(p.status.replaceAll('_',' '))+'</p><img alt="Scheduled Instagram artwork" src="/instagram-media/'+p.asset_id+'.jpg"><section style="white-space:pre-wrap">'+esc(p.caption)+'</section>'+(p.error_message?'<p>'+esc(p.error_message)+'</p>':'')+approve+cancel+back);
}
export async function approveSchedule(request,env,decrypt,fetchImpl=fetch,now=Date.now()){
 const id=(await request.formData()).get('id');if(!validId(id))return error('Invalid post.');
 const p=await env.DB.prepare('SELECT * FROM instagram_scheduled_posts WHERE id=?').bind(id).first();if(!p)return error('Post not found.');if(p.status!=='draft')return go(id);
 const a=await account(env);if(!a||a.instagram_account_id!==p.account_id)return error('The connected account changed. Prepare a new post for the correct account.');
 if(p.scheduled_at<now+60000||!await asset(env,p.asset_id,p.scheduled_at+3600000))return error('The time or image has expired. Cancel this draft and prepare a new one.');
 const ready=await inspectInstagram(env,decrypt,fetchImpl);if(!ready.permissionCheckPassed)return error('Instagram readiness must pass before scheduling. Check the saved connection.');
 await env.DB.prepare("UPDATE instagram_scheduled_posts SET status='scheduled',updated_at=? WHERE id=? AND status='draft'").bind(now,id).run();return go(id);
}
export async function cancelSchedule(request,env,now=Date.now()){
 const id=(await request.formData()).get('id');if(!validId(id))return error('Invalid post.');
 await env.DB.prepare("UPDATE instagram_scheduled_posts SET status='cancelled',updated_at=? WHERE id=? AND status IN ('draft','scheduled','waiting')").bind(now,id).run();return go(id);
}
export async function runInstagramSchedule(env,decrypt,fetchImpl=fetch,now=Date.now()){
 // Interrupted writes are never automatically retried: Meta might already have accepted them.
 await env.DB.prepare("UPDATE instagram_scheduled_posts SET status='review_required',error_message='The previous request was interrupted. Check Instagram before creating another post.',updated_at=? WHERE status IN ('preparing','checking','publishing') AND updated_at<?").bind(now,now-10*60000).run();
 const due=await env.DB.prepare("SELECT id FROM instagram_scheduled_posts WHERE status IN ('scheduled','waiting') AND scheduled_at<=? ORDER BY scheduled_at LIMIT 3").bind(now).all();
 for(const item of due.results){
  const p=await env.DB.prepare("UPDATE instagram_scheduled_posts SET status=CASE WHEN status='scheduled' THEN 'preparing' ELSE 'checking' END,updated_at=? WHERE id=? AND status IN ('scheduled','waiting') AND scheduled_at<=? RETURNING *").bind(now,item.id,now).first();if(!p)continue;
  const save=(status,message=null,container=null,media=null)=>env.DB.prepare('UPDATE instagram_scheduled_posts SET status=?,error_message=?,container_id=COALESCE(?,container_id),media_id=COALESCE(?,media_id),updated_at=? WHERE id=?').bind(status,message,container,media,now,p.id).run();
  let publishing=false;
  try{
   if(now-p.scheduled_at>30*60000){await save('failed','This post missed its time by more than 30 minutes. Prepare a new schedule if still relevant.');continue;}
   const a=await account(env);if(!a||a.instagram_account_id!==p.account_id||!await asset(env,p.asset_id,now+600000)){await save('failed','The image or expected Instagram connection is unavailable. Prepare a new post.');continue;}
   const ready=await inspectInstagram(env,decrypt,fetchImpl,now);if(!ready.permissionCheckPassed){await save('failed','Instagram authorization needs attention. Check readiness before scheduling again.');continue;}
   const token=await decrypt(a.encrypted_access_token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY);
   const api=async(path,body)=>{const r=await fetchImpl(GRAPH+'/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok||data.error)throw Error('Meta request failed');return data;};
   let container=p.container_id;
   if(!container){const made=await api(encodeURIComponent(p.account_id)+'/media',{image_url:BASE+'/instagram-media/'+p.asset_id+'.jpg',caption:p.caption});if(!/^\d+$/.test(String(made.id||'')))throw Error('Missing container');container=String(made.id);await save('checking',null,container);}
   const state=await api(encodeURIComponent(container)+'?fields=status_code');
   if(state.status_code==='IN_PROGRESS'){await save('waiting');continue;}
   if(state.status_code!=='FINISHED')throw Error('Container unavailable');
   // Revalidate identity immediately before the publication side effect.
   const current=await account(env);if(current?.instagram_account_id!==p.account_id||current?.encrypted_access_token!==a.encrypted_access_token)throw Error('Account changed');
   await save('publishing');publishing=true;
   const sent=await api(encodeURIComponent(p.account_id)+'/media_publish',{creation_id:container});if(!/^\d+$/.test(String(sent.id||'')))throw Error('Unconfirmed publication');
   await save('published',null,null,String(sent.id));
  }catch{await save(publishing?'review_required':'failed',publishing?'Publishing could not be confirmed. Check Instagram before creating another copy. No automatic retry will run.':'Image preparation or connection check failed. Review the post before scheduling a new copy.');}
 }
}
