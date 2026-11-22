import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {draftClientPost,approveClientPost,cancelClientPost,clientReview,disconnectClient} from '../worker/client-ui.js';
import {runClientSchedule} from '../worker/client-publisher.js';
import {startClientConnection,finishClientConnection,confirmClientConnection} from '../worker/client-oauth.js';
import {THREADS_APP_ID} from '../worker/threads.js';
const now=Date.parse('2026-11-22T08:00:00Z'),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const fb='33333333-3333-4333-8333-333333333333',ig='44444444-4444-4444-8444-444444444444',th='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666';
const imageA='a'.repeat(64),imageB='b'.repeat(64);
const req=data=>{const f=new URLSearchParams();for(const [k,v] of Object.entries(data))for(const item of Array.isArray(v)?v:[v])f.append(k,item);return new Request('https://hub.test/admin/clients',{method:'POST',body:f});};
async function fixture(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});const DB=await mf.getD1Database('DB');
 await DB.exec("CREATE TABLE facebook_connections(page_id TEXT); INSERT INTO facebook_connections VALUES('111'); CREATE TABLE instagram_connections(instagram_account_id TEXT); INSERT INTO instagram_connections VALUES('112'); CREATE TABLE threads_connections(account_id TEXT); INSERT INTO threads_connections VALUES('113');");
 for(const p of ['migrations/0001_instagram_media.sql','migrations/0006_client_automation.sql','migrations/0007_client_media_expiry.sql'])await DB.exec((await readFile(p,'utf8')).replace(/\n/g,' '));
 for(const [id,name] of [[A,'Business A'],[B,'Business B']])await DB.prepare('INSERT INTO social_clients(id,name,created_at) VALUES(?,?,?)').bind(id,name,now).run();
 for(const [id,client,platform,account,page,name,token] of [[fb,A,'facebook','901','901','Page A','fb-client'],[ig,A,'instagram','902','901','@instagramA','ig-client'],[th,A,'threads','903',null,'@threadsA','th-client'],[other,B,'facebook','801','801','Page B','other-client']])await DB.prepare('INSERT INTO client_connections(id,client_id,platform,account_id,page_id,display_name,encrypted_access_token,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,client,platform,account,page,name,token,now+3*86400000,now).run();
 for(const [id,client] of [[imageA,A],[imageB,B]]){await DB.prepare('INSERT INTO instagram_media_assets(id,mime,size,width,height,expires_at) VALUES(?,?,?,?,?,?)').bind(id,'image/jpeg',100,1080,1080,now+3*86400000).run();await DB.prepare('INSERT INTO client_media VALUES(?,?)').bind(client,id).run();}
 const env={DB,FACEBOOK_APP_ID:'app',FACEBOOK_APP_SECRET:'secret',FACEBOOK_LOGIN_CONFIG_ID:'config',FACEBOOK_TOKEN_ENCRYPTION_KEY:'key',THREADS_APP_SECRET:'threads-secret'};
 let sent=[],creates=0,uncertain=false,processing=false,permissions=true;
 const api=async(url,options)=>{const u=new URL(url),path=u.pathname,token=options.headers?.Authorization?.replace('Bearer ','');
  if(path.endsWith('/oauth/access_token'))return Response.json({access_token:u.hostname==='graph.threads.com'?'short':'user-token'});
  if(path==='/access_token')return Response.json({access_token:'th-client',expires_in:60*86400});
  if(path.endsWith('/me/accounts'))return Response.json({data:[{id:'901',name:'Page A',access_token:'fb-client',instagram_business_account:{id:'902',username:'instagramA'}},{id:'111',name:'Own Page',access_token:'own-token'}]});
  if(path.endsWith('/debug_token'))return Response.json({data:{is_valid:permissions,app_id:u.hostname==='graph.threads.com'?THREADS_APP_ID:'app',scopes:['pages_manage_posts','pages_read_engagement','instagram_basic','instagram_content_publish','threads_basic','threads_content_publish'],expires_at:Math.floor(now/1000)+3*86400}});
  if(path==='/me')return Response.json({id:'903',username:'threadsA'});
  if(options.method!=='POST'&&path.endsWith('/901'))return Response.json({id:'901',name:'Page A',instagram_business_account:{id:'902',username:'instagramA'}});
  if(options.method!=='POST'&&path.endsWith('/801'))return Response.json({id:'801',name:'Page B'});
  if(options.method==='POST'&&(/\/feed$|\/photos$|\/media_publish$|\/threads_publish$/).test(path)){sent.push({path,token,body:Object.fromEntries(options.body)});if(uncertain)throw Error('upstream token secret');return Response.json({id:'999'});}
  if(options.method==='POST'&&(/\/media$|\/threads$/).test(path)){creates++;return Response.json({id:'777'});}
  if(path.endsWith('/777'))return Response.json({status:processing?'IN_PROGRESS':'FINISHED',status_code:processing?'IN_PROGRESS':'FINISHED'});
  throw Error('Unexpected fixture endpoint '+path);
 };
 return {mf,env,api,get sent(){return sent;},get creates(){return creates;},set uncertain(v){uncertain=v;},set processing(v){processing=v;},set permissions(v){permissions=v;}};
}
const draft=(f,group,targets=[fb,ig,th],asset=imageA,client=A)=>draftClientPost(req({group,connection:targets,caption:'Client approved caption',asset:asset||'',when:'2026-11-22T10:10'}),f.env,client,now);
const approve=(f,group,client=A)=>approveClientPost(req({group,approved:'yes'}),f.env,client,async t=>t,f.api,now);
test('client identity, image and review boundaries are enforced across all three publishing platforms',async()=>{
 const f=await fixture();try{
  const bad=crypto.randomUUID();assert.equal((await draft(f,bad,[other])).status,400);assert.equal((await draft(f,bad,[fb],imageB)).status,400);
  const group=crypto.randomUUID();assert.equal((await draft(f,group)).status,303);assert.equal((await draft(f,group)).status,303);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM client_posts').first()).n,3);
  assert.equal((await clientReview(f.env,B,group)).status,404);await cancelClientPost(req({group}),f.env,B,now);assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM client_posts WHERE status='draft'").first()).n,3);
  assert.equal((await approveClientPost(req({group}),f.env,A,async t=>t,f.api,now)).status,400);
  const page=await (await clientReview(f.env,A,group)).text();assert.match(page,/Business A/);assert.match(page,/Saved account ID 902/);assert.doesNotMatch(page,/fb-client|th-client|other-client/);
  await runClientSchedule(f.env,async t=>t,f.api,now+600000);assert.equal(f.sent.length,0);
  await approve(f,group);await runClientSchedule(f.env,async t=>t,f.api,now);assert.equal(f.sent.length,0);
  await Promise.all([runClientSchedule(f.env,async t=>t,f.api,now+600000),runClientSchedule(f.env,async t=>t,f.api,now+600000)]);assert.equal(f.sent.length,3);assert.deepEqual(new Set(f.sent.map(s=>s.token)),new Set(['fb-client','ig-client','th-client']));assert.ok(f.sent.every(s=>/^\/v22.0\/(901\/photos|902\/media_publish)$|^\/903\/threads_publish$/.test(s.path)));
  await runClientSchedule(f.env,async t=>t,f.api,now+900000);assert.equal(f.sent.length,3);assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM client_posts WHERE status='published'").first()).n,3);
 }finally{await f.mf.dispose();}
});
test('client connection changes, uncertain writes, waiting containers, cancellation and expiry fail safely',async()=>{
 const f=await fixture();try{
  let group=crypto.randomUUID();await draft(f,group,[fb],null);await approve(f,group);await f.env.DB.prepare('UPDATE client_connections SET version=version+1 WHERE id=?').bind(fb).run();await runClientSchedule(f.env,async t=>t,f.api,now+600000);assert.equal(f.sent.length,0);
  group=crypto.randomUUID();await draft(f,group,[fb],null);await approve(f,group);f.uncertain=true;await runClientSchedule(f.env,async t=>t,f.api,now+600000);await runClientSchedule(f.env,async t=>t,f.api,now+900000);assert.equal(f.sent.length,1);assert.equal((await f.env.DB.prepare('SELECT status FROM client_posts WHERE group_id=?').bind(group).first()).status,'review_required');f.uncertain=false;
  group=crypto.randomUUID();await draft(f,group,[ig]);await approve(f,group);f.processing=true;await runClientSchedule(f.env,async t=>t,f.api,now+600000);const creates=f.creates;f.processing=false;await runClientSchedule(f.env,async t=>t,f.api,now+900000);assert.equal(f.creates,creates);assert.equal(f.sent.length,2);
  group=crypto.randomUUID();await draft(f,group,[th],null);await approve(f,group);await cancelClientPost(req({group}),f.env,A,now);await runClientSchedule(f.env,async t=>t,f.api,now+600000);assert.equal(f.sent.length,2);
  group=crypto.randomUUID();await draft(f,group,[fb],null);f.permissions=false;assert.equal((await approve(f,group)).status,400);f.permissions=true;
  group=crypto.randomUUID();await draft(f,group,[ig]);await approve(f,group);await f.env.DB.prepare('UPDATE instagram_media_assets SET expires_at=? WHERE id=?').bind(now+600000,imageA).run();await runClientSchedule(f.env,async t=>t,f.api,now+600000);assert.equal(f.sent.length,2);
  group=crypto.randomUUID();await draft(f,group,[th],null);await approve(f,group);await disconnectClient(req({connection:th}),f.env,B,now);assert.equal((await f.env.DB.prepare('SELECT active FROM client_connections WHERE id=?').bind(th).first()).active,1);await disconnectClient(req({connection:th}),f.env,A,now);assert.equal((await f.env.DB.prepare('SELECT status FROM client_posts WHERE group_id=?').bind(group).first()).status,'cancelled');
  await f.env.DB.prepare('DELETE FROM instagram_media_assets WHERE id=?').bind(imageA).run();assert.equal(await f.env.DB.prepare('SELECT * FROM client_media WHERE asset_id=?').bind(imageA).first(),null);
 }finally{await f.mf.dispose();}
});
test('client OAuth binds state, account choices and confirmation to one client, and excludes personal accounts',async()=>{
 const f=await fixture();try{
  const start=await startClientConnection(req({platform:'facebook'}),f.env,A,now);assert.equal(start.status,200);assert.doesNotMatch(await start.text(),/threads-secret|secret\|/);
  const state=(await f.env.DB.prepare('SELECT state FROM client_oauth_states').first()).state;
  const callback=new Request('https://hub.test/api/oauth/callback/client-facebook?state='+state+'&code=fixture');
  const encrypt=async token=>'encrypted-'+token;
  const r=await finishClientConnection(callback,f.env,'facebook',encrypt,f.api,now);assert.equal(r.status,200);assert.match(await r.text(),/Continue to confirm the client account/);
  assert.equal((await finishClientConnection(callback,f.env,'facebook',encrypt,f.api,now)).status,400);
  const pending=(await f.env.DB.prepare('SELECT id,client_id,account_id FROM client_pending_connections').all()).results;assert.equal(pending.length,1);assert.equal(pending[0].account_id,'901');assert.equal(pending[0].client_id,A);
  assert.equal((await confirmClientConnection(req({pending:pending[0].id}),f.env,B,now)).status,400);
  await confirmClientConnection(req({pending:pending[0].id}),f.env,A,now);assert.equal((await f.env.DB.prepare('SELECT version FROM client_connections WHERE id=?').bind(fb).first()).version,2);
  for(const platform of ['instagram','threads']){
   await startClientConnection(req({platform}),f.env,A,now);
   const state=(await f.env.DB.prepare('SELECT state FROM client_oauth_states WHERE platform=?').bind(platform).first()).state;
   const result=await finishClientConnection(new Request('https://hub.test/api/oauth/callback/client-'+platform+'?state='+state+'&code=fixture'),f.env,platform,encrypt,f.api,now);
   assert.equal(result.status,200,await result.clone().text());
   const staged=await f.env.DB.prepare('SELECT id,account_id FROM client_pending_connections WHERE client_id=? AND platform=?').bind(A,platform).first();assert.equal(staged.account_id,platform==='instagram'?'902':'903');
   await confirmClientConnection(req({pending:staged.id}),f.env,A,now);
  }
  const own=crypto.randomUUID();await f.env.DB.prepare('INSERT INTO client_pending_connections VALUES(?,?,?,?,?,?,?,?,?)').bind(own,A,'facebook','111','111','Own Page','encrypted',now+86400000,now).run();assert.equal((await confirmClientConnection(req({pending:own}),f.env,A,now)).status,400);
 }finally{await f.mf.dispose();}
});
