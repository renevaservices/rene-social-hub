import {privatePage} from './instagram-tools.js';
import {THREADS_APP_ID} from './threads.js';
import {callbackFor,clientApi,platforms,validClientId,verifyClientAccount,isPersonalAccount} from './client-api.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=message=>privatePage('Client connection needs attention','<p>'+esc(message)+'</p><p><a href="/admin/clients">Back to client automation</a></p>',400);
export async function startClientConnection(request,env,clientId,now=Date.now()){
 const f=await request.formData(),platform=f.get('platform');
 if(!platforms.includes(platform)||!validClientId(clientId)||!await env.DB.prepare('SELECT id FROM social_clients WHERE id=? AND active=1').bind(clientId).first())return fail('Choose an active client and a supported platform.');
 if(!env.FACEBOOK_TOKEN_ENCRYPTION_KEY||(platform==='threads'?!env.THREADS_APP_SECRET:!env.FACEBOOK_APP_ID||!env.FACEBOOK_APP_SECRET))return fail('The platform app settings are incomplete.');
 const state=crypto.randomUUID()+crypto.randomUUID();
 await env.DB.batch([env.DB.prepare('DELETE FROM client_oauth_states WHERE created_at<?').bind(now-600000),env.DB.prepare('INSERT INTO client_oauth_states VALUES(?,?,?,?)').bind(state,clientId,platform,now)]);
 const url=new URL(platform==='threads'?'https://www.threads.com/oauth/authorize':'https://www.facebook.com/v22.0/dialog/oauth');
 const params={client_id:platform==='threads'?(env.THREADS_APP_ID||THREADS_APP_ID):env.FACEBOOK_APP_ID,redirect_uri:callbackFor(platform),response_type:'code',state};
 if(platform==='threads')params.scope='threads_basic,threads_content_publish';else{params.config_id=platform==='instagram'?'1416447423555854':env.FACEBOOK_LOGIN_CONFIG_ID;params.override_default_response_type='true';}
 url.search=new URLSearchParams(params);
 return privatePage('Authorize client account','<p>This link authorizes '+esc(platform)+' access for the selected client. It expires in ten minutes. Only authorize accounts you are allowed to manage. You will confirm the exact account in Social Hub before it is saved.</p><p><a href="'+esc(url)+'" rel="noreferrer">Continue to '+esc(platform)+' authorization</a></p><p>You may copy that authorization link for the client to open in their own browser. Your Social Hub owner password must stay private.</p><p>Meta may restrict access to app-role/test accounts until the required permissions have Advanced Access. A denied authorization does not connect an account.</p><p>Register this exact callback in the matching Meta app settings first:</p><code>'+esc(callbackFor(platform))+'</code>');
}
export async function finishClientConnection(request,env,platform,encrypt,fetchImpl=fetch,now=Date.now()){
 const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
 if(!platforms.includes(platform)||!/^[a-f0-9-]{72}$/.test(state||''))return fail('Invalid connection request.');
 const context=await env.DB.prepare('DELETE FROM client_oauth_states WHERE state=? AND platform=? AND created_at>? RETURNING client_id').bind(state,platform,now-600000).first();
 if(!context||!await env.DB.prepare('SELECT id FROM social_clients WHERE id=? AND active=1').bind(context.client_id).first())return fail('The connection request expired or the client is inactive.');
 if(url.searchParams.has('error')||!code||code.length>4096)return fail('Authorization was cancelled or did not finish. No connection was changed.');
 try{
  const candidates=[];
  if(platform==='threads'){
   const short=await clientApi(platform,'oauth/access_token',null,fetchImpl,{client_id:env.THREADS_APP_ID||THREADS_APP_ID,client_secret:env.THREADS_APP_SECRET,grant_type:'authorization_code',redirect_uri:callbackFor(platform),code});
   if(!short.access_token)throw Error('Missing token');
   const long=await clientApi(platform,'access_token?'+new URLSearchParams({grant_type:'th_exchange_token',client_secret:env.THREADS_APP_SECRET,access_token:short.access_token}),null,fetchImpl);
   if(!long.access_token||!(Number(long.expires_in)>86400))throw Error('Long authorization needed');
   const profile=await clientApi(platform,'me?fields=id,username',long.access_token,fetchImpl);
   if(!/^\d+$/.test(String(profile.id||'')))throw Error('Invalid account');
   candidates.push({account_id:String(profile.id),page_id:null,display_name:'@'+profile.username,token:long.access_token,expires_at:now+Number(long.expires_in)*1000});
  }else{
   const token=await clientApi(platform,'oauth/access_token?'+new URLSearchParams({client_id:env.FACEBOOK_APP_ID,client_secret:env.FACEBOOK_APP_SECRET,redirect_uri:callbackFor(platform),code}),null,fetchImpl);
   if(!token.access_token)throw Error('Missing token');
   const extended=await clientApi(platform,'oauth/access_token?'+new URLSearchParams({grant_type:'fb_exchange_token',client_id:env.FACEBOOK_APP_ID,client_secret:env.FACEBOOK_APP_SECRET,fb_exchange_token:token.access_token}),null,fetchImpl);
   if(!extended.access_token)throw Error('Long-lived client authorization needed');
   // Follow only the known Graph endpoint using a validated pagination cursor.
   let after=null;for(let page=0;page<5&&candidates.length<20;page++){
    const params=new URLSearchParams({fields:'id,name,access_token,instagram_business_account{id,username}',limit:'100'});if(after)params.set('after',after);
    const data=await clientApi(platform,'me/accounts?'+params,extended.access_token,fetchImpl);
    for(const item of data.data||[]){if(candidates.length>=20)break;if(!item.access_token||!/^\d+$/.test(String(item.id||'')))continue;const ig=item.instagram_business_account;if(platform==='instagram'&&!/^\d+$/.test(String(ig?.id||'')))continue;candidates.push({account_id:String(platform==='instagram'?ig.id:item.id),page_id:String(item.id),display_name:platform==='instagram'?'@'+(ig.username||ig.id):(item.name||item.id),token:item.access_token,expires_at:now+60*86400000});}
    after=data.paging?.next?data.paging?.cursors?.after:null;if(!after)break;if(typeof after!=='string'||after.length>4096)throw Error('Invalid cursor');
   }
  }
  const statements=[env.DB.prepare('DELETE FROM client_pending_connections WHERE client_id=? AND platform=?').bind(context.client_id,platform),env.DB.prepare('DELETE FROM client_pending_connections WHERE created_at<?').bind(now-900000)];let accepted=0;
  for(const c of candidates){if(await isPersonalAccount(env,platform,c.account_id))continue;try{const verified=await verifyClientAccount(env,{...c,platform},c.token,fetchImpl,now);c.expires_at=verified.expires_at;}catch{continue;}statements.push(env.DB.prepare('INSERT INTO client_pending_connections(id,client_id,platform,account_id,page_id,display_name,encrypted_access_token,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),context.client_id,platform,c.account_id,c.page_id,c.display_name,await encrypt(c.token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY),c.expires_at,now));accepted++;}
  if(!accepted)return fail('No eligible client account with publishing permission was returned. Your own Rene VA Services accounts are kept separate. Check the client’s granted access and Meta app permissions.');
  await env.DB.batch(statements);
  return privatePage('Client authorization received','<p>Authorization was received. The owner must confirm the correct account for this client.</p><p><a href="/admin/clients/'+context.client_id+'">Continue to confirm the client account</a></p><p>This does not publish or schedule anything. Sign in with the owner password if prompted.</p>');
 }catch{return fail('Meta could not complete the client authorization. Check the callback address, app permissions and client access. No saved connection was changed.');}
}
export async function confirmClientConnection(request,env,clientId,now=Date.now()){
 const pending=(await request.formData()).get('pending');
 if(!validClientId(pending)||!validClientId(clientId))return fail('Invalid account selection.');
 const c=await env.DB.prepare('SELECT * FROM client_pending_connections WHERE id=? AND client_id=? AND created_at>?').bind(pending,clientId,now-900000).first();
 if(!c||!await env.DB.prepare('SELECT id FROM social_clients WHERE id=? AND active=1').bind(clientId).first()||await isPersonalAccount(env,c.platform,c.account_id))return fail('The selection expired or is not an eligible client account.');
 const other=await env.DB.prepare('SELECT client_id FROM client_connections WHERE platform=? AND account_id=? AND client_id!=?').bind(c.platform,c.account_id,clientId).first();if(other)return fail('This social account is already assigned to a different client.');
 await env.DB.batch([env.DB.prepare('INSERT INTO client_connections(id,client_id,platform,account_id,page_id,display_name,encrypted_access_token,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id,platform) DO UPDATE SET account_id=excluded.account_id,page_id=excluded.page_id,display_name=excluded.display_name,encrypted_access_token=excluded.encrypted_access_token,expires_at=excluded.expires_at,version=client_connections.version+1,active=1,updated_at=excluded.updated_at').bind(crypto.randomUUID(),clientId,c.platform,c.account_id,c.page_id,c.display_name,c.encrypted_access_token,c.expires_at,now),env.DB.prepare('DELETE FROM client_pending_connections WHERE client_id=? AND platform=?').bind(clientId,c.platform)]);
 return new Response(null,{status:303,headers:{Location:'/admin/clients/'+clientId,'Cache-Control':'no-store'}});
}
