import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {parseSast,saveDraft,approveSchedule,cancelSchedule,runInstagramSchedule,scheduleReview} from '../worker/instagram-schedule.js';
const now=Date.parse('2026-11-21T08:00:00Z');
const req=data=>new Request('https://hub.test/admin/instagram/planner',{method:'POST',body:new URLSearchParams(data)});
test('SAST conversion is explicit and rejects invalid dates',()=>{assert.equal(parseSast('2026-11-21T10:00'),now);assert.ok(Number.isNaN(parseSast('2026-02-30T10:00')));assert.ok(Number.isNaN(parseSast('2026-11-21T10:00Z')));});
test('only reviewed schedules publish; cancellation, account mismatch, expiry and ambiguous results fail closed',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
 try{
  const DB=await mf.getD1Database('DB');await DB.exec("CREATE TABLE instagram_connections(instagram_account_id TEXT,username TEXT,page_id TEXT,encrypted_access_token TEXT); INSERT INTO instagram_connections VALUES('123','renevaservices','456','encrypted');");
  for(const path of ['migrations/0001_instagram_media.sql','migrations/0003_instagram_schedule.sql'])await DB.exec((await readFile(path,'utf8')).replace(/\n/g,' '));
  const image='a'.repeat(64);await DB.prepare('INSERT INTO instagram_media_assets(id,mime,size,width,height,expires_at) VALUES(?,?,?,?,?,?)').bind(image,'image/jpeg',100,1080,1080,now+2*86400000).run();
  const env={DB,FACEBOOK_APP_ID:'app',FACEBOOK_APP_SECRET:'secret',FACEBOOK_TOKEN_ENCRYPTION_KEY:'key'};
  let publishes=0,creates=0,fail=false,processing=false,valid=true;
  const api=async(url,opts)=>{url=String(url);
   if(url.includes('debug_token'))return Response.json({data:{is_valid:valid,app_id:'app',scopes:['instagram_basic','instagram_content_publish','pages_read_engagement']}});
   if(url.includes('/456?'))return Response.json({instagram_business_account:{id:'123'}});
   if(url.includes('media_publish')){publishes++;if(fail)throw Error('secret token upstream');return Response.json({id:'999'});}
   if(opts.method==='POST'){creates++;assert.equal(opts.body.get('caption'),'My reviewed caption');return Response.json({id:'777'});}
   return Response.json({status_code:processing?'IN_PROGRESS':'FINISHED'});
  };
  const decrypt=async()=> 'fixture-token';const run=time=>runInstagramSchedule(env,decrypt,api,time);
  const draft=async()=>{const id=crypto.randomUUID();const r=await saveDraft(req({id,image,caption:'My reviewed caption',when:'2026-11-21T10:10'}),env,now);assert.equal(r.status,303);return id;};
  const status=async id=>(await DB.prepare('SELECT status FROM instagram_scheduled_posts WHERE id=?').bind(id).first()).status;
  const approve=id=>approveSchedule(req({id}),env,decrypt,api,now);
  const first=await draft();await run(now+11*60000);assert.equal(publishes,0);assert.equal(await status(first),'draft');
  let page=await (await scheduleReview(env,first)).text();assert.match(page,/10:10/);assert.match(page,/Schedule this Instagram post/);assert.doesNotMatch(page,/fixture-token|secret/);
  await approve(first);assert.equal(await status(first),'scheduled');await run(now+9*60000);assert.equal(publishes,0);
  await Promise.all([run(now+10*60000),run(now+10*60000)]);assert.equal(publishes,1);await run(now+11*60000);assert.equal(publishes,1);assert.equal(await status(first),'published');
  const cancelled=await draft();await approve(cancelled);await cancelSchedule(req({id:cancelled}),env,now);await run(now+10*60000);assert.equal(publishes,1);assert.equal(await status(cancelled),'cancelled');
  const changed=await draft();await approve(changed);await DB.exec("UPDATE instagram_connections SET instagram_account_id='321'");await run(now+10*60000);assert.equal(publishes,1);assert.equal(await status(changed),'failed');await DB.exec("UPDATE instagram_connections SET instagram_account_id='123'");
  const interrupted=await draft();await approve(interrupted);fail=true;await run(now+10*60000);assert.equal(await status(interrupted),'review_required');await run(now+11*60000);assert.equal(publishes,2);fail=false;
  const waiting=await draft();await approve(waiting);processing=true;await run(now+10*60000);assert.equal(await status(waiting),'waiting');const before=creates;processing=false;await run(now+15*60000);assert.equal(await status(waiting),'published');assert.equal(creates,before);assert.equal(publishes,3);
  const late=await draft();await approve(late);await run(now+41*60000);assert.equal(await status(late),'failed');assert.equal(publishes,3);
  const expired=await draft();await approve(expired);await DB.prepare('UPDATE instagram_media_assets SET expires_at=? WHERE id=?').bind(now+10*60000,image).run();await run(now+10*60000);assert.equal(await status(expired),'failed');assert.equal(publishes,3);
  await DB.prepare('UPDATE instagram_media_assets SET expires_at=?').bind(now+2*86400000).run();const denied=await draft();valid=false;assert.equal((await approve(denied)).status,400);assert.equal(await status(denied),'draft');
 }finally{await mf.dispose();}
});
