// Rene Social Hub: Facebook OAuth preparation. Publishing remains disabled.
// Deploy only after reviewing environment bindings and database schema.
const GRAPH = "v22.0";
const ORIGIN = "https://rene-social-hub-api-test.renevaservices.workers.dev";
const CALLBACK = ORIGIN + "/api/oauth/callback/facebook";
const UUID_PAIR = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function html(message, status = 200) {
  return new Response("<!doctype html><meta charset=utf-8><title>Rene Social Hub</title><h1>Rene Social Hub</h1><p>" + message + "</p>", {
    status, headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"
    }
  });
}
function keyBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || "")) throw new Error("Encryption key misconfigured");
  return Uint8Array.from(hex.match(/../g), h => parseInt(h, 16));
}
async function encryptToken(token, hexKey) {
  const key = await crypto.subtle.importKey("raw", keyBytes(hexKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  const result = new Uint8Array(iv.length + encrypted.length);
  result.set(iv);
  result.set(encrypted, iv.length);
  let binary = "";
  for (const byte of result) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function authorized(request, env) {
  const secret = env.ADMIN_SETUP_KEY;
  return typeof secret === "string" && secret.length >= 32 &&
    request.headers.get("Authorization") === "Bearer " + secret;
}
async function startFacebook(request, env) {
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB || !env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET ||
      !env.FACEBOOK_LOGIN_CONFIG_ID || !env.FACEBOOK_TOKEN_ENCRYPTION_KEY) {
    return json({ error: "Facebook configuration incomplete" }, 503);
  }
  const state = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare("INSERT INTO facebook_oauth_states (state, created_at) VALUES (?, ?)")
    .bind(state, Date.now()).run();
  const params = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID, redirect_uri: CALLBACK,
    config_id: env.FACEBOOK_LOGIN_CONFIG_ID, response_type: "code",
    override_default_response_type: "true", state
  });
  return json({ authorizationUrl: "https://www.facebook.com/" + GRAPH + "/dialog/oauth?" + params.toString() });
}
async function finishFacebook(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error")) return html("Facebook authorization was cancelled.", 400);
  if (!state || !code || !UUID_PAIR.test(state)) return html("Missing or invalid Facebook authorization details.", 400);
  // Delete state exactly once, with a 10-minute expiry. Never log authorization codes or tokens.
  const used = await env.DB.prepare(
    "DELETE FROM facebook_oauth_states WHERE state = ? AND created_at >= ? RETURNING state"
  ).bind(state, Date.now() - 600000).first();
  if (!used) return html("Authorization expired or already used.", 400);
  try {
    const exchange = await fetch("https://graph.facebook.com/" + GRAPH + "/oauth/access_token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET,
        redirect_uri: CALLBACK, code
      })
    });
    const token = await exchange.json();
    if (!exchange.ok || !token.access_token) return html("Facebook token exchange failed.", 400);
    const pagesRequest = new URL("https://graph.facebook.com/" + GRAPH + "/me/accounts");
    pagesRequest.searchParams.set("fields", "id,name,access_token,tasks");
    const pagesResponse = await fetch(pagesRequest, {
      headers: { Authorization: "Bearer " + token.access_token }
    });
    const data = await pagesResponse.json();
    if (!pagesResponse.ok || !Array.isArray(data.data)) return html("Unable to retrieve Facebook Pages.", 400);
    // Avoid silently connecting an arbitrary Page if the account manages several.
    const pages = data.data.filter(p => p.id && p.name && p.access_token);
    if (pages.length !== 1) return html("Zero or multiple Pages returned. Page selection is required.", 409);
    const page = pages[0];
    const ciphertext = await encryptToken(page.access_token, env.FACEBOOK_TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(
      "INSERT INTO facebook_connections (id,page_id,page_name,encrypted_access_token,created_at,updated_at) " +
      "VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(page_id) DO UPDATE SET page_name=excluded.page_name, " +
      "encrypted_access_token=excluded.encrypted_access_token,updated_at=CURRENT_TIMESTAMP"
    ).bind(crypto.randomUUID(), page.id, page.name, ciphertext).run();
    return html("Facebook Page connection saved. Automatic publishing remains disabled.");
  } catch (_) {
    console.error("Facebook callback failed (sensitive details withheld)");
    return html("Facebook connection could not be completed.", 500);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ service: "rene-social-hub-api", status: "prototype", publishingEnabled: false });
    }
    if (request.method === "GET" && url.pathname === "/db-test") {
      try {
        const result = await env.DB.prepare("SELECT COUNT(*) AS total FROM scheduled_posts").first();
        return json({ database: "connected", scheduledPosts: result.total });
      } catch (_) {
        console.error("Database check failed");
        return json({ database: "error", message: "Database test failed" }, 500);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/oauth/start/facebook") {
      try { return await startFacebook(request, env); }
      catch (_) { console.error("Facebook OAuth start failed"); return json({ error: "Facebook authorization could not start" }, 500); }
    }
    if (request.method === "GET" && url.pathname === "/api/oauth/callback/facebook") {
      try { return await finishFacebook(request, env); }
      catch (_) { console.error("Facebook OAuth callback failed"); return html("Facebook connection failed.", 500); }
    }
    return json({ error: "Not implemented", publishingEnabled: false }, 501);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_at <= ?"
      ).bind(new Date(event.scheduledTime).toISOString()).first();
      console.log("Rene Social Hub scheduled check", { duePosts: result.total, publishingEnabled: false });
    })());
  }
};
