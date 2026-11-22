import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
test('expired sessions return to Threads after login and reject untrusted redirects',async()=>{
 const password='valid-short';const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password))),b=>b.toString(16).padStart(2,'0')).join('');
 const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'worker/index.js',compatibilityDate:'2025-09-01',d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash}});
 try{
  const db=await mf.getD1Database('DB');await db.exec('CREATE TABLE admin_login_attempts(ip_hash TEXT PRIMARY KEY,failed_count INTEGER,window_start INTEGER,blocked_until INTEGER)');
  await db.exec((await readFile('migrations/0005_login_events.sql','utf8')).replace(/\n/g,' '));
  let r=await mf.dispatchFetch('https://hub.test/admin/threads',{redirect:'manual'});assert.equal(r.status,303);assert.match(r.headers.get('location'),/next=%2Fadmin%2Fthreads/);
  r=await mf.dispatchFetch('https://hub.test/admin/login?next=%2Fadmin%2Fthreads');const loginPage=await r.text();assert.match(loginPage,/name="next" value="\/admin\/threads"/);assert.doesNotMatch(loginPage,/minlength/);
  r=await mf.dispatchFetch('https://hub.test/admin/login',{method:'POST',headers:{Origin:'https://hub.test'},body:new URLSearchParams({password,next:'/admin/threads'}),redirect:'manual'});assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.match(await r.text(),/Continue to Threads/);const cookie=r.headers.get('set-cookie').split(';')[0];
  r=await mf.dispatchFetch('https://hub.test/admin/session?next=%2Fadmin%2Fthreads',{headers:{Cookie:cookie},redirect:'manual'});assert.equal(r.headers.get('location'),'/admin/threads');
  r=await mf.dispatchFetch('https://hub.test/admin/session?next=%2Fadmin%2Fthreads',{redirect:'manual'});assert.equal(r.status,200);assert.match(await r.text(),/did not keep the sign-in session/);
  r=await mf.dispatchFetch('https://hub.test/admin/login?next=%2Fadmin%2Fthreads',{headers:{Cookie:cookie},redirect:'manual'});assert.equal(r.headers.get('location'),'/admin/threads');
  for(const next of ['https://evil.test','//evil.test','/admin/logout','/admin/threads/connect','/admin/threads?x=<script>']){
   r=await mf.dispatchFetch('https://hub.test/admin/login',{method:'POST',headers:{Origin:'https://hub.test'},body:new URLSearchParams({password,next}),redirect:'manual'});assert.equal(r.status,200);assert.match(await r.text(),/Continue to Admin/);
  }
  r=await mf.dispatchFetch('https://hub.test/admin/login',{method:'POST',headers:{Origin:'https://hub.test'},body:new URLSearchParams({password:'incorrect',next:'/admin/threads'}),redirect:'manual'});assert.match(await r.text(),/name="next" value="\/admin\/threads"/);
  const trace=await db.prepare('SELECT stage,cookie_present FROM admin_login_events ORDER BY created_at').all();assert.ok(trace.results.some(e=>e.stage==='password_accepted'));assert.ok(trace.results.some(e=>e.stage==='session_valid'&&e.cookie_present===1));assert.ok(trace.results.some(e=>e.stage==='session_missing'&&e.cookie_present===0));assert.doesNotMatch(JSON.stringify(trace.results),/valid-short|rene_admin_session=/);
 }finally{await mf.dispose();}
});
