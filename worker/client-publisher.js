import {CLIENT_BASE,clientApi,verifyClientAccount} from './client-api.js';
export async function runClientSchedule(env,decrypt,fetchImpl=fetch,now=Date.now()){
 await env.DB.prepare("UPDATE client_posts SET status='review_required',error_message='An interrupted request needs review. Check the destination before preparing another copy.',updated_at=? WHERE status IN ('preparing','checking','publishing') AND updated_at<?").bind(now,now-600000).run();
 const due=(await env.DB.prepare("SELECT id FROM client_posts WHERE status IN ('scheduled','waiting') AND scheduled_at<=? ORDER BY scheduled_at LIMIT 3").bind(now).all()).results;
 for(const item of due){
  const p=await env.DB.prepare("UPDATE client_posts SET status=CASE WHEN status='scheduled' THEN 'preparing' ELSE 'checking' END,updated_at=? WHERE id=? AND status IN ('scheduled','waiting') AND scheduled_at<=? RETURNING *").bind(now,item.id,now).first();if(!p)continue;
  const save=(status,message=null,container=null,media=null)=>env.DB.prepare('UPDATE client_posts SET status=?,error_message=?,container_id=COALESCE(?,container_id),media_id=COALESCE(?,media_id),updated_at=? WHERE id=? AND client_id=?').bind(status,message,container,media,now,p.id,p.client_id).run();
  const connection=()=>env.DB.prepare('SELECT c.* FROM client_connections c JOIN social_clients b ON b.id=c.client_id AND b.active=1 WHERE c.id=? AND c.client_id=? AND c.active=1 AND c.account_id=? AND c.version=?').bind(p.connection_id,p.client_id,p.account_id,p.connection_version).first();
  let publishing=false;
  try{
   if(now-p.scheduled_at>1800000){await save('failed','The post missed its time by more than 30 minutes. Prepare a new schedule if still relevant.');continue;}
   const c=await connection();if(!c||c.platform!==p.platform||c.expires_at<=now+60000){await save('failed','The client account changed, was disconnected, or its authorization expired. Review a new schedule.');continue;}
   let image=null;if(p.asset_id){image=await env.DB.prepare('SELECT a.id,a.width,a.height FROM instagram_media_assets a JOIN client_media m ON m.asset_id=a.id WHERE m.client_id=? AND a.id=? AND a.expires_at>?').bind(p.client_id,p.asset_id,now+600000).first();if(!image)throw Error('Client image unavailable');}
   if(p.platform==='instagram'&&(!image||image.width/image.height<0.8||image.width/image.height>1.91))throw Error('Instagram image required');
   const token=await decrypt(c.encrypted_access_token,env.FACEBOOK_TOKEN_ENCRYPTION_KEY);await verifyClientAccount(env,c,token,fetchImpl,now);
   const imageUrl=image?CLIENT_BASE+'/instagram-media/'+image.id+'.jpg':null;
   let container=p.container_id;
   if(p.platform!=='facebook'){
    if(!container){const body=p.platform==='threads'?{media_type:image?'IMAGE':'TEXT',text:p.caption,...(image?{image_url:imageUrl}:{})}:{image_url:imageUrl,caption:p.caption};const made=await clientApi(p.platform,encodeURIComponent(p.account_id)+(p.platform==='threads'?'/threads':'/media'),token,fetchImpl,body);if(!/^\d+$/.test(String(made.id||'')))throw Error('Missing container');container=String(made.id);await save('checking',null,container);}
    const data=await clientApi(p.platform,encodeURIComponent(container)+'?fields='+(p.platform==='threads'?'status':'status_code'),token,fetchImpl);const status=p.platform==='threads'?data.status:data.status_code;
    if(status==='IN_PROGRESS'){await save('waiting');continue;}if(status!=='FINISHED')throw Error('Container not ready');
   }
   const current=await connection();if(!current||current.encrypted_access_token!==c.encrypted_access_token)throw Error('Client connection changed');
   await save('publishing');publishing=true;
   const path=p.platform==='facebook'?encodeURIComponent(p.account_id)+(image?'/photos':'/feed'):encodeURIComponent(p.account_id)+(p.platform==='threads'?'/threads_publish':'/media_publish');
   const body=p.platform==='facebook'?(image?{url:imageUrl,caption:p.caption,published:'true'}:{message:p.caption}):{creation_id:container};
   const sent=await clientApi(p.platform,path,token,fetchImpl,body);const media=String(sent.post_id||sent.id||'');if(!/^[0-9_]+$/.test(media))throw Error('Unconfirmed publication');
   await save('published',null,null,media);
  }catch{await save(publishing?'review_required':'failed',publishing?'Publication could not be confirmed. Check this client’s destination account before creating another copy. No automatic retry will run.':'The client account, image or platform preparation needs attention. No automatic publication retry will run.');}
 }
}
