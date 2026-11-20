import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {publishTest,reviewTest,CAPTION} from '../worker/instagram-test-publish.js';
test('review is read-only; explicit test publication is idempotent and ambiguous publication is never retried',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
 try{
  const DB=await mf.getD1Database('DB');
  await DB.exec('CREATE TABLE instagram_connections(instagram_account_id TEXT,username TEXT,page_id TEXT,encrypted_access_token TEXT); INSERT INTO instagram_connections VALUES(\'123\',\'renevaservices\',\'456\',\'encrypted\');');
  for(const path of ['migrations/0001_instagram_media.sql','migrations/0002_instagram_test_posts.sql'])await DB.exec((await readFile(path,'utf8')).replace(/\n/g,' '));
  const env={DB,FACEBOOK_APP_ID:'app',FACEBOOK_APP_SECRET:'secret',FACEBOOK_TOKEN_ENCRYPTION_KEY:'key'};
  let postCount=0;let failPublish=false;let inProgress=false;
  const api=async(url,opts)=>{
   url=String(url);if(url.includes('debug_token'))return Response.json({data:{is_valid:true,app_id:'app',scopes:['instagram_basic','instagram_content_publish','pages_read_engagement']}});
   if(url.includes('/456?'))return Response.json({instagram_business_account:{id:'123'}});
   if(url.includes('media_publish')){postCount++;if(failPublish)throw Error('token secret upstream');return Response.json({id:'999'});}
   if(opts.method==='POST'){assert.equal(opts.body.get('caption'),CAPTION);return Response.json({id:'777'});}
   return Response.json({status_code:inProgress?'IN_PROGRESS':'FINISHED'});
  };
  const add=async(id)=>DB.prepare('INSERT INTO instagram_media_assets(id,mime,size,width,height,expires_at) VALUES(?,?,?,?,?,?)').bind(id,'image/jpeg',100,1080,1080,Date.now()+86400000).run();
  const request=id=>new Request('https://test/admin/instagram/publish-test',{method:'POST',body:new URLSearchParams({image:id})});
  const publish=id=>publishTest(request(id),env,async()=> 'fixture-token',api);
  const id='a'.repeat(64);await add(id);
  let page=await (await reviewTest(env,id)).text();assert.match(page,/Publish ONE test post/);assert.equal(postCount,0);
  await Promise.all([publish(id),publish(id)]);assert.equal(postCount,1);
  await publish(id);assert.equal(postCount,1);page=await (await reviewTest(env,id)).text();assert.match(page,/published successfully/);assert.doesNotMatch(page,/fixture-token|secret/);
  const other='b'.repeat(64);await add(other);failPublish=true;const failed=await publish(other);assert.equal(failed.status,502);await publish(other);assert.equal(postCount,2);assert.equal((await DB.prepare('SELECT status FROM instagram_test_posts WHERE asset_id=?').bind(other).first()).status,'review_required');
  const pending='c'.repeat(64);await add(pending);failPublish=false;inProgress=true;await publish(pending);assert.equal(postCount,2);inProgress=false;await publish(pending);assert.equal(postCount,3);
  const missing=await publish('d'.repeat(64));assert.equal(missing.status,400);assert.equal(postCount,3);
 }finally{await mf.dispose();}
});
