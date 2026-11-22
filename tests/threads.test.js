import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {THREADS_CALLBACK,THREADS_APP_ID,startThreads,finishThreads,confirmThreads,scheduleThreads,cancelThreads,runThreadsSchedule,threadsPage} from '../worker/threads.js';
const now=Date.parse('2026-11-22T07:00:00Z');
const req=data=>new Request('https://hub.test/admin/threads',{method:'POST',body:new URLSearchParams(data)});
async function fixture(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});const DB=await mf.getD1Database('DB');
 await DB.exec('CREATE TABLE scheduled_posts(id TEXT PRIMARY KEY,content TEXT,platform TEXT,scheduled_at TEXT,status TEXT,published_at TEXT,error_message TEXT);');
 await DB.exec((await readFile('migrations/0004_threads.sql','utf8')).replace(/\n/g,' '));
 const env={DB,THREADS_APP_SECRET:'test-secret-never-return',FACEBOOK_TOKEN_ENCRYPTION_KEY:'fixture-key'};
 let publishes=0,creates=0,invalid=false,uncertain=false,processing=false;
 const api=async(url,options)=>{url=String(url);
  if(url.includes('oauth/access_token'))return Response.json({access_token:'short-token'});
  if(url.includes('/access_token?')){assert.equal(new URL(url).searchParams.get('access_token'),'short-token');return Response.json({access_token:'long-token',expires_in:60*86400});}
  if(url.includes('debug_token'))return Response.json({data:{is_valid:!invalid,app_id:THREADS_APP_ID,user_id:'123',scopes:['threads_basic','threads_content_publish'],expires_at:Math.floor(now/1000)+60*86400}});
  if(url.includes('me?'))return Response.json({id:'123',username:'renevaservices'});
  if(url.includes('threads_publish')){publishes++;if(uncertain)throw Error('test-secret-never-return');return Response.json({id:'999'});}
  if(options.method==='POST'){creates++;assert.equal(options.body.get('media_type'),'TEXT');return Response.json({id:'777'});}
  return Response.json({status:processing?'IN_PROGRESS':'FINISHED'});
 };
 return {mf,env,api,get publishes(){return publishes;},get creates(){return creates;},set invalid(v){invalid=v;},set uncertain(v){uncertain=v;},set processing(v){processing=v;}};
}
test('Threads OAuth consumes state once and stages encrypted credentials for explicit owner confirmation',async()=>{
 const f=await fixture();try{
  const text=await (await startThreads(f.env,now)).text();assert.match(text,/www.threads.com/);assert.match(text,/threads_content_publish/);assert.doesNotMatch(text,/test-secret-never-return/);
  const state=(await f.env.DB.prepare('SELECT state FROM threads_oauth_states').first()).state;
  const callback=new Request(THREADS_CALLBACK+'?state='+state+'&code=fixture-code');let encrypts=0;
  const encrypt=async(token,key)=>{assert.equal(token,'long-token');assert.equal(key,'fixture-key');encrypts++;return 'encrypted-fixture';};
  assert.equal((await finishThreads(callback,f.env,encrypt,f.api,now)).status,303);assert.equal(encrypts,1);
  assert.equal(await f.env.DB.prepare('SELECT * FROM threads_connections').first(),null);
  const pending=await f.env.DB.prepare('SELECT * FROM threads_pending_connections').first();assert.equal(pending.encrypted_access_token,'encrypted-fixture');
  assert.equal((await finishThreads(callback,f.env,encrypt,f.api,now)).status,400);assert.equal(encrypts,1);
  const page=await (await threadsPage(f.env,now)).text();assert.match(page,/Confirm the Threads account/);assert.doesNotMatch(page,/encrypted-fixture|long-token|test-secret-never-return/);
  await confirmThreads(req({pending:pending.id}),f.env,now);assert.equal((await f.env.DB.prepare('SELECT username FROM threads_connections').first()).username,'renevaservices');assert.equal(f.publishes,0);
  assert.equal((await finishThreads(new Request(THREADS_CALLBACK+'?state=bad&code=x'),f.env,encrypt,f.api,now)).status,400);
 }finally{await f.mf.dispose();}
});
test('Threads requires approved drafts and current account, handles processing, and never retries ambiguous publication',async()=>{
 const f=await fixture();try{
  await f.env.DB.prepare('INSERT INTO threads_connections VALUES(1,?,?,?,?,?)').bind('123','renevaservices','encrypted',now+60*86400000,now).run();
  const draft=async id=>f.env.DB.prepare('INSERT INTO scheduled_posts(id,content,platform,scheduled_at,status) VALUES(?,?,?,?,?)').bind(id,'My Threads caption','threads',new Date(now+600000).toISOString(),'draft').run();
  const decrypt=async()=> 'long-token';const schedule=id=>scheduleThreads(req({post:id}),f.env,decrypt,f.api,now);const run=time=>runThreadsSchedule(f.env,decrypt,f.api,time);
  const status=async id=>(await f.env.DB.prepare('SELECT status FROM scheduled_posts WHERE id=?').bind(id).first()).status;
  await draft('first');await run(now+600000);assert.equal(f.publishes,0);await schedule('first');await run(now);assert.equal(f.publishes,0);
  await Promise.all([run(now+600000),run(now+600000)]);assert.equal(f.publishes,1);assert.equal(await status('first'),'published');await run(now+900000);assert.equal(f.publishes,1);
  await draft('cancel');await schedule('cancel');await cancelThreads(req({post:'cancel'}),f.env,now);await run(now+600000);assert.equal(await status('cancel'),'cancelled');assert.equal(f.publishes,1);
  await draft('uncertain');await schedule('uncertain');f.uncertain=true;await run(now+600000);await run(now+900000);assert.equal(f.publishes,2);assert.equal(await status('uncertain'),'failed');assert.equal((await f.env.DB.prepare('SELECT status FROM threads_publish_jobs WHERE post_id=?').bind('uncertain').first()).status,'review_required');f.uncertain=false;
  await draft('processing');await schedule('processing');f.processing=true;await run(now+600000);const creates=f.creates;f.processing=false;await run(now+900000);assert.equal(f.creates,creates);assert.equal(f.publishes,3);
  await draft('mismatch');await schedule('mismatch');await f.env.DB.exec("UPDATE threads_connections SET account_id='321'");await run(now+600000);assert.equal(await status('mismatch'),'failed');assert.equal(f.publishes,3);await f.env.DB.exec("UPDATE threads_connections SET account_id='123'");
  await draft('permissions');f.invalid=true;assert.equal((await schedule('permissions')).status,400);assert.equal(await status('permissions'),'draft');f.invalid=false;
  await draft('late');await schedule('late');await run(now+41*60000);assert.equal(await status('late'),'failed');assert.equal(f.publishes,3);
 }finally{await f.mf.dispose();}
});
