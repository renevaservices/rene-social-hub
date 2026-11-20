import { inspectInstagram, instagramToolsPage, reportPage, uploadInstagramImage, serveInstagramImage } from './instagram-tools.js';
import { publishScheduledFacebookPost } from './facebook-publisher.js';


// Rene Social Hub — Facebook authorization preparation.
// Publishing deliberately remains disabled. Never put credentials in this file.
const BASE_URL = 'https://rene-social-hub-api-test.renevaservices.workers.dev';
const CALLBACK_URL = `${BASE_URL}/api/oauth/callback/facebook`;
const GRAPH_VERSION = 'v22.0';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function html(message, status = 200) {
  const safe = message.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Rene Social Hub</title><body style="font:16px system-ui;max-width:36rem;margin:10vh auto;padding:1rem"><h1>Rene Social Hub</h1><p>${safe}</p></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || '')) throw new Error('Encryption key is not a 64-character hexadecimal key');
  return Uint8Array.from(hex.match(/.{2}/g), (part) => parseInt(part, 16));
}

async function encryptToken(token, hexKey) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(hexKey), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
  const bytes = new Uint8Array(iv.length + ciphertext.length);
  bytes.set(iv);
  bytes.set(ciphertext, iv.length);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function setupAuthorized(request, env) {
  const expected = env.ADMIN_SETUP_KEY;
  const supplied = request.headers.get('Authorization');
  return typeof expected === 'string' && expected.length >= 32 && supplied === `Bearer ${expected}`;
}

async function beginFacebookConnection(request, env) {
  if (!setupAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET || !env.FACEBOOK_LOGIN_CONFIG_ID || !env.FACEBOOK_TOKEN_ENCRYPTION_KEY) {
    return json({ error: 'Facebook setup is incomplete' }, 503);
  }
  const state = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare('INSERT INTO facebook_oauth_states (state, created_at) VALUES (?, ?)')
    .bind(state, Date.now()).run();
  const params = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID,
    redirect_uri: CALLBACK_URL,
    config_id: env.FACEBOOK_LOGIN_CONFIG_ID,
    response_type: 'code',
    override_default_response_type: 'true',
    state
  });
  return json({ authorizationUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}` });
}

async function finishFacebookConnection(url, env) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (url.searchParams.has('error')) return html('Facebook authorization was cancelled. No connection was saved.', 400);
  if (!state || !code || !/^[0-9a-f-]{72,73}$/i.test(state)) return html('Missing or invalid Facebook authorization details.', 400);

  const consumed = await env.DB.prepare('DELETE FROM facebook_oauth_states WHERE state = ? AND created_at >= ? RETURNING state')
    .bind(state, Date.now() - 10 * 60 * 1000).first();
  if (!consumed) return html('This Facebook connection link is expired or has already been used.', 400);

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: env.FACEBOOK_APP_ID,
      client_secret: env.FACEBOOK_APP_SECRET,
      redirect_uri: CALLBACK_URL,
      code
    }).toString();
    const tokenResponse = await fetch(tokenUrl, { headers: { 'Cache-Control': 'no-store' } });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return html('Meta did not complete the token exchange. No connection was saved.', 400);

    const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
    pagesUrl.search = new URLSearchParams({
      fields: 'id,name,access_token,tasks',
      access_token: tokenData.access_token
    }).toString();
    const pagesResponse = await fetch(pagesUrl, { headers: { 'Cache-Control': 'no-store' } });
    const pagesData = await pagesResponse.json();
    if (!pagesResponse.ok || !Array.isArray(pagesData.data)) return html('Meta did not return your Facebook Pages. No connection was saved.', 400);
    const pages = pagesData.data.filter((page) => page.id && page.name && page.access_token);
    if (pages.length !== 1) return html('Facebook returned zero or multiple Pages. Page selection must be configured before saving a connection.', 409);
    const page = pages[0];
    const encrypted = await encryptToken(page.access_token, env.FACEBOOK_TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`INSERT INTO facebook_connections
      (id, page_id, page_name, encrypted_access_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(page_id) DO UPDATE SET
      page_name = excluded.page_name,
      encrypted_access_token = excluded.encrypted_access_token,
      updated_at = CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), page.id, page.name, encrypted).run();
    return html('Facebook Page authorization saved securely. Automatic publishing remains disabled.');
  } catch (error) {
    console.error('Facebook connection failed (details withheld)');
    return html('Facebook connection could not be completed. No publishing was enabled.', 500);
  }
}


async function decryptToken(encrypted, hexKey) {
  const bytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  if (bytes.length < 29) throw new Error('Invalid encrypted token');
  const key = await crypto.subtle.importKey('raw', hexToBytes(hexKey), 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plaintext);
}

async function resolveFacebookPageToken(db, env) {
  const connections = await db.prepare('SELECT page_id, encrypted_access_token FROM facebook_connections LIMIT 2').all();
  if (connections.results?.length !== 1) throw new Error('Exactly one Facebook Page must be connected');
  const page = connections.results[0];
  return { pageId: page.page_id, accessToken: await decryptToken(page.encrypted_access_token, env.FACEBOOK_TOKEN_ENCRYPTION_KEY) };
}

// Owner-only Instagram readiness check. Does not publish, save credentials or
// reveal the Facebook Page access token to the browser.
async function checkInstagramReadiness(request, env) {
  if (!setupAuthorized(request, env)) return json({ error: 'Owner authentication required' }, 401);
  let page;
  try { page = await resolveFacebookPageToken(env.DB, env); }
  catch { return json({ connected: false, reason: 'facebook_page_connection_missing' }, 200); }
  const endpoint = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(page.pageId)}`);
  endpoint.searchParams.set('fields', 'instagram_business_account{id,username},connected_instagram_account{id,username}');
  // Meta recommends sending tokens in an Authorization header rather than URLs.
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${page.accessToken}`, 'Cache-Control': 'no-store' }
    });
  } catch {
    return json({ connected: false, reason: 'meta_temporarily_unavailable' }, 503);
  }
  if (!response.ok) return json({ connected: false, reason: 'meta_permission_or_connection_check_failed', status: response.status }, 200);
  const data = await response.json();
  const account = data.instagram_business_account || data.connected_instagram_account;
  if (!account?.id) return json({ connected: false, reason: 'instagram_account_not_visible_to_page_token' });
  return json({
    connected: true,
    username: account.username || null,
    accountId: account.id,
    publishingReady: false,
    nextStep: 'Verify instagram_content_publish permission and image hosting before enabling posting'
  });
}



const SESSION_COOKIE = 'rene_admin_session';
const LOGIN_BASE = '/admin/login';
const LOGIN_HOME = '/admin';

function loginHtml(message = '') {
  const safe = message.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rene Social Hub — Owner Login</title><body style="font:16px system-ui;background:#071b36;color:#fff;max-width:420px;margin:12vh auto;padding:24px"><h1>Rene Social Hub</h1><p>Private owner login</p><p role="alert">${safe}</p><form method="post" action="/admin/login"><label for="password">Password</label><p><input id="password" type="password" name="password" autocomplete="current-password" required minlength="12" style="width:100%;padding:12px;box-sizing:border-box"></p><button style="padding:12px 22px;background:#e8c45b;color:#071b36;border:0;border-radius:6px">Sign in</button></form></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
function sameOrigin(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== 'null') return origin === expected;
  const referer = request.headers.get('Referer');
  if (referer) {
    try { return new URL(referer).origin === expected; }
    catch { return false; }
  }
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}
function safeEqual(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result=0; for(let i=0;i<a.length;i++)result |= a.charCodeAt(i)^b.charCodeAt(i);
  return result===0;
}
async function sha256Hex(value) {
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
async function signSession(payload,env) {
  const key=await crypto.subtle.importKey('raw',hexToBytes(env.ADMIN_PASSWORD_HASH),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('rene-admin-v1:'+payload)));
  return Array.from(sig,b=>b.toString(16).padStart(2,'0')).join('');
}
async function hasAdminSession(request,env) {
  try {
    const cookie=request.headers.get('Cookie')||'';
    const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);
    if(!token)return false;
    const [expiry,nonce,signature,...rest]=token.split('.');
    if(rest.length || !/^[0-9]{13}$/.test(expiry) || !/^[0-9a-f-]{36}$/i.test(nonce) || !/^[0-9a-f]{64}$/.test(signature))return false;
    if(Number(expiry)<Date.now() || Number(expiry)>Date.now()+31*60*1000)return false;
    return safeEqual(signature,await signSession(expiry+'.'+nonce,env));
  } catch { return false; }
}
async function adminLogin(request,env) {
  if(!sameOrigin(request))return html('Invalid login request.',403);
  if(!/^[a-f0-9]{64}$/i.test(env.ADMIN_PASSWORD_HASH||''))return html('Owner login is not configured yet.',503);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const ipHash=await sha256Hex(ip);
  const now=Date.now();
  const attempt=await env.DB.prepare('SELECT failed_count,window_start,blocked_until FROM admin_login_attempts WHERE ip_hash=?').bind(ipHash).first();
  if(attempt?.blocked_until>now)return loginHtml('Too many attempts. Please try again in 15 minutes.');
  let form;
  try { form=await request.formData(); }
  catch { return html('Login request could not be read (form).',400); }
  const password=form.get('password');
  if(typeof password!=='string' || password.length>256)return loginHtml('Invalid password.');
  let valid;
  try { valid=safeEqual(await sha256Hex(password),env.ADMIN_PASSWORD_HASH.toLowerCase()); }
  catch { return html('Password verification is unavailable (hash).',503); }
  if(!valid) {
    const within=attempt && now-attempt.window_start<15*60*1000;
    const count=within?attempt.failed_count+1:1;
    await env.DB.prepare('INSERT INTO admin_login_attempts(ip_hash,failed_count,window_start,blocked_until) VALUES(?,?,?,?) ON CONFLICT(ip_hash) DO UPDATE SET failed_count=excluded.failed_count,window_start=excluded.window_start,blocked_until=excluded.blocked_until')
      .bind(ipHash,count,within?attempt.window_start:now,count>=5?now+15*60*1000:0).run();
    return loginHtml('Incorrect password. Please try again.');
  }
  await env.DB.prepare('DELETE FROM admin_login_attempts WHERE ip_hash=?').bind(ipHash).run();
  const expiry=String(now+30*60*1000),nonce=crypto.randomUUID();
  const payload=expiry+'.'+nonce;
  let token;
  try { token=payload+'.'+await signSession(payload,env); }
  catch { return html('Session signing is unavailable (session).',503); }
  return new Response(null,{status:303,headers:{Location:LOGIN_HOME,'Set-Cookie':`${SESSION_COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`,'Cache-Control':'no-store'}});
}
function adminHome() {
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rene Social Hub Admin</title><body style="font:16px system-ui;background:#071b36;color:white;max-width:540px;margin:12vh auto;padding:24px"><h1>Rene Social Hub — Admin</h1><p>You are signed in. Instagram publishing is still disabled.</p><p><a style="color:#e8c45b" href="/admin/instagram">Check Instagram readiness and prepare images</a></p><form method="post" action="/admin/connect-instagram"><button style="padding:12px;background:#e8c45b;border:0">Connect Instagram securely</button></form><p><a style="color:#e8c45b" href="/admin/logout">Sign out</a></p></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'}});
}

const INSTAGRAM_CALLBACK_URL = `${BASE_URL}/api/oauth/callback/instagram`;
const INSTAGRAM_LOGIN_CONFIG_ID = '1416447423555854';

async function beginInstagramConnection(request, env) {
  if (!setupAuthorized(request, env)) return json({ error: 'Owner authentication required' }, 401);
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET || !env.FACEBOOK_TOKEN_ENCRYPTION_KEY)
    return json({ error: 'Meta credentials are not configured' }, 503);
  const state = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare('INSERT INTO instagram_oauth_states(state,created_at) VALUES(?,?)').bind(state, Date.now()).run();
  const params = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID, redirect_uri: INSTAGRAM_CALLBACK_URL,
    config_id: INSTAGRAM_LOGIN_CONFIG_ID, response_type: 'code',
    override_default_response_type: 'true', state
  });
  return json({ authorizationUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}` });
}

async function finishInstagramConnection(url, env) {
  if (url.searchParams.has('error')) return html('Instagram authorization was cancelled. Nothing was changed.', 400);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code || !/^[0-9a-f-]{72,73}$/i.test(state))
    return html('Invalid Instagram authorization response.', 400);
  const used = await env.DB.prepare('DELETE FROM instagram_oauth_states WHERE state = ? AND created_at >= ? RETURNING state')
    .bind(state, Date.now() - 10 * 60 * 1000).first();
  if (!used) return html('Instagram authorization expired or has already been used.', 400);
  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET,
      redirect_uri: INSTAGRAM_CALLBACK_URL, code
    }).toString();
    const tokenResponse = await fetch(tokenUrl, { headers: { 'Cache-Control': 'no-store' } });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token)
      return html('Meta did not grant Instagram access. No connection was saved.', 400);

    const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
    pagesUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username}');
    const pagesResponse = await fetch(pagesUrl, { headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Cache-Control': 'no-store' } });
    const pagesData = await pagesResponse.json();
    if (!pagesResponse.ok || !Array.isArray(pagesData.data))
      return html('Meta did not return the connected Facebook Pages.', 400);
    const expectedPage = await env.DB.prepare('SELECT page_id FROM facebook_connections LIMIT 1').first();
    const matches = pagesData.data.filter(p => p.id === expectedPage?.page_id && p.access_token && p.instagram_business_account?.id);
    if (matches.length !== 1) return html('No matching Instagram professional account was found for the connected Facebook Page. Nothing was saved.', 409);
    const page = matches[0];
    const ig = page.instagram_business_account;
    const encrypted = await encryptToken(page.access_token, env.FACEBOOK_TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`INSERT INTO instagram_connections(instagram_account_id,username,page_id,encrypted_access_token,updated_at)
      VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(instagram_account_id) DO UPDATE SET
      username=excluded.username,page_id=excluded.page_id,encrypted_access_token=excluded.encrypted_access_token,updated_at=CURRENT_TIMESTAMP`)
      .bind(ig.id, ig.username || null, page.id, encrypted).run();
    return html('Instagram account securely connected. Automatic Instagram publishing is not enabled yet.');
  } catch {
    console.error('Instagram authorization could not be completed');
    return html('Instagram connection could not be completed. Nothing was published.', 500);
  }
}

async function checkFacebookPublisher(request, env) {
  if (!setupAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);
  const row = await env.DB.prepare("SELECT id, platform, status, scheduled_at FROM scheduled_posts WHERE platform = 'facebook' ORDER BY created_at DESC LIMIT 1").first();
  return json({ publishingEnabled: false, facebookConnected: Boolean(await env.DB.prepare('SELECT id FROM facebook_connections LIMIT 1').first()), latestPost: row ?? null, mode: 'dry-run' });
}


// Secure seven-day scheduling endpoint. Requires a server-side owner session or
// the existing admin bearer key. Never put ADMIN_SETUP_KEY into browser code.
async function scheduleSevenDays(request, env) {
  if (!setupAuthorized(request, env)) return json({ error: 'Owner authentication required' }, 401);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { startDate, time, captions } = payload || {};
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !Array.isArray(captions) || captions.length !== 7 ||
      !captions.every(c => typeof c === 'string' && c.trim().length > 0 && c.length <= 5000)) {
    return json({ error: 'Provide a valid start date, SAST time and seven captions (1–5000 characters each)' }, 400);
  }
  const [y,m,d] = startDate.split('-').map(Number);
  const [hour,minute] = time.split(':').map(Number);
  const first = Date.UTC(y,m-1,d,hour-2,minute);
  const dateCheck = new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
  if (dateCheck !== startDate || first < Date.now() + 5*60*1000 || first > Date.now()+365*86400000) {
    return json({ error: 'Choose a real date at least five minutes ahead and within one year' }, 400);
  }
  // Do not schedule a second post at an occupied Facebook publishing time.
  // The existing approved week is protected by this overlap check.
  const timestamps = captions.map((_,i)=>new Date(first+i*86400000).toISOString());
  const occupied = await env.DB.prepare(
    "SELECT id,scheduled_at FROM scheduled_posts WHERE platform = 'facebook' AND status IN ('scheduled','processing','published') AND scheduled_at >= ? AND scheduled_at <= ? LIMIT 1"
  ).bind(timestamps[0],timestamps[6]).first();
  if (occupied) return json({ error: 'This date range overlaps existing Facebook posts. Choose a week without scheduled or published posts.' }, 409);
  const idPrefix = 'rene-owner-week-' + startDate + '-' + time.replace(':','');
  const statements = captions.map((caption,i) => env.DB.prepare(
    "INSERT INTO scheduled_posts(id,content,platform,scheduled_at,status) VALUES(?,?,'facebook',?,'scheduled') ON CONFLICT(id) DO NOTHING"
  ).bind(idPrefix+'-'+(i+1),caption.trim(),new Date(first+i*86400000).toISOString()));
  const results = await env.DB.batch(statements);
  const created = results.reduce((sum,result)=>sum+(result.meta?.changes || 0),0);
  return json({ ok: true, created, alreadyExists: 7-created, scheduledDates: captions.map((_,i)=>new Date(first+i*86400000).toISOString()), note: 'Existing scheduled posts are never overwritten.' }, created === 7 ? 201 : 200);
}


// Draft recurring weekly automation. OFF until a private Worker environment
// setting AUTO_WEEKLY_FACEBOOK_ENABLED is explicitly set to "true".
// No public endpoint can enable it.
const WEEKLY_CAPTIONS = [
  'Running a business is busy enough. I offer virtual administrative assistance to help keep your day-to-day work organised. Contact Rene VA Services to discuss your needs.',
  'Need help with data entry? I can organise spreadsheets, update records and assist with accurate document management for your business.',
  'Your website is often your first introduction to a customer. I offer website development and ongoing website support for small businesses.',
  'Need more time for your customers? I can help with online research, administrative tasks and business organisation.',
  'A tidy document system can save time. I provide document formatting, filing support and practical virtual administration.',
  'Keep your business moving without juggling every detail yourself. Ask me about flexible virtual assistance and website support.',
  'Planning the week ahead? I can help with data entry, documents and business administration. Email renevaservices@gmail.com.',
  'A reliable virtual assistant can help you focus on the work you enjoy. I offer remote administrative support for small businesses and entrepreneurs.',
  'From spreadsheets to everyday paperwork, I help businesses stay organised through practical data entry and administrative services.',
  'Need a clearer online presence? I can help develop or update your business website and support the details behind the scenes.',
  'Online research can take hours. I can gather and organise information so you have more time to focus on your business.',
  'Business documents deserve attention to detail. Ask Rene VA Services about formatting, organisation and administrative support.',
  'Behind every organised business are systems that work. I can help maintain records, manage documents and support everyday operations.',
  'Make next week easier with flexible virtual assistance. Reach me at renevaservices@gmail.com to discuss your admin or website needs.'
];
async function generateNaturalWeeklyCaptions(ai, weekStart) {
  if (!ai || typeof ai.run !== 'function') throw new Error('Workers AI binding unavailable');
  const prompt = `Write exactly 7 fresh, distinct Facebook posts for Rene VA Services, a small South African business run by one person. Week starting ${weekStart}.
Services: virtual assistance, documents, forms, data entry, organising business information, website development and support. Use natural first-person English as Rene ("I", "my"), friendly and down-to-earth, without sounding like an AI marketing bot.
Mix practical tips, observations and gentle invitations to enquire. Vary openings, lengths (35-85 words), topics and structure. Never invent testimonials, clients, achievements, discounts, prices, guarantees or availability. No hashtags, generic motivational slogans, em dashes, excessive emojis, or "in today's fast-paced world". Do not imply that services are free. Include renevaservices@gmail.com in no more than two posts.
Return ONLY a JSON array of seven strings, no markdown or explanation.`;
  const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{role:'system',content:'You write authentic business Facebook captions and return strict JSON only.'},{role:'user',content:prompt}],
    max_tokens: 1450, temperature: 0.8
  });
  const raw = typeof result?.response === 'string' ? result.response.trim() : '';
  const clean = raw.replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'');
  let captions;
  try { captions = JSON.parse(clean); } catch { throw new Error('AI response was not valid JSON'); }
  if (!Array.isArray(captions) || captions.length !== 7 ||
      !captions.every(c=>typeof c==='string' && c.trim().length>=90 && c.length<=1200)) {
    throw new Error('AI returned invalid weekly captions');
  }
  const normalized = captions.map(c=>c.trim());
  if (new Set(normalized.map(c=>c.toLowerCase())).size !== 7) throw new Error('AI returned duplicate captions');
  return normalized;
}
async function prepareNextFacebookWeek(db, scheduledTime, ai) {
  // Johannesburg has a fixed UTC+02:00 offset year-round.
  const local = new Date(scheduledTime + 2 * 3600000);
  if (local.getUTCDay() !== 0) return { prepared: 0, reason: 'not_sunday' };
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()+1, 7, 0);
  const end = new Date(monday+6*86400000).toISOString();
  const beginning = new Date(monday).toISOString();
  const occupied = await db.prepare(
    "SELECT id FROM scheduled_posts WHERE platform = 'facebook' AND status IN ('scheduled','processing','published') AND scheduled_at >= ? AND scheduled_at <= ? LIMIT 1"
  ).bind(beginning,end).first();
  if (occupied) return { prepared: 0, reason: 'week_already_occupied' };
  const weekIndex = Math.floor(monday/(7*86400000));
  // If AI fails, keep the existing approved captions as a safe fallback.
  let captions;
  try { captions = await generateNaturalWeeklyCaptions(ai, new Date(monday).toISOString().slice(0,10)); }
  catch (error) { console.warn('Weekly AI generation unavailable; using approved fallback'); captions = WEEKLY_CAPTIONS.slice((weekIndex%2)*7, (weekIndex%2+1)*7); }
  const rows = captions.map((caption,i) => db.prepare(
    "INSERT OR IGNORE INTO scheduled_posts(id,content,platform,scheduled_at,status) VALUES(?,?,'facebook',?,'scheduled')"
  ).bind('rene-auto-week-'+new Date(monday).toISOString().slice(0,10)+'-'+(i+1),caption,new Date(monday+i*86400000).toISOString()));
  const results = await db.batch(rows);
  return { prepared: results.reduce((n,x)=>n+(x.meta?.changes||0),0) };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (['GET','HEAD'].includes(request.method) && url.pathname.startsWith('/instagram-media/')) {
      try { return await serveInstagramImage(request,env); } catch { return new Response('Image unavailable',{status:503}); }
    }
    if (url.pathname === '/admin/instagram' || url.pathname.startsWith('/admin/instagram/')) {
      if (!await hasAdminSession(request,env)) return Response.redirect(BASE_URL+'/admin/login',303);
      try {
        if (request.method==='GET' && url.pathname==='/admin/instagram') return await instagramToolsPage(env,url.searchParams.get('uploaded')||'');
        if (request.method==='GET' && url.pathname==='/admin/instagram/check') return reportPage(await inspectInstagram(env,decryptToken));
        if (request.method==='POST' && url.pathname==='/admin/instagram/images') {
          if(!sameOrigin(request))return html('Invalid request origin.',403);
          return await uploadInstagramImage(request,env);
        }
        return html('Not found.',404);
      } catch { return html('Instagram preparation is temporarily unavailable. Nothing was posted.',503); }
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ service: 'rene-social-hub-api', status: 'prototype', publishingEnabled: false });
    }

    if (request.method === 'GET' && url.pathname === '/db-test') {
      try {
        const result = await env.DB.prepare('SELECT COUNT(*) AS total FROM scheduled_posts').first();
        return json({ database: 'connected', scheduledPosts: result.total });
      } catch (error) {
        console.error('Database test failed');
        return json({ database: 'error', message: 'Database test failed' }, 500);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/oauth/start/facebook') {
      try { return await beginFacebookConnection(request, env); }
      catch (error) { console.error('Facebook setup could not start'); return json({ error: 'Facebook setup could not start' }, 500); }
    }

    if (request.method === 'GET' && url.pathname === '/api/oauth/callback/facebook') {
      try { return await finishFacebookConnection(url, env); }
      catch (error) { console.error('Facebook callback failed'); return html('Facebook connection could not be completed.', 500); }
    }

    if (request.method === 'GET' && url.pathname === '/admin/login') return loginHtml();
    if (request.method === 'POST' && url.pathname === '/admin/login') {
      try { return await adminLogin(request,env); }
      catch (error) { console.error('Admin login failure', error?.name || 'unknown'); return html('Login is temporarily unavailable (' + (error?.name === 'TypeError' ? 'request' : error?.name === 'D1_ERROR' ? 'database' : 'server') + ').',503); }
    }
    if (request.method === 'GET' && url.pathname === '/admin') {
      return (await hasAdminSession(request,env)) ? adminHome() : Response.redirect(BASE_URL+'/admin/login',303);
    }
    if (request.method === 'GET' && url.pathname === '/admin/logout') {
      return new Response(null,{status:303,headers:{Location:'/admin/login','Set-Cookie':'rene_admin_session=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0','Cache-Control':'no-store'}});
    }
    if (request.method === 'POST' && url.pathname === '/admin/connect-instagram') {
      if(!sameOrigin(request))return html('Invalid request origin.',403);
      if(!await hasAdminSession(request,env))return Response.redirect(BASE_URL+'/admin/login',303);
      try {
        const response=await beginInstagramConnection(new Request(request.url,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_SETUP_KEY}}),env);
        const result=await response.json();
        if(!response.ok || !result.authorizationUrl)return html('Instagram connection could not start.',503);
        const safeUrl = result.authorizationUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Instagram — Rene Social Hub</title><body style="font:16px system-ui;background:#071b36;color:#fff;max-width:540px;margin:12vh auto;padding:24px"><h1>Continue to Meta</h1><p>Your secure connection request is ready. Select the link below to open Meta's authorization screen.</p><p><a href="${safeUrl}" rel="noreferrer" style="display:inline-block;padding:12px 18px;background:#e8c45b;color:#071b36;border-radius:6px">Continue to Meta</a></p><p>Do not approve permissions until you have checked them.</p></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
      } catch { return html('Instagram connection could not start.',503); }
    }

    if (request.method === 'POST' && url.pathname === '/api/oauth/start/instagram') {
      try { return await beginInstagramConnection(request, env); }
      catch { return json({ error: 'Instagram authorization could not start' }, 500); }
    }
    if (request.method === 'GET' && url.pathname === '/api/oauth/callback/instagram') {
      try { return await finishInstagramConnection(url, env); }
      catch { return html('Instagram authorization failed safely.', 500); }
    }

    if (request.method === 'GET' && url.pathname === '/api/platforms/instagram/readiness') {
      try { return await checkInstagramReadiness(request, env); }
      catch { return json({ error: 'Instagram readiness check failed' }, 503); }
    }

    if (request.method === 'GET' && url.pathname === '/api/platforms/status') {
      try {
        const connection = await env.DB.prepare('SELECT id FROM facebook_connections LIMIT 1').first();
        return new Response(JSON.stringify({
          facebook: { connectionSaved: Boolean(connection), publishingEnabled: false, tokenVerified: false },
          instagram: { connectionSaved: false },
          threads: { connectionSaved: false }
        }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://renevaservices.github.io', 'Cache-Control': 'no-store' } });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Status temporarily unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://renevaservices.github.io', 'Cache-Control': 'no-store' } });
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/platforms/facebook/verify') {
      const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://renevaservices.github.io', 'Cache-Control': 'no-store' };
      try {
        const { pageId, accessToken } = await resolveFacebookPageToken(env.DB, env);
        const endpoint = new URL('https://graph.facebook.com/v22.0/debug_token');
        endpoint.searchParams.set('input_token', accessToken);
        endpoint.searchParams.set('access_token', env.FACEBOOK_APP_ID + '|' + env.FACEBOOK_APP_SECRET);
        const result = await fetch(endpoint.toString(), { method: 'GET', signal: AbortSignal.timeout(10000) });
        const payload = await result.json();
        const info = payload?.data;
        const valid = Boolean(result.ok && info?.is_valid);
        const scopes = Array.isArray(info?.scopes) ? info.scopes : [];
        const hasPublishScope = scopes.includes('pages_manage_posts') || scopes.includes('publish_pages');
        const pageMatches = String(info?.profile_id || info?.user_id || '') === String(pageId);
        return new Response(JSON.stringify({
          tokenValid: valid,
          publishScopeGranted: valid && hasPublishScope,
          pageIdentityConfirmed: valid && pageMatches,
          publishingEnabled: false,
          verificationCompleted: Boolean(result.ok && info),
          note: 'This read-only check does not publish a post.'
        }), { headers });
      } catch (error) {
        return new Response(JSON.stringify({ tokenValid: false, publishScopeGranted: false, verificationCompleted: false, publishingEnabled: false, note: 'Verification unavailable; no post was sent.' }), { status: 503, headers });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/schedule/facebook/week') {
      try { return await scheduleSevenDays(request, env); }
      catch (error) { console.error('Seven-day scheduling failed'); return json({ error: 'Scheduling unavailable; no confirmation issued' }, 503); }
    }

    if (request.method === 'GET' && url.pathname === '/api/publishing/facebook/check') {
      return checkFacebookPublisher(request, env);
    }

    return json({ error: 'Not implemented', publishingEnabled: false }, 501);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_at <= ?"
      ).bind(new Date(event.scheduledTime).toISOString()).first();
      console.log('Rene Social Hub scheduled check', { duePosts: result.total, publishingEnabled: env.AUTO_WEEKLY_FACEBOOK_ENABLED === 'true' });
      if (env.AUTO_WEEKLY_FACEBOOK_ENABLED !== 'true') return;
      const prepared = await prepareNextFacebookWeek(env.DB, event.scheduledTime, env.AI);
      console.log('Weekly Facebook planning', prepared);
      const due = await env.DB.prepare(
        "SELECT id FROM scheduled_posts WHERE platform = 'facebook' AND status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 7"
      ).bind(new Date(event.scheduledTime).toISOString()).all();
      for (const post of due.results || []) {
        const outcome = await publishScheduledFacebookPost({
          db: env.DB, postId: post.id,
          resolvePageAccessToken: db => resolveFacebookPageToken(db, env),
          enabled: true
        });
        console.log('Recurring Facebook publishing', { id: post.id, ok: outcome.ok, reason: outcome.reason || null });
      }
    })());
  }
};

