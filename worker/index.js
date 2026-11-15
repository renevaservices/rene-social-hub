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

async function checkFacebookPublisher(request, env) {
  if (!setupAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);
  const row = await env.DB.prepare("SELECT id, platform, status, scheduled_at FROM scheduled_posts WHERE platform = 'facebook' ORDER BY created_at DESC LIMIT 1").first();
  return json({ publishingEnabled: false, facebookConnected: Boolean(await env.DB.prepare('SELECT id FROM facebook_connections LIMIT 1').first()), latestPost: row ?? null, mode: 'dry-run' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
      console.log('Rene Social Hub scheduled check', { duePosts: result.total, publishingEnabled: false });
      // Safety gate: do not call publishScheduledFacebookPost until explicit approval
      // and a controlled, reviewed production release.
    })());
  }
};
