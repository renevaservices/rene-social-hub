import {THREADS_APP_ID} from './threads.js';
export const CLIENT_BASE='https://rene-social-hub-api-test.renevaservices.workers.dev';
export const callbackFor=platform=>CLIENT_BASE+'/api/oauth/callback/client-'+platform;
export const validClientId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export const platforms=['facebook','instagram','threads'];
export const graphFor=p=>p==='threads'?'https://graph.threads.com/':'https://graph.facebook.com/v22.0/';
export async function clientApi(platform,path,token,fetchImpl=fetch,body){
 const r=await fetchImpl(graphFor(platform)+path,{method:body?'POST':'GET',headers:token?{Authorization:'Bearer '+token}:{},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok||data.error)throw Error('Platform request failed');return data;
}
export async function verifyClientAccount(env,c,token,fetchImpl=fetch,now=Date.now()){
 if(c.expires_at<=now+60000)throw Error('Authorization expired');
 if(c.platform==='threads'){
  const profile=await clientApi('threads','me?fields=id,username',token,fetchImpl);
  const d=(await clientApi('threads','debug_token?input_token='+encodeURIComponent(token),token,fetchImpl)).data;
  if(String(profile.id)!==c.account_id||!d?.is_valid||(d.app_id&&String(d.app_id)!==String(env.THREADS_APP_ID||THREADS_APP_ID))||!['threads_basic','threads_content_publish'].every(s=>d.scopes?.includes(s))||(d.expires_at&&d.expires_at*1000<=now))throw Error('Wrong Threads authorization');
  return {expires_at:Math.min(c.expires_at,d.expires_at?d.expires_at*1000:c.expires_at)};
 }
 const d=(await clientApi(c.platform,'debug_token?input_token='+encodeURIComponent(token),env.FACEBOOK_APP_ID+'|'+env.FACEBOOK_APP_SECRET,fetchImpl)).data;
 const scopes=c.platform==='facebook'?['pages_manage_posts','pages_read_engagement']:['instagram_basic','instagram_content_publish','pages_read_engagement'];
 if(!d?.is_valid||String(d.app_id)!==String(env.FACEBOOK_APP_ID)||!scopes.every(s=>d.scopes?.includes(s))||(d.expires_at&&d.expires_at*1000<=now)||(d.data_access_expires_at&&d.data_access_expires_at*1000<=now))throw Error('Wrong Meta authorization');
 const identity=await clientApi(c.platform,encodeURIComponent(c.page_id||c.account_id)+'?fields='+(c.platform==='instagram'?'id,instagram_business_account{id,username}':'id,name'),token,fetchImpl);
 if(String(identity.id)!==String(c.page_id||c.account_id)||(c.platform==='instagram'&&String(identity.instagram_business_account?.id)!==c.account_id))throw Error('Wrong account');
 return {expires_at:Math.min(c.expires_at,...[d.expires_at,d.data_access_expires_at].filter(v=>v>0).map(v=>v*1000))};
}
export async function isPersonalAccount(env,p,id){
 const sql=p==='facebook'?'SELECT page_id AS id FROM facebook_connections WHERE page_id=?':p==='instagram'?'SELECT instagram_account_id AS id FROM instagram_connections WHERE instagram_account_id=?':'SELECT account_id AS id FROM threads_connections WHERE account_id=?';
 return Boolean(await env.DB.prepare(sql).bind(id).first());
}
