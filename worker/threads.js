import {privatePage} from './instagram-tools.js';
export const THREADS_APP_ID='1710838133324746';
export const THREADS_CALLBACK='https://rene-social-hub-api-test.renevaservices.workers.dev/api/oauth/callback/threads';
const GRAPH='https://graph.threads.com/';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const back='<p><a href="/admin/threads">Back to Threads</a></p>';
const go=()=>new Response(null,{status:303,headers:{Location:'/admin/threads','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const fail=message=>privatePage('Threads needs attention','<p>'+esc(message)+'</p>'+back,400);
const appId=env=>env.THREADS_APP_ID||THREADS_APP_ID;
async function api(path,token,fetchImpl=fetch,body){
 const r=await fetchImpl(GRAPH+path,{method:body?'POST':'GET',headers:token?{Authorization:'Bearer '+token}:{},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok||data.error)throw Error('Threads request failed');return data;
}
async function verify(env,token,fetchImpl=fetch,expected=null,now=Date.now()){
 const profile=await api('me?fields=id,username',token,fetchImpl);
 if(!/^\d+$/.test(String(profile.id||''))||!profile.username||(expected&&String(profile.id)!==expected))throw Error('Account mismatch');
 const debug=await api('debug_token?input_token='+encodeURIComponent(token),token,fetchImpl);
 const d=debug.data;
 if(!d?.is_valid||!Array.isArray(d.scopes)||!['threads_basic','threads_content_publish'].every(s=>d.scopes.includes(s))||(d.app_id&&String(d.app_id)!==appId(env))||(d.expires_at&&d.expires_at*1000<=now)||(d.user_id&&String(d.user_id)!==String(profile.id)))throw Error('Invalid authorization');
 return profile;
}
export async function threadsPage(env,now=Date.now()){
 const connection=await env.DB.prepare('SELECT username,expires_at FROM threads_connections WHERE slot=1').first();
 const pending=await env.DB.prepare('SELECT id,username FROM threads_pending_connections WHERE created_at>? ORDER BY created_at DESC LIMIT 1').bind(now-15*60000).first();
 const posts=await env.DB.prepare("SELECT id,content,scheduled_at,status,error_message FROM scheduled_posts WHERE platform='threads' ORDER BY scheduled_at LIMIT 30").all();
 const stamp=ms=>new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(ms));
 const futureDrafts=posts.results.filter(p=>p.status==='draft'&&Date.parse(p.scheduled_at)>now+60000);
 const ids=futureDrafts.map(p=>'<input type="hidden" name="post" value="'+esc(p.id)+'">').join('');
 return privatePage('Threads connection and posts','<p>'+(connection?'Connected account: <strong>@'+esc(connection.username)+'</strong>. Authorization expires '+esc(stamp(connection.expires_at))+'.':'No Threads account is connected in Cloudflare yet.')+'</p>'+(env.THREADS_APP_SECRET?'<form method="post" action="/admin/threads/connect"><button>'+(connection?'Reconnect':'Connect')+' Threads securely</button></form>':'<section><p>Setup needed: add the Threads app secret to this Worker as a Secret named <code>THREADS_APP_SECRET</code> in Cloudflare. Do not paste it into chat.</p><p>Threads app ID: '+esc(appId(env))+'</p><p>Meta redirect callback URL:</p><code>'+THREADS_CALLBACK+'</code></section>')+(pending?'<section><h2>Confirm the Threads account</h2><p>Meta returned <strong>@'+esc(pending.username)+'</strong>. Confirm only if this is the account you want to use.</p><form method="post" action="/admin/threads/confirm"><input type="hidden" name="pending" value="'+pending.id+'"><button>Use @'+esc(pending.username)+'</button></form><p>Connecting does not publish or schedule any post.</p></section>':'')+'<h2>Prepared Threads posts</h2><p>All times are South African time (SAST, UTC+2). Scheduled posts are checked every five minutes.</p>'+posts.results.map(p=>'<section><p><strong>'+esc(stamp(Date.parse(p.scheduled_at)))+' SAST</strong> — '+esc(p.status)+'</p><p style="white-space:pre-wrap">'+esc(p.content)+'</p>'+(p.error_message?'<p>'+esc(p.error_message)+'</p>':'')+(p.status==='scheduled'?'<form method="post" action="/admin/threads/cancel"><input type="hidden" name="post" value="'+esc(p.id)+'"><button>Cancel this post</button></form>':'')+'</section>').join('')+(connection&&futureDrafts.length?'<form method="post" action="/admin/threads/schedule">'+ids+'<p>This schedules the '+futureDrafts.length+' future drafts shown above for @'+esc(connection.username)+'. They will publish as text posts at the displayed times.</p><button>Schedule these Threads posts</button></form>':'<p>Drafts will stay unpublished until an account is connected and you schedule them.</p>'));
}
export async function startThreads(env,now=Date.now()){
 if(!env.THREADS_APP_SECRET||!env.FACEBOOK_TOKEN_ENCRYPTION_KEY)return fail('Finish the Threads secret setup in Cloudflare first.');
 const state=crypto.randomUUID()+crypto.randomUUID();
 await env.DB.batch([env.DB.prepare('DELETE FROM threads_oauth_states WHERE created_at<?').bind(now-10*60000),env.DB.prepare('INSERT INTO threads_oauth_states(state,created_at) VALUES(?,?)').bind(state,now)]);
 const url=new URL('https://www.threads.com/oauth/authorize');url.search=new URLSearchParams({client_id:appId(env),redirect_uri:THREADS_CALLBACK,scope:'threads_basic,threads_content_publish',response_type:'code',state}).toString();
 return privatePage('Continue to Threads','<p>Sign in to the Threads account you want Rene Social Hub to use. This does not publish anything.</p><p><a href="'+esc(url)+'" rel="noreferrer">Continue to Threads authorization</a></p>'+back);
}
export function threadsReturnPage() {
 return privatePage('Return to Rene Social Hub','<p>Continue to your private Threads setup to confirm the account returned by Meta.</p><p><a style="display:inline-block;padding:14px 20px;background:#e8c45b;color:#071b36;border-radius:7px" href="/admin/threads">Continue to confirm Threads account</a></p><p>This step does not publish or schedule anything. If your owner session has expired, you will be asked to sign in.</p>');
}
export async function finishThreads(request,env,encrypt,fetchImpl=fetch,now=Date.now()){
 const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
 if(!/^[a-f0-9-]{72}$/.test(state||''))return fail('The Threads connection link is invalid or expired. Start again from the owner page.');
 const consumed=await env.DB.prepare('DELETE FROM threads_oauth_states WHERE state=? AND created_at>? RETURNING state').bind(state,now-10*60000).first();
 if(!consumed)return fail('The Threads connection link expired or was already used. Start again.');
 if(url.searchParams.has('error'))return fail('Threads authorization was cancelled. Your saved connection was not changed.');
 if(!code||code.length>4096||!env.THREADS_APP_SECRET)return fail('Threads did not return a usable authorization code.');
 try{
  const short=await api('oauth/access_token',null,fetchImpl,{client_id:appId(env),client_secret:env.THREADS_APP_SECRET,grant_type:'authorization_code',redirect_uri:THREADS_CALLBACK,code});
  if(typeof short.access_token!=='string')throw Error('Missing token');
  const long=await api('access_token?'+new URLSearchParams({grant_type:'th_exchange_token',client_secret:env.THREADS_APP_SECRET,access_token:short.access_token}),null,fetchImpl);
  if(typeof long.access_token!=='string'||!(Number(long.expires_in)>86400))throw Error('No long lived authorization');
  const profile=await verify(env,long.access_token,fetchImpl,null,now);
  const encrypted=await encrypt(long.access_token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY);
  await env.DB.batch([env.DB.prepare('DELETE FROM threads_pending_connections'),env.DB.prepare('INSERT INTO threads_pending_connections(id,account_id,username,encrypted_access_token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),String(profile.id),profile.username,encrypted,now+Number(long.expires_in)*1000,now)]);
  return threadsReturnPage();
 }catch{return fail('Threads could not complete the connection. Your existing connection was not changed. Start again from the owner page.');}
}
export async function confirmThreads(request,env,now=Date.now()){
 const id=(await request.formData()).get('pending');if(typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id))return fail('Invalid pending connection.');
 // The insert selects only a valid staged credential; owner authentication and origin are checked by the router.
 await env.DB.batch([env.DB.prepare('INSERT INTO threads_connections(slot,account_id,username,encrypted_access_token,expires_at,updated_at) SELECT 1,account_id,username,encrypted_access_token,expires_at,? FROM threads_pending_connections WHERE id=? AND created_at>? ON CONFLICT(slot) DO UPDATE SET account_id=excluded.account_id,username=excluded.username,encrypted_access_token=excluded.encrypted_access_token,expires_at=excluded.expires_at,updated_at=excluded.updated_at').bind(now,id,now-15*60000),env.DB.prepare('DELETE FROM threads_pending_connections WHERE id=?').bind(id)]);
 return go();
}
export async function scheduleThreads(request,env,decrypt,fetchImpl=fetch,now=Date.now()){
 const ids=[...new Set((await request.formData()).getAll('post'))];if(!ids.length||ids.length>30||ids.some(id=>typeof id!=='string'||id.length>160))return fail('Choose up to 30 prepared drafts.');
 const c=await env.DB.prepare('SELECT * FROM threads_connections WHERE slot=1').first();if(!c||c.expires_at<=now+3600000)return fail('Connect Threads with a current authorization first.');
 try{await verify(env,await decrypt(c.encrypted_access_token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY),fetchImpl,c.account_id,now);}catch{return fail('The saved Threads authorization or publishing permission needs attention. Reconnect Threads.');}
 const rows=await env.DB.prepare("SELECT id,content,scheduled_at FROM scheduled_posts WHERE platform='threads' AND status='draft' AND id IN ("+ids.map(()=>'?').join(',')+")").bind(...ids).all();
 if(rows.results.some(p=>!p.content.trim()||[...p.content].length>500||Date.parse(p.scheduled_at)<now+60000||Date.parse(p.scheduled_at)>c.expires_at-3600000))return fail('One or more drafts have an expired time, an authorization expiry conflict, or more than 500 characters.');
 const statements=[];
 for(const p of rows.results){statements.push(env.DB.prepare("INSERT OR IGNORE INTO threads_publish_jobs(post_id,account_id,content,scheduled_at,status,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM threads_connections WHERE slot=1 AND account_id=? AND encrypted_access_token=?)").bind(p.id,c.account_id,p.content,Date.parse(p.scheduled_at),'scheduled',now,c.account_id,c.encrypted_access_token));statements.push(env.DB.prepare("UPDATE scheduled_posts SET status='scheduled' WHERE id=? AND platform='threads' AND status='draft' AND EXISTS(SELECT 1 FROM threads_publish_jobs WHERE post_id=? AND status='scheduled')").bind(p.id,p.id));}
 if(statements.length)await env.DB.batch(statements);return go();
}
export async function cancelThreads(request,env,now=Date.now()){
 const id=(await request.formData()).get('post');if(typeof id!=='string'||id.length>160)return fail('Invalid post.');
 await env.DB.batch([env.DB.prepare("UPDATE threads_publish_jobs SET status='cancelled',updated_at=? WHERE post_id=? AND status IN ('scheduled','waiting')").bind(now,id),env.DB.prepare("UPDATE scheduled_posts SET status='cancelled' WHERE id=? AND platform='threads' AND EXISTS(SELECT 1 FROM threads_publish_jobs WHERE post_id=? AND status='cancelled')").bind(id,id)]);return go();
}
export async function runThreadsSchedule(env,decrypt,fetchImpl=fetch,now=Date.now()){
 await env.DB.batch([env.DB.prepare("UPDATE threads_publish_jobs SET status='review_required',error_message='An interrupted request needs review. Check Threads before creating another copy.',updated_at=? WHERE status IN ('preparing','checking','publishing') AND updated_at<?").bind(now,now-10*60000),env.DB.prepare("UPDATE scheduled_posts SET status='failed',error_message='Threads publication needs manual review.' WHERE platform='threads' AND status='scheduled' AND id IN (SELECT post_id FROM threads_publish_jobs WHERE status='review_required')")]);
 const rows=await env.DB.prepare("SELECT post_id FROM threads_publish_jobs WHERE status IN ('scheduled','waiting') AND scheduled_at<=? ORDER BY scheduled_at LIMIT 3").bind(now).all();
 for(const row of rows.results){
  const p=await env.DB.prepare("UPDATE threads_publish_jobs SET status=CASE WHEN status='scheduled' THEN 'preparing' ELSE 'checking' END,updated_at=? WHERE post_id=? AND status IN ('scheduled','waiting') AND scheduled_at<=? RETURNING *").bind(now,row.post_id,now).first();if(!p)continue;
  const save=async(status,message=null,container=null,media=null)=>{
   const statements=[env.DB.prepare('UPDATE threads_publish_jobs SET status=?,error_message=?,container_id=COALESCE(?,container_id),media_id=COALESCE(?,media_id),updated_at=? WHERE post_id=?').bind(status,message,container,media,now,p.post_id)];
   if(['published','failed','review_required'].includes(status))statements.push(env.DB.prepare("UPDATE scheduled_posts SET status=?,published_at=?,error_message=? WHERE id=? AND platform='threads'").bind(status==='published'?'published':'failed',status==='published'?new Date(now).toISOString():null,message,p.post_id));
   await env.DB.batch(statements);
  };
  let publishing=false;
  try{
   const c=await env.DB.prepare('SELECT * FROM threads_connections WHERE slot=1').first();
   if(now-p.scheduled_at>30*60000||!c||c.account_id!==p.account_id||c.expires_at<=now+60000){await save('failed','The post missed its time or the expected Threads connection is unavailable. Review before scheduling again.');continue;}
   const token=await decrypt(c.encrypted_access_token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY);await verify(env,token,fetchImpl,p.account_id,now);
   let container=p.container_id;
   if(!container){const data=await api(encodeURIComponent(p.account_id)+'/threads',token,fetchImpl,{media_type:'TEXT',text:p.content});if(!/^\d+$/.test(String(data.id||'')))throw Error('Missing container');container=String(data.id);await save('checking',null,container);}
   const state=await api(encodeURIComponent(container)+'?fields=status',token,fetchImpl);
   if(state.status==='IN_PROGRESS'){await save('waiting');continue;}
   if(state.status!=='FINISHED')throw Error('Container not ready');
   const current=await env.DB.prepare('SELECT account_id,encrypted_access_token FROM threads_connections WHERE slot=1').first();if(current?.account_id!==p.account_id||current?.encrypted_access_token!==c.encrypted_access_token)throw Error('Account changed');
   await save('publishing');publishing=true;
   const sent=await api(encodeURIComponent(p.account_id)+'/threads_publish',token,fetchImpl,{creation_id:container});if(!/^\d+$/.test(String(sent.id||'')))throw Error('Unconfirmed publication');
   await save('published',null,null,String(sent.id));
  }catch{await save(publishing?'review_required':'failed',publishing?'Publishing could not be confirmed. Check Threads before creating another copy. No automatic retry will run.':'Threads preparation or authorization failed. Reconnect if needed, then review the post.');}
 }
}
