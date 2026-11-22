import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {inspectInstagram,jpegDimensions,reportPage} from '../worker/instagram-tools.js';
const ig={instagram_account_id:'123',page_id:'456',username:'rene',encrypted_access_token:'encrypted-test-fixture'};
const env={FACEBOOK_APP_ID:'app-test',FACEBOOK_APP_SECRET:'app-test-secret',FACEBOOK_TOKEN_ENCRYPTION_KEY:'fixture',DB:{prepare(){return {all:async()=>({results:[ig]})};}}};
const scopes=['instagram_basic','instagram_content_publish','pages_read_engagement'];
function meta({valid=true,app='app-test',permissions=scopes,account='123',targets}={}){
 const calls=[];
 return {calls,fetch:async(url,options)=>{calls.push({url:new URL(url),options});if(String(url).includes('debug_token'))return Response.json({data:{is_valid:valid,app_id:app,scopes:permissions,granular_scopes:targets?[{scope:'instagram_content_publish',target_ids:targets}]:[]}});return Response.json({instagram_business_account:{id:account,username:'rene'}});}};
}
test('readiness checks permission and account identity without any publishing calls or credential output',async()=>{
 const api=meta();const result=await inspectInstagram(env,async()=> 'token-test',api.fetch);
 assert.equal(result.permissionCheckPassed,true);assert.equal(result.publishingEnabled,false);
 assert.equal(api.calls.length,2);assert.ok(api.calls.every(c=>!c.options.method||c.options.method==='GET'));
 const text=await reportPage(result).text();assert.doesNotMatch(text,/token-test|app-test-secret|encrypted-test-fixture/);assert.match(text,/Nothing was posted by this check/);
});
test('missing permissions, wrong app, wrong account, restricted targets and expired token fail closed',async()=>{
 for(const options of [{permissions:['instagram_basic']},{app:'wrong-app'},{valid:false},{account:'789'},{targets:['other-account']}]){
  const api=meta(options);const r=await inspectInstagram(env,async()=> 'token-test',api.fetch);assert.notEqual(r.permissionCheckPassed,true);assert.equal(r.publishingEnabled,false);
 }
 const r=await inspectInstagram(env,async()=>{throw Error('secret failure');},()=>{throw Error('unexpected fetch');});assert.doesNotMatch(JSON.stringify(r),/secret failure/);
});
test('private image upload requires owner session, enforces origin and serves only unexpired JPEG capabilities',async()=>{
 const password='local-test-only-password';
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password))),b=>b.toString(16).padStart(2,'0')).join('');
 const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'worker/index.js',compatibilityDate:'2025-09-01',d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash}});
 try{
  const db=await mf.getD1Database('DB');
  await db.exec("CREATE TABLE admin_login_attempts(ip_hash TEXT PRIMARY KEY,failed_count INTEGER,window_start INTEGER,blocked_until INTEGER); CREATE TABLE instagram_connections(instagram_account_id TEXT PRIMARY KEY,username TEXT,page_id TEXT,encrypted_access_token TEXT);");
  await db.exec((await readFile('migrations/0001_instagram_media.sql','utf8')).replace(/\n/g,' '));
  let r=await mf.dispatchFetch('https://hub.test/admin/instagram',{redirect:'manual'});assert.equal(r.status,303);
  r=await mf.dispatchFetch('https://hub.test/admin/login',{method:'POST',headers:{Origin:'https://hub.test'},body:new URLSearchParams({password}),redirect:'manual'});assert.equal(r.status,303);const cookie=r.headers.get('set-cookie').split(';')[0];
  for(const action of ['connect','confirm','schedule','cancel']) {
   const path='https://hub.test/admin/threads/'+action;
   const unauth=await mf.dispatchFetch(path,{method:'POST',headers:{Origin:'https://hub.test'},body:'id=x',redirect:'manual'});assert.equal(unauth.status,303);
   const csrf=await mf.dispatchFetch(path,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test'},body:'id=x',redirect:'manual'});assert.equal(csrf.status,403);
  }
  for(const action of ['draft','approve','cancel']) {
   const path='https://hub.test/admin/instagram/planner/'+action;
   const unauth=await mf.dispatchFetch(path,{method:'POST',headers:{Origin:'https://hub.test'},body:'id=x',redirect:'manual'});assert.equal(unauth.status,303);
   const csrf=await mf.dispatchFetch(path,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test'},body:'id=x',redirect:'manual'});assert.equal(csrf.status,403);
  }
  r=await mf.dispatchFetch('https://hub.test/admin/instagram',{headers:{Cookie:cookie}});assert.equal(r.status,200);const page=await r.text();assert.match(page,/does not publish/);assert.match(page,/instagram-image-form/);assert.match(page,/upload.js/);
  const jpeg=new Uint8Array([255,216,255,192,0,17,8,4,56,4,56,3,1,17,0,2,17,0,3,17,0,255,217]);
  assert.deepEqual(jpegDimensions(jpeg),{width:1080,height:1080});
  assert.equal(jpegDimensions(new Uint8Array([1,2,3])),null);
  const form=()=>{const f=new FormData();f.set('image',new Blob([jpeg],{type:'application/octet-stream'}),'artwork.jpg');return f;};
  const upload=async(headers)=>{const req=new Request('https://hub.test/admin/instagram/images',{method:'POST',body:form()});return mf.dispatchFetch(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type'),...headers},body:new Uint8Array(await req.arrayBuffer()),redirect:'manual'});};
  r=await upload({Origin:'https://evil.test',Cookie:cookie});assert.equal(r.status,403);
  r=await upload({Origin:'https://hub.test'});assert.equal(r.status,303);assert.match(r.headers.get('location'),/admin\/login/);
  r=await upload({Origin:'https://hub.test',Cookie:cookie});assert.equal(r.status,303,await r.clone().text());const id=new URL('https://hub.test'+r.headers.get('location')).searchParams.get('uploaded');assert.match(id,/^[a-f0-9]{64}$/);
  r=await mf.dispatchFetch('https://hub.test/instagram-media/'+id+'.jpg');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),jpeg);
  r=await mf.dispatchFetch('https://hub.test/instagram-media/'+id+'.jpg',{method:'HEAD'});assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,0);
  assert.equal((await mf.dispatchFetch('https://hub.test/instagram-media/not-an-id.jpg')).status,404);
  await db.prepare('UPDATE instagram_media_assets SET expires_at=0 WHERE id=?').bind(id).run();
  assert.equal((await mf.dispatchFetch('https://hub.test/instagram-media/'+id+'.jpg')).status,404);
 }finally{await mf.dispose();}
});

test('browser upload converts a saved PNG to JPEG before sending it',async()=>{
 const {uploadScript}=await import('../worker/instagram-upload.js');const {runInNewContext}=await import('node:vm');
 let submit,submitted,drawn=false;const button={disabled:false},status={textContent:''},location={href:''};
 const png=new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});
 const form={addEventListener:(name,fn)=>{submit=fn;},querySelector:()=>button};
 const canvas={getContext:()=>({fillRect(){},drawImage(){drawn=true;}}),toBlob:callback=>callback(new Blob(['jpeg-fixture'],{type:'image/jpeg'}))};
 const document={querySelector:selector=>selector==='#instagram-image-form'?form:selector==='#image'?{files:[png]}:status,createElement:()=>canvas};
 runInNewContext(uploadScript,{document,location,FormData,Promise,Error,createImageBitmap:async()=>({width:1254,height:1254,close(){}}),fetch:async(path,options)=>{submitted={path,options};return {redirected:true,url:'https://hub.test/admin/instagram?uploaded=fixture'};}});
 await submit({preventDefault(){}});
 assert.equal(drawn,true);assert.equal(submitted.path,'/admin/instagram/images');assert.equal(submitted.options.body.get('image').type,'image/jpeg');assert.match(location.href,/uploaded=fixture/);
});
