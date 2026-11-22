import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
test('expired sessions return to Threads after login and reject untrusted redirects',async()=>{
 const password='valid-short';const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password))),b=>b.toString(16).padStart(2,'0')).join('');
 const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'worker/index.js',compatibilityDate:'2025-09-01',d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash}});
 try{
  const db=await mf.getD1Database('DB');await db.exec('CREATE TABLE admin_login_attempts(ip_hash TEXT PRIMARY KEY,failed_count INTEGER,window_start INTEGER,blocked_until INTEGER)');
  let r=await mf.dispatchFetch('https://hub.test/admin/threads',{redirect:'manual'});assert.equal(r.status,303);assert.match(r.headers.get('location'),/next=%2Fadmin%2Fthreads/);
  r=await mf.dispatchFetch('https://hub.test/admin/login?next=%2Fadmin%2Fthreads');const loginPage=await r.text();assert.match(loginPage,/name="next" value="\/admin\/threads"/);assert.doesNotMatch(loginPage,/minlength/);
  r=await mf.dispatchFetch('https://hub.test/admin/login',{method:'POST',headers:{Origin:'https://hub.test'},body:new URLSearchParams({password,next:'/admin/threads'}),redirect:'manual'});assert.equal(r.headers.get('location'),'/admin/session?next=%2Fadmin%2Fthreads');const cookie=r.headers.get('set-cookie').split(';')[0];
  r=await mf.dispatchFetch('https://hub.test/admin/session?next=%2Fadmin%2Fthreads',{headers:{Cookie:cookie},redirect:'manual'});assert.equal(r.headers.get('location'),'/admin/threads');
  r=await mf.dispatchFetch('https://hub.test/admin/session?next=%2Fadmin%2Fthreads',{redirect:'manual'});assert.equal(r.status,200);assert.match(await r.text(),/did not keep the sign-in session/);
  r=await mf.dispatchFetch('https://hub.test/admin/login?next=%2Fadmin%2Fthreads',{headers:{Cookie:cookie},redirect:'manual'});assert.equal(r.headers.get('location'),'/admin/threads');
  for(const next of ['https://evil.test','//evil.test','/admin/logout','/admin/threads/connect','/admin/threads?x=<script>']){
   r=await mf.dispatchFetch('https://hub.test/admin/login',{method:'POST',headers:{Origin:'https://hub.test'},body:new URLSearchParams({password,next}),redirect:'manual'});assert.equal(r.headers.get('location'),'/admin/session?next=%2Fadmin');
  }
  r=await mf.dispatchFetch('https://hub.test/admin/login',{method:'POST',headers:{Origin:'https://hub.test'},body:new URLSearchParams({password:'incorrect',next:'/admin/threads'}),redirect:'manual'});assert.match(await r.text(),/name="next" value="\/admin\/threads"/);
 }finally{await mf.dispose();}
});
