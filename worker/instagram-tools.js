const BASE='https://rene-social-hub-api-test.renevaservices.workers.dev';
const GRAPH='https://graph.facebook.com/v22.0';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function privatePage(title,body,status=200){return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — Rene Social Hub</title><style>body{font:17px system-ui;background:#071b36;color:white;max-width:650px;margin:6vh auto;padding:24px;line-height:1.6}a{color:#e8c45b}button{padding:14px;background:#e8c45b;color:#071b36;border:0;border-radius:7px;font:inherit}input{max-width:100%;padding:10px;box-sizing:border-box}section{border:1px solid #65758a;padding:18px;border-radius:12px;margin:20px 0}code{overflow-wrap:anywhere}img{max-width:100%}label{display:block}</style><h1>${escape(title)}</h1>${body}<p><a href="/admin">Back to admin</a></p></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});}
export async function inspectInstagram(env,decrypt,fetchImpl=fetch,now=Date.now()){
 const rows=await env.DB.prepare('SELECT instagram_account_id,username,page_id,encrypted_access_token FROM instagram_connections LIMIT 2').all();
 if(rows.results?.length!==1)return {connectionSaved:false,reason:'Exactly one Instagram account must be connected.',publishingEnabled:false};
 const ig=rows.results[0];
 const base={connectionSaved:true,username:ig.username||null,publishingEnabled:false,checkedAt:new Date(now).toISOString()};
 if(!env.FACEBOOK_APP_ID||!env.FACEBOOK_APP_SECRET||!env.FACEBOOK_TOKEN_ENCRYPTION_KEY)return {...base,reason:'Meta configuration is incomplete.'};
 try{
  const token=await decrypt(ig.encrypted_access_token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY);
  const debug=new URL(GRAPH+'/debug_token');debug.searchParams.set('input_token',token);
  const response=await fetchImpl(debug,{headers:{Authorization:'Bearer '+env.FACEBOOK_APP_ID+'|'+env.FACEBOOK_APP_SECRET,'Cache-Control':'no-store'},signal:AbortSignal.timeout(10000)});
  const data=(await response.json())?.data;
  if(!response.ok||!data)return {...base,reason:'Meta could not verify this connection. No connection was changed.'};
  const tokenValid=Boolean(data.is_valid&&String(data.app_id)===String(env.FACEBOOK_APP_ID)&&(!data.expires_at||data.expires_at*1000>now)&&(!data.data_access_expires_at||data.data_access_expires_at*1000>now));
  const granted=Array.isArray(data.scopes)?data.scopes:[];
  const missingPermissions=['instagram_basic','instagram_content_publish','pages_read_engagement'].filter(s=>!granted.includes(s));
  const grant=(data.granular_scopes||[]).find(s=>s.scope==='instagram_content_publish');
  const targetMatches=!Array.isArray(grant?.target_ids)||grant.target_ids.some(id=>String(id)===String(ig.instagram_account_id)||String(id)===String(ig.page_id));
  if(!tokenValid)return {...base,tokenValid:false,reason:'The saved authorization is no longer valid for this app. No connection was changed.'};
  const endpoint=new URL(GRAPH+'/'+encodeURIComponent(ig.page_id));endpoint.searchParams.set('fields','instagram_business_account{id,username}');
  const accountResponse=await fetchImpl(endpoint,{headers:{Authorization:'Bearer '+token,'Cache-Control':'no-store'},signal:AbortSignal.timeout(10000)});
  const account=(await accountResponse.json())?.instagram_business_account;
  const accountVerified=Boolean(accountResponse.ok&&String(account?.id)===String(ig.instagram_account_id));
  return {...base,tokenValid,missingPermissions,publishingPermissionGranted:missingPermissions.length===0&&targetMatches,accountVerified,permissionCheckPassed:missingPermissions.length===0&&targetMatches&&accountVerified,reason:missingPermissions.length?'Publishing permissions are missing.':!targetMatches?'The publishing grant does not include this account.':!accountVerified?'Meta did not confirm the expected Instagram account.':'Connection and publishing permissions verified. A reviewed test post is still required.'};
 }catch{return {...base,reason:'The check could not finish. Please try again. No connection was changed.'};}
}
export async function instagramToolsPage(env,uploadedId=''){
 const row=await env.DB.prepare('SELECT username FROM instagram_connections LIMIT 1').first();
 let uploaded=null;
 if(/^[a-f0-9]{64}$/.test(uploadedId))uploaded=await env.DB.prepare('SELECT id,width,height,expires_at FROM instagram_media_assets WHERE id=? AND expires_at>?').bind(uploadedId,Date.now()).first();
 return privatePage('Instagram preparation',`<p>${row?'Saved Instagram connection: <strong>'+escape(row.username?'@'+row.username:'Connected')+'</strong>.':'No Instagram connection is saved.'} Automatic Instagram publishing is still disabled.</p><section><h2>1. Check publishing permission</h2><p>This checks the saved connection with Meta. It does not reconnect the account or post anything.</p><p><a href="/admin/instagram/check">Check Instagram readiness</a></p></section><section><h2>2. Prepare a post image</h2><p>Upload a JPEG up to 8 MB. A square 1080 × 1080 image is a useful starting point.</p><p>Only upload artwork intended for a public post. The uploaded image receives an unlisted link that can be opened without signing in, so Meta can fetch it. The link expires after 30 days. Uploading does not publish it.</p><form method="post" action="/admin/instagram/images" enctype="multipart/form-data"><label for="image">JPEG image</label><input id="image" name="image" type="file" accept="image/jpeg,.jpg,.jpeg" required><p><button>Prepare image — do not publish</button></p></form></section>${uploaded?'<section><h2>Image prepared</h2><p>Nothing was posted. Size: '+uploaded.width+' × '+uploaded.height+'.</p><img alt="Prepared Instagram artwork" src="/instagram-media/'+uploaded.id+'.jpg"><p>Image link:</p><code>'+BASE+'/instagram-media/'+uploaded.id+'.jpg</code></section>':''}<p>Next: once permissions pass and an image is ready, review a caption before enabling or testing publishing.</p>`);
}
export function reportPage(report){
 const yes=value=>value===true?'Yes':value===false?'No':'Not checked';
 return privatePage('Instagram readiness',`<p>${escape(report.reason)}</p><ul><li>Connection saved: ${yes(report.connectionSaved)}</li><li>Account: ${escape(report.username?'@'+report.username:'Not available')}</li><li>Authorization valid: ${yes(report.tokenValid)}</li><li>Publishing permission granted: ${yes(report.publishingPermissionGranted)}</li><li>Expected Instagram account confirmed: ${yes(report.accountVerified)}</li></ul>${report.missingPermissions?.length?'<p>Missing permissions: <code>'+escape(report.missingPermissions.join(', '))+'</code></p>':''}<p>Automatic Instagram publishing remains disabled. Nothing was posted.</p><p><a href="/admin/instagram">Prepare an image or return to Instagram preparation</a></p>`);
}
export function jpegDimensions(bytes){
 if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return null;
 let pos=2;
 while(pos+3<bytes.length){if(bytes[pos++]!==255)return null;while(bytes[pos]===255)pos++;const marker=bytes[pos++];if(marker===217||marker===218)return null;if(marker===1||(marker>=208&&marker<=215))continue;const length=(bytes[pos]<<8)|bytes[pos+1];if(length<2||pos+length>bytes.length)return null;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)return null;const height=(bytes[pos+3]<<8)|bytes[pos+4],width=(bytes[pos+5]<<8)|bytes[pos+6];return width&&height?{width,height}:null;}pos+=length;}
 return null;
}
export async function uploadInstagramImage(request,env){
 if(Number(request.headers.get('content-length'))>9*1024*1024)return privatePage('Image not saved','<p>Please use a JPEG up to 8 MB.</p>',413);
 let form;try{form=await request.formData();}catch{return privatePage('Image not saved','<p>The image could not be read.</p>',400);}
 const file=form.get('image');
 if(!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>8*1024*1024)return privatePage('Image not saved','<p>Please choose a JPEG up to 8 MB.</p>',400);
 const bytes=new Uint8Array(await file.arrayBuffer()),dimensions=jpegDimensions(bytes);
 if(!dimensions||!['image/jpeg','image/jpg'].includes(file.type))return privatePage('Image not saved','<p>This is not a valid JPEG. Please export your artwork as JPG/JPEG and try again.</p>',400);
 const id=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const statements=[env.DB.prepare('DELETE FROM instagram_media_assets WHERE expires_at<=?').bind(Date.now()),env.DB.prepare('INSERT INTO instagram_media_assets(id,mime,size,width,height,expires_at) VALUES(?,?,?,?,?,?)').bind(id,'image/jpeg',bytes.length,dimensions.width,dimensions.height,Date.now()+30*86400000)];
 for(let pos=0;pos<bytes.length;pos+=262144)statements.push(env.DB.prepare('INSERT INTO instagram_media_chunks(asset_id,part,content) VALUES(?,?,?)').bind(id,pos/262144,bytes.slice(pos,pos+262144).buffer));
 await env.DB.batch(statements);
 return new Response(null,{status:303,headers:{Location:'/admin/instagram?uploaded='+id,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
export async function serveInstagramImage(request,env){
 const match=new URL(request.url).pathname.match(/^\/instagram-media\/([a-f0-9]{64})\.jpg$/);
 if(!match)return new Response('Not found',{status:404});
 const asset=await env.DB.prepare('SELECT id,size,expires_at FROM instagram_media_assets WHERE id=? AND expires_at>?').bind(match[1],Date.now()).first();
 if(!asset)return new Response('Not found',{status:404});
 let next=0,queue=[];const total=Math.ceil(asset.size/262144);
 const stream=new ReadableStream({async pull(controller){try{if(!queue.length&&next<total){const rows=await env.DB.prepare('SELECT part,content FROM instagram_media_chunks WHERE asset_id=? AND part>=? AND part<? ORDER BY part').bind(asset.id,next,next+8).all();queue=rows.results;}const chunk=queue.shift();if(!chunk||chunk.part!==next)throw Error('Missing image data');controller.enqueue(new Uint8Array(chunk.content));next++;if(next>=total)controller.close();}catch(e){controller.error(e);}},cancel(){queue=[];}});
 return new Response(request.method==='HEAD'?null:stream,{headers:{'Content-Type':'image/jpeg','Content-Length':String(asset.size),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
