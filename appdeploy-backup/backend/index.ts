import { router, json, error, requireAuth, db, secrets, ai, storage } from '@appdeploy/sdk';

const APP_ORIGIN = 'https://rene-social-hub-v2hl5y.v2.appdeploy.ai';
const THREADS_PROVIDER = 'threads';
const FACEBOOK_PROVIDER = 'facebook';
const THREADS_CLIENT_ID_SECRET = 'THREADS_APP_ID';
const THREADS_CLIENT_SECRET_SECRET = 'THREADS_APP_SECRET';
const FACEBOOK_CLIENT_ID_SECRET = 'FACEBOOK_APP_ID';
const FACEBOOK_CLIENT_SECRET_SECRET = 'FACEBOOK_APP_SECRET';
const FACEBOOK_CONFIG_ID_SECRET = 'FACEBOOK_LOGIN_CONFIG_ID';
const BACKEND_ORIGIN = 'https://api-v2.appdeploy.ai/app/rene-social-hub-v2hl5y';
const THREADS_CALLBACK = `${BACKEND_ORIGIN}/api/oauth/callback/threads`;
const FACEBOOK_CALLBACK = `${BACKEND_ORIGIN}/api/oauth/callback/facebook`;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function callbackPage(destination: string, heading: string, message: string) {
  const safeDestination = JSON.stringify(destination);
  const safeHeading = escapeHtml(heading);
  const safeMessage = escapeHtml(message);
  const safeLink = escapeHtml(destination);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="1;url=${safeLink}">
  <title>${safeHeading} · Rene Social Hub</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f8fc; color: #172033; }
    main { max-width: 32rem; margin: 1.5rem; padding: 2rem; background: white; border: 1px solid #e2e8f0; border-radius: 1rem; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <main>
    <h1>${safeHeading}</h1>
    <p>${safeMessage}</p>
    <p>If you are not redirected automatically, <a href="${safeLink}">return to Rene Social Hub</a>.</p>
  </main>
  <script>window.location.replace(${safeDestination});</script>
</body>
</html>`,
  };
}


const CLIENT_FACEBOOK_CALLBACK = `${BACKEND_ORIGIN}/api/client-oauth/callback/facebook`;
async function clientInvitation(token: string) {
  if (!/^[0-9a-f-]{36}[0-9a-f]{32}$/.test(token)) return null;
  const [invite] = await db.get<{ ownerUserId: string; clientId: string; expiresAt: number }>('client_invitation_previews', [token], { consistent: true });
  if (!invite || invite.expiresAt <= Date.now()) return null;
  const [client] = await db.get<{ ownerUserId: string; businessName: string; status: string }>('social_clients', [invite.clientId], { consistent: true });
  if (!client || client.ownerUserId !== invite.ownerUserId || client.status === 'Paused') return null;
  return { invite, client };
}

async function secretsConfigured(required: string[]) {
  const names = await secrets.listSecretNames();
  return required.every(name => names.includes(name));
}

async function findConnection(provider: string, userId: string) {
  const result = await db.list('social_connections', {
    limit: 20,
    filter: { provider, userId },
  });
  return result.items[0] ?? null;
}

type ThreadsConnection = {
  id: string;
  provider: string;
  userId: string;
  accessToken?: string;
  connectedAt?: number;
  expiresIn?: number;
  tokenIssuedAt?: number;
  tokenExpiresAt?: number;
};

async function exchangeThreadsShortLivedToken(shortLivedToken: string) {
  const clientSecret = await secrets.readSecret(THREADS_CLIENT_SECRET_SECRET);
  const url = new URL('https://graph.threads.net/access_token');
  url.search = new URLSearchParams({
    grant_type: 'th_exchange_token',
    client_secret: clientSecret,
    access_token: shortLivedToken,
  }).toString();
  const response = await fetch(url);
  const payload = await response.json() as { access_token?: string; token_type?: string; expires_in?: number; error?: { message?: string } };
  if (!response.ok || !payload.access_token || !Number(payload.expires_in)) {
    throw new Error(payload.error?.message || 'Threads long-lived token exchange failed');
  }
  return payload;
}

async function refreshThreadsLongLivedToken(accessToken: string) {
  const url = new URL('https://graph.threads.net/refresh_access_token');
  url.search = new URLSearchParams({
    grant_type: 'th_refresh_token',
    access_token: accessToken,
  }).toString();
  const response = await fetch(url);
  const payload = await response.json() as { access_token?: string; token_type?: string; expires_in?: number; error?: { message?: string } };
  if (!response.ok || !payload.access_token || !Number(payload.expires_in)) {
    throw new Error(payload.error?.message || 'Threads token refresh failed');
  }
  return payload;
}

async function finishFacebookCallback(query: Record<string, string>) {
  if (query.error) {
    return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=facebook&reason=denied`, 'Facebook connection not completed', 'Meta did not complete authorization.');
  }
  const state = query.state;
  const code = query.code;
  if (!state || !code) {
    return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=facebook&reason=missing_parameters`, 'Facebook connection could not be completed', 'Meta did not return the information needed to finish connecting Facebook.');
  }

  try {
    const stateResult = await db.list('oauth_states', {
      limit: 20,
      filter: { provider: FACEBOOK_PROVIDER, state },
    });
    const stateRecord = stateResult.items[0];
    if (!stateRecord || Date.now() - Number(stateRecord.createdAt) > 10 * 60 * 1000) {
      return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=facebook&reason=invalid_state`, 'Facebook authorization expired', 'For your security, this authorization could not be verified. Please start a fresh connection.');
    }

    const appId = (await secrets.readSecret(FACEBOOK_CLIENT_ID_SECRET)).trim();
    const appSecret = await secrets.readSecret(FACEBOOK_CLIENT_SECRET_SECRET);
    const tokenUrl = new URL('https://graph.facebook.com/v22.0/oauth/access_token');
    tokenUrl.search = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: FACEBOOK_CALLBACK,
      code,
    }).toString();
    const tokenResponse = await fetch(tokenUrl);
    const tokenPayload = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error('Facebook token exchange failed');

    const pagesUrl = new URL('https://graph.facebook.com/v22.0/me/accounts');
    pagesUrl.search = new URLSearchParams({
      fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
      access_token: tokenPayload.access_token,
    }).toString();
    const pagesResponse = await fetch(pagesUrl);
    const pagesPayload = await pagesResponse.json() as {
      data?: Array<{ id: string; name: string; access_token: string; tasks?: string[]; instagram_business_account?: { id: string; username?: string } }>;
    };
    if (!pagesResponse.ok || !Array.isArray(pagesPayload.data)) throw new Error('Facebook Page list could not be retrieved');
    const manageablePages = pagesPayload.data.filter(page => page.id && page.name && page.access_token);
    if (manageablePages.length === 0) {
      await db.delete('oauth_states', [stateRecord.id]);
      return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=facebook&reason=no_pages`, 'No Facebook Page found', 'The Facebook account did not return a Page that Rene Social Hub can connect. Confirm you manage the correct Page and approve the requested Page permissions.');
    }

    const existing = await findConnection(FACEBOOK_PROVIDER, String(stateRecord.userId));
    const record = {
      provider: FACEBOOK_PROVIDER,
      userId: String(stateRecord.userId),
      connectedAt: Date.now(),
      platformUserId: manageablePages[0].id,
      pageName: manageablePages[0].name,
      pages: manageablePages.map(page => ({
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        tasks: page.tasks ?? [],
        instagramAccountId: page.instagram_business_account?.id ?? '',
        instagramUsername: page.instagram_business_account?.username ?? '',
      })),
      instagramAccountId: manageablePages.find(page => page.instagram_business_account?.id)?.instagram_business_account?.id ?? '',
      instagramUsername: manageablePages.find(page => page.instagram_business_account?.id)?.instagram_business_account?.username ?? '',
      accessToken: tokenPayload.access_token,
      tokenType: 'bearer',
    };
    if (existing) await db.update('social_connections', [{ id: existing.id, record }]);
    else await db.add('social_connections', [record]);
    await db.delete('oauth_states', [stateRecord.id]);
    return callbackPage(`${APP_ORIGIN}/?oauth=success&provider=facebook`, 'Facebook connected', 'Your Facebook Page authorization was received. Publishing is not enabled until the publishing workflow is verified.');
  } catch (caught) {
    const safeMessage = caught instanceof Error ? caught.message : 'Unknown callback failure';
    console.error('Facebook OAuth callback failed:', safeMessage);
    return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=facebook&reason=token_exchange`, 'Facebook connection could not be completed', 'Meta returned you to Rene Social Hub, but the secure token exchange failed. Check the Facebook app configuration and try again.');
  }
}


async function publishScheduledFacebook(userId: string, message: string) {
  const connection = await findConnection(FACEBOOK_PROVIDER, userId);
  const pages = Array.isArray(connection?.pages) ? connection.pages : [];
  const page = pages.find((item: { id?: string; accessToken?: string }) => item.id && item.accessToken);
  if (!page) return { published: false, error: 'No connected Facebook Page with publishing access.' };
  const url = new URL('https://graph.facebook.com/v22.0/' + encodeURIComponent(page.id) + '/feed');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message, access_token: page.accessToken }).toString(),
  });
  const payload = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) return { published: false, error: payload.error?.message || 'Facebook did not confirm publication.' };
  return { published: true, id: payload.id };
}

async function publishScheduledInstagram(userId: string, caption: string, imageUrl: string) {
  if (!imageUrl) return { published: false, error: 'Instagram needs a permanent public HTTPS image link.' };
  let parsed: URL;
  try { parsed = new URL(imageUrl); } catch { return { published: false, error: 'The Instagram image link is invalid.' }; }
  if (parsed.protocol !== 'https:') return { published: false, error: 'The Instagram image link must use HTTPS.' };
  const connection = await findConnection(FACEBOOK_PROVIDER, userId);
  const pages = Array.isArray(connection?.pages) ? connection.pages : [];
  const page = pages.find((item: { instagramAccountId?: string; accessToken?: string }) => item.instagramAccountId && item.accessToken);
  if (!page) return { published: false, error: 'No connected Instagram professional account was found.' };

  const createUrl = new URL('https://graph.facebook.com/v22.0/' + encodeURIComponent(page.instagramAccountId) + '/media');
  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ image_url: imageUrl, caption, access_token: page.accessToken }).toString(),
  });
  const createPayload = await createResponse.json() as { id?: string; error?: { message?: string } };
  if (!createResponse.ok || !createPayload.id) return { published: false, error: createPayload.error?.message || 'Instagram could not prepare the image.' };

  const statusUrl = new URL('https://graph.facebook.com/v22.0/' + encodeURIComponent(createPayload.id));
  statusUrl.search = new URLSearchParams({ fields: 'status_code', access_token: page.accessToken }).toString();
  let containerStatus = '';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const statusResponse = await fetch(statusUrl);
    const statusPayload = await statusResponse.json() as { status_code?: string; error?: { message?: string } };
    if (!statusResponse.ok) return { published: false, error: statusPayload.error?.message || 'Instagram could not check image readiness.' };
    containerStatus = String(statusPayload.status_code || '').toUpperCase();
    if (containerStatus === 'FINISHED') break;
    if (containerStatus === 'ERROR' || containerStatus === 'EXPIRED') return { published: false, error: 'Instagram could not prepare this image (' + containerStatus + ').' };
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (containerStatus !== 'FINISHED') return { published: false, error: 'Instagram image processing is taking too long. Please check the profile before retrying.' };

  const publishUrl = new URL('https://graph.facebook.com/v22.0/' + encodeURIComponent(page.instagramAccountId) + '/media_publish');
  const publishResponse = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: createPayload.id, access_token: page.accessToken }).toString(),
  });
  const publishPayload = await publishResponse.json() as { id?: string; error?: { message?: string } };
  if (!publishResponse.ok || !publishPayload.id) return { published: false, error: publishPayload.error?.message || 'Instagram did not confirm publication. Check the profile before retrying.' };
  return { published: true, id: publishPayload.id };
}

async function publishScheduledThreads(userId: string, text: string) {
  if (text.length > 500) return { published: false, error: 'Threads posts can contain up to 500 characters.' };
  const connection = await findConnection(THREADS_PROVIDER, userId);
  if (!connection?.accessToken) return { published: false, error: 'No connected Threads account was found.' };
  const headers = {
    Authorization: 'Bearer ' + connection.accessToken,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const createResponse = await fetch('https://graph.threads.net/v1.0/me/threads', {
    method: 'POST',
    headers,
    body: new URLSearchParams({ media_type: 'TEXT', text }).toString(),
  });
  const createPayload = await createResponse.json() as { id?: string; error?: { message?: string } };
  if (!createResponse.ok || !createPayload.id) return { published: false, error: createPayload.error?.message || 'Threads could not prepare this post.' };

  const statusUrl = new URL('https://graph.threads.net/v1.0/' + encodeURIComponent(createPayload.id));
  statusUrl.search = new URLSearchParams({ fields: 'status,error_message' }).toString();
  let containerStatus = '';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const statusResponse = await fetch(statusUrl, { headers: { Authorization: headers.Authorization } });
    const statusPayload = await statusResponse.json() as { status?: string; error_message?: string; error?: { message?: string } };
    if (!statusResponse.ok) return { published: false, error: statusPayload.error?.message || 'Threads could not check post readiness.' };
    containerStatus = String(statusPayload.status || '').toUpperCase();
    if (containerStatus === 'FINISHED') break;
    if (containerStatus === 'PUBLISHED') return { published: false, error: 'Threads reports this post is already published. Check your profile.' };
    if (containerStatus === 'ERROR' || containerStatus === 'EXPIRED') return { published: false, error: statusPayload.error_message || 'Threads could not prepare this post.' };
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (containerStatus !== 'FINISHED') return { published: false, error: 'Threads is still preparing this post. Check your profile before retrying.' };

  const publishResponse = await fetch('https://graph.threads.net/v1.0/me/threads_publish', {
    method: 'POST',
    headers,
    body: new URLSearchParams({ creation_id: createPayload.id }).toString(),
  });
  const publishPayload = await publishResponse.json() as { id?: string; error?: { message?: string } };
  if (!publishResponse.ok || !publishPayload.id) return { published: false, error: publishPayload.error?.message || 'Threads did not confirm publication. Check the profile before retrying.' };
  return { published: true, id: publishPayload.id };
}

export const publishScheduledPostsCron = async (event: {
  type: 'cron';
  name: string;
  invocationId: string;
  payload: Record<string, unknown>;
  scheduledTime: string;
  invokedTime: string;
}) => {
  const now = Date.now();
  try {
    const threadConnections = await db.list<ThreadsConnection>('social_connections', {
      limit: 100,
      filter: { provider: THREADS_PROVIDER },
    });
    for (const connection of threadConnections.items) {
      if (!connection.accessToken || !connection.connectedAt) continue;
      const connectedAt = Number(connection.connectedAt);
      const expiresIn = Number(connection.expiresIn || 0);
      const tokenExpiresAt = Number(connection.tokenExpiresAt || (expiresIn > 0 ? connectedAt + expiresIn * 1000 : 0));
      const tokenIssuedAt = Number(connection.tokenIssuedAt || connectedAt);
      try {
        // Migrate a recently reconnected short-lived token to a 60-day token.
        if (!connection.tokenExpiresAt && expiresIn > 0 && expiresIn <= 7200 && tokenExpiresAt > now + 120000) {
          const longLived = await exchangeThreadsShortLivedToken(connection.accessToken);
          const issuedAt = Date.now();
          await db.tx.update('social_connections', [{
            id: connection.id,
            record: {
              accessToken: longLived.access_token,
              tokenType: longLived.token_type ?? 'bearer',
              expiresIn: Number(longLived.expires_in),
              tokenIssuedAt: issuedAt,
              tokenExpiresAt: issuedAt + Number(longLived.expires_in) * 1000,
              updatedAt: issuedAt,
            },
          }], { patch: true });
          continue;
        }

        // Refresh long-lived tokens before expiry; Meta requires the token to be at least 24 hours old.
        if (tokenExpiresAt > now && tokenExpiresAt <= now + 7 * 24 * 60 * 60 * 1000 && now - tokenIssuedAt >= 24 * 60 * 60 * 1000) {
          const refreshed = await refreshThreadsLongLivedToken(connection.accessToken);
          const issuedAt = Date.now();
          await db.tx.update('social_connections', [{
            id: connection.id,
            record: {
              accessToken: refreshed.access_token,
              tokenType: refreshed.token_type ?? 'bearer',
              expiresIn: Number(refreshed.expires_in),
              tokenIssuedAt: issuedAt,
              tokenExpiresAt: issuedAt + Number(refreshed.expires_in) * 1000,
              updatedAt: issuedAt,
            },
          }], { patch: true });
        }
      } catch (caught) {
        console.error('Threads token maintenance failed for connected account:', caught instanceof Error ? caught.message : 'Unknown error');
      }
    }

    const stuck = await db.list('scheduled_posts', { limit: 100, filter: { status: 'Publishing' } });
    for (const post of stuck.items) {
      if (now - Number(post.publishingStartedAt || now) > 30 * 60 * 1000) {
        await db.tx.update('scheduled_posts', [{
          id: post.id,
          record: { status: 'Needs review', updatedAt: now, lastError: 'The publishing process stopped before its result could be confirmed. Check the social profile before trying again.' },
          if: { status: 'Publishing' },
        }], { patch: true });
      }
    }

    const result = await db.list('scheduled_posts', { limit: 100, filter: { status: 'Scheduled' } });
    const duePosts = result.items
      .filter((post: { scheduledAt?: string }) => Number.isFinite(Date.parse(String(post.scheduledAt || ''))) && Date.parse(String(post.scheduledAt)) <= now)
      .sort((a: { scheduledAt?: string }, b: { scheduledAt?: string }) => Date.parse(String(a.scheduledAt)) - Date.parse(String(b.scheduledAt)))
      .slice(0, 20);

    for (const post of duePosts) {
      const [claimed] = await db.tx.update('scheduled_posts', [{
        id: post.id,
        record: { status: 'Publishing', publishingStartedAt: Date.now(), updatedAt: Date.now() },
        if: { status: 'Scheduled' },
      }], { patch: true });
      if (!claimed) continue;

      const platformResults: Record<string, { published: boolean; id?: string; error?: string }> = {};
      const caption = String(post.caption || '');
      const platforms = Array.isArray(post.platforms) ? post.platforms : [];
      for (const platform of platforms) {
        try {
          if (platform === 'Facebook') platformResults.Facebook = await publishScheduledFacebook(String(post.ownerUserId), caption);
          else if (platform === 'Instagram') {
            let imageUrl = String(post.imageUrl || '');
            if (post.imagePath) {
              const [storedImage] = await storage.url([String(post.imagePath)]);
              if (!storedImage?.url) throw new Error('The uploaded Instagram image could not be retrieved.');
              imageUrl = storedImage.url;
            }
            platformResults.Instagram = await publishScheduledInstagram(String(post.ownerUserId), caption, imageUrl);
          }
          else if (platform === 'Threads') platformResults.Threads = await publishScheduledThreads(String(post.ownerUserId), caption);
          else platformResults[String(platform)] = { published: false, error: 'This platform is not supported.' };
        } catch (caught) {
          console.error('Scheduled publishing failed for ' + String(platform), caught instanceof Error ? caught.message : 'Unknown error');
          platformResults[String(platform)] = { published: false, error: 'The platform did not confirm publication. Check the profile before retrying.' };
        }
      }

      const allPublished = platforms.length > 0 && platforms.every(platform => platformResults[String(platform)]?.published === true);
      const anyPublished = platforms.some(platform => platformResults[String(platform)]?.published === true);
      const nextStatus = allPublished ? 'Published' : 'Needs review';
      await db.tx.update('scheduled_posts', [{
        id: post.id,
        record: {
          status: nextStatus,
          platformResults,
          publishedAt: allPublished ? Date.now() : undefined,
          updatedAt: Date.now(),
          lastError: anyPublished ? undefined : 'One or more platforms did not confirm publication. Check each profile before retrying to avoid duplicates.',
        },
        if: { status: 'Publishing' },
      }], { patch: true });
    }
  } catch (caught) {
    console.error('Scheduled publishing cron failed:', caught instanceof Error ? caught.message : 'Unknown error');
  }
  return { statusCode: 200 };
};

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  'POST /api/media/upload': [
    requireAuth(),
    async ({ user, body }) => {
      const input = body as { filename?: string; contentType?: string; base64?: string };
      const filename = String(input?.filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
      const contentType = String(input?.contentType || '');
      const base64 = String(input?.base64 || '');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return error('Please choose a JPG, PNG or WebP image.', 400);
      if (!base64 || base64.length > 11_000_000) return error('The image is empty or larger than 8 MB. Please choose a smaller image.', 400);
      const path = `user-media/${user!.userId}/${Date.now()}-${filename}`;
      const [saved] = await storage.write([{ path, content: base64, contentType }]);
      if (!saved) return error('The image could not be saved. Please try again.', 500);
      const [storedImage] = await storage.url([path]);
      if (!storedImage?.url) return error('The image was saved but a preview link could not be created.', 500);
      return json({ path, url: storedImage.url, filename });
    },
  ],

  'GET /api/scheduled-posts': [
    requireAuth(),
    async ({ user }) => {
      const result = await db.list('scheduled_posts', { limit: 100, filter: { ownerUserId: user!.userId } });
      const posts = result.items.sort((a: { scheduledAt?: string }, b: { scheduledAt?: string }) => String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));
      return json({ posts });
    },
  ],
  'POST /api/scheduled-posts': [
    requireAuth(),
    async ({ user, body }) => {
      const input = body as { caption?: string; platforms?: string[]; scheduledAt?: string; imageUrl?: string; imagePath?: string };
      const caption = typeof input?.caption === 'string' ? input.caption.trim() : '';
      const platforms = Array.isArray(input?.platforms) ? [...new Set(input.platforms)] : [];
      const scheduledAt = typeof input?.scheduledAt === 'string' ? input.scheduledAt : '';
      const imageUrl = typeof input?.imageUrl === 'string' ? input.imageUrl.trim() : '';
      const imagePath = typeof input?.imagePath === 'string' ? input.imagePath.trim() : '';
      if (!caption) return error('Write your post before scheduling.', 400);
      if (caption.length > 5000) return error('Your post is too long. Please shorten it.', 400);
      if (!platforms.length || platforms.some(platform => !['Facebook', 'Instagram', 'Threads'].includes(platform))) return error('Choose at least one supported platform.', 400);
      const scheduledTime = Date.parse(scheduledAt);
      if (!scheduledAt || !Number.isFinite(scheduledTime) || scheduledTime <= Date.now()) return error('Choose a date and time in the future.', 400);
      if (platforms.includes('Instagram')) {
        const ownedUpload = imagePath.startsWith(`user-media/${user!.userId}/`);
        if (!ownedUpload && !imageUrl) return error('Upload an image or provide a public HTTPS image link for Instagram.', 400);
        if (imageUrl) {
          try { if (new URL(imageUrl).protocol !== 'https:') return error('Instagram image links must use HTTPS.', 400); }
          catch { return error('Enter a valid public HTTPS image link for Instagram.', 400); }
        }
        if (imagePath && !ownedUpload) return error('That uploaded image does not belong to your account.', 403);
      }
      const [id] = await db.add('scheduled_posts', [{
        ownerUserId: user!.userId,
        caption,
        platforms,
        imageUrl: imageUrl || '',
        imagePath: imagePath || '',
        scheduledAt: new Date(scheduledTime).toISOString(),
        status: 'Scheduled',
        platformResults: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]);
      if (!id) return error('Your post could not be saved. Please try again.', 500);
      return json({ post: { id, ownerUserId: user!.userId, caption, platforms, imageUrl: imageUrl || '', imagePath: imagePath || '', scheduledAt: new Date(scheduledTime).toISOString(), status: 'Scheduled' } }, 201);
    },
  ],
  'DELETE /api/scheduled-posts/:id': [
    requireAuth(),
    async ({ user, params }) => {
      const [existing] = await db.get<{ ownerUserId: string; status: string }>('scheduled_posts', [params.id], { consistent: true });
      if (!existing || existing.ownerUserId !== user!.userId) return error('Scheduled post not found.', 404);
      if (existing.status !== 'Scheduled') return error('Only posts that have not started publishing can be cancelled.', 409);
      const [updated] = await db.tx.update('scheduled_posts', [{ id: params.id, record: { status: 'Cancelled', updatedAt: Date.now() }, if: { ownerUserId: user!.userId, status: 'Scheduled' } }], { patch: true });
      if (!updated) return error('This post could not be cancelled. Refresh the planner and try again.', 409);
      return json({ cancelled: true });
    },
  ],

  'POST /api/clients/:id/invitation': [
    requireAuth(),
    async ({ user, params }) => {
      const [client] = await db.get<{ ownerUserId: string; businessName: string; status?: string }>('social_clients', [params.id], { consistent: true });
      if (!client || client.ownerUserId !== user!.userId) return error('Client not found.', 404);
      if (client.status === 'Paused') return error('Activate this client before inviting them.', 409);
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const [created] = await db.tx.add('client_invitation_previews', [{ id: token, ownerUserId: user!.userId, clientId: params.id, businessName: client.businessName, createdAt: Date.now(), expiresAt }]);
      if (!created) return error('Unable to create invitation.', 500);
      return json({ url: `${BACKEND_ORIGIN}/api/client-invitation/${token}`, expiresAt, facebookCallback: CLIENT_FACEBOOK_CALLBACK, publishingEnabled: false });
    },
  ],
  'GET /api/client-invitation/:token': [
    async ({ params }) => {
      const valid = await clientInvitation(params.token);
      if (!valid) return error('Invitation expired or unavailable.', 410);
      const connect = `${BACKEND_ORIGIN}/api/client-connect/${params.token}/facebook`;
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' },
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect business · Rene Social Hub</title></head><body style="font:16px system-ui;max-width:540px;margin:8vh auto;padding:24px;color:#172033"><h1>Rene Social Hub</h1><h2>${escapeHtml(valid.client.businessName)}</h2><p>Authorize your business Facebook Page and linked professional Instagram account using Meta's official sign-in.</p><p><a style="display:inline-block;padding:14px 18px;background:#172033;color:white;border-radius:9px" href="${escapeHtml(connect)}">Connect Facebook and Instagram</a></p><p>Only approve access if you recognize this business and trust the person who sent the invitation. Never share your password.</p><p>Threads authorization and automatic publishing are not enabled for client work yet.</p></body></html>`,
      };
    },
  ],

  'POST /api/clients/:id/invitation-preview': [
    requireAuth(),
    async ({ user, params }) => {
      const [client] = await db.get<{ ownerUserId: string; businessName: string }>('social_clients', [params.id], { consistent: true });
      if (!client || client.ownerUserId !== user!.userId) return error('Client not found.', 404);
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const [created] = await db.tx.add('client_invitation_previews', [{
        id: token,
        ownerUserId: user!.userId,
        clientId: params.id,
        businessName: client.businessName,
        createdAt: Date.now(),
        expiresAt,
      }]);
      if (!created) return error('Unable to prepare invitation preview.', 500);
      return json({ url: `${BACKEND_ORIGIN}/api/client-invitation-preview/${token}`, expiresAt, previewOnly: true });
    },
  ],
  'GET /api/client-invitation-preview/:token': [
    async ({ params }) => {
      const token = params.token;
      if (!/^[0-9a-f-]{36}[0-9a-f]{32}$/.test(token)) return error('Invitation preview not found.', 404);
      const [invitation] = await db.get<{ businessName: string; expiresAt: number }>('client_invitation_previews', [token], { consistent: true });
      if (!invitation || invitation.expiresAt < Date.now()) return error('This invitation preview has expired.', 410);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client connection preview · Rene Social Hub</title></head><body style="font:16px system-ui;max-width:520px;margin:10vh auto;padding:24px;color:#172033"><h1>Rene Social Hub</h1><h2>${escapeHtml(invitation.businessName)}</h2><p>This is a <strong>preview only</strong> of a future client connection invitation.</p><p>Facebook, Instagram and Threads authorization is not available here yet. No accounts have been connected and no permission has been granted.</p><p>Please do not enter passwords or share account credentials.</p></body></html>`,
      };
    },
  ],

  'GET /api/clients/:id/drafts': [
    requireAuth(),
    async ({ user, params }) => {
      const [client] = await db.get<{ ownerUserId: string }>('social_clients', [params.id], { consistent: true });
      if (!client || client.ownerUserId !== user!.userId) return error('Client not found.', 404);
      const result = await db.list('client_post_drafts', { limit: 100, filter: { ownerUserId: user!.userId, clientId: params.id } });
      return json({ drafts: result.items.map(item => ({ id: item.id, caption: item.caption, createdAt: item.createdAt })) });
    },
  ],
  'POST /api/clients/:id/drafts': [
    requireAuth(),
    async ({ user, params, body }) => {
      const [client] = await db.get<{ ownerUserId: string }>('social_clients', [params.id], { consistent: true });
      if (!client || client.ownerUserId !== user!.userId) return error('Client not found.', 404);
      const caption = typeof (body as { caption?: string })?.caption === 'string' ? (body as { caption: string }).caption.trim() : '';
      if (!caption || caption.length > 5000) return error('Write a draft of up to 5000 characters.', 400);
      const createdAt = Date.now();
      const [id] = await db.add('client_post_drafts', [{ ownerUserId: user!.userId, clientId: params.id, caption, createdAt, status: 'Draft' }]);
      if (!id) return error('Could not save client draft.', 500);
      return json({ draft: { id, caption, createdAt, status: 'Draft' } }, 201);
    },
  ],


  'GET /api/client-connect/:token/facebook': [
    async ({ params }) => {
      const valid = await clientInvitation(params.token);
      if (!valid) return error('Invitation expired or unavailable.', 410);
      if (!(await secretsConfigured([FACEBOOK_CLIENT_ID_SECRET, FACEBOOK_CLIENT_SECRET_SECRET, FACEBOOK_CONFIG_ID_SECRET]))) return error('Facebook authorization is not configured.', 409);
      const appId = (await secrets.readSecret(FACEBOOK_CLIENT_ID_SECRET)).trim();
      const configId = (await secrets.readSecret(FACEBOOK_CONFIG_ID_SECRET)).trim();
      if (!/^\d+$/.test(appId) || !/^\d+$/.test(configId)) return error('Facebook authorization is not configured.', 409);
      const state = crypto.randomUUID() + crypto.randomUUID();
      const [stored] = await db.tx.add('client_oauth_states', [{ id: state, ownerUserId: valid.invite.ownerUserId, clientId: valid.invite.clientId, invitationToken: params.token, createdAt: Date.now(), provider: 'facebook' }]);
      if (!stored) return error('Could not begin authorization.', 500);
      const search = new URLSearchParams({ client_id: appId, redirect_uri: CLIENT_FACEBOOK_CALLBACK, config_id: configId, response_type: 'code', override_default_response_type: 'true', state });
      return { statusCode: 302, headers: { Location: `https://www.facebook.com/v22.0/dialog/oauth?${search.toString()}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, body: '' };
    },
  ],
  'GET /api/client-oauth/callback/facebook': [
    async ({ query }) => {
      if (!query.state || !/^[0-9a-f]{64}$/.test(query.state)) return callbackPage(APP_ORIGIN, 'Connection not completed', 'The authorization request could not be verified.');
      const [state] = await db.get<{ id: string; ownerUserId: string; clientId: string; invitationToken: string; createdAt: number; provider: string }>('client_oauth_states', [query.state], { consistent: true });
      if (!state || state.provider !== 'facebook' || Date.now() - state.createdAt > 600000) return callbackPage(APP_ORIGIN, 'Connection expired', 'Please request a fresh invitation.');
      const valid = await clientInvitation(state.invitationToken);
      if (!valid || valid.invite.clientId !== state.clientId || valid.invite.ownerUserId !== state.ownerUserId) return callbackPage(APP_ORIGIN, 'Connection unavailable', 'This invitation is no longer active.');
      if (query.error || !query.code) return callbackPage(APP_ORIGIN, 'Connection cancelled', 'Facebook authorization was not completed.');
      const [claimed] = await db.tx.update('client_oauth_states', [{ id: state.id, record: { claimedAt: Date.now() }, if: { claimedAt: undefined } }], { patch: true });
      if (!claimed) return callbackPage(APP_ORIGIN, 'Connection already processed', 'This authorization link was already used.');
      try {
        const appId = (await secrets.readSecret(FACEBOOK_CLIENT_ID_SECRET)).trim();
        const appSecret = await secrets.readSecret(FACEBOOK_CLIENT_SECRET_SECRET);
        const tokenUrl = new URL('https://graph.facebook.com/v22.0/oauth/access_token');
        tokenUrl.search = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: CLIENT_FACEBOOK_CALLBACK, code: query.code }).toString();
        const tokenResponse = await fetch(tokenUrl);
        const token = await tokenResponse.json() as { access_token?: string };
        if (!tokenResponse.ok || !token.access_token) throw new Error('Token exchange failed');
        const pagesUrl = new URL('https://graph.facebook.com/v22.0/me/accounts');
        pagesUrl.search = new URLSearchParams({ fields: 'id,name,access_token,tasks,instagram_business_account{id,username}', access_token: token.access_token }).toString();
        const pagesResponse = await fetch(pagesUrl);
        const pagesData = await pagesResponse.json() as { data?: Array<{ id: string; name: string; access_token: string; tasks?: string[]; instagram_business_account?: { id: string; username?: string } }> };
        if (!pagesResponse.ok || !pagesData.data?.length) throw new Error('No managed Pages were returned');
        // Do not silently select a Page when multiple Pages are available.
        if (pagesData.data.length !== 1) throw new Error('Page selection is required');
        const page = pagesData.data[0];
        if (!page.id || !page.access_token) throw new Error('Page authorization incomplete');
        const existing = await db.list('client_social_connections', { limit: 20, filter: { ownerUserId: state.ownerUserId, clientId: state.clientId, provider: 'facebook' } });
        const record = { ownerUserId: state.ownerUserId, clientId: state.clientId, provider: 'facebook', status: 'Connected', pageId: page.id, pageName: page.name, accessToken: page.access_token, instagramAccountId: page.instagram_business_account?.id || '', connectedAt: Date.now(), publishingEnabled: false };
        if (existing.items[0]) await db.tx.update('client_social_connections', [{ id: existing.items[0].id, record }], { patch: true });
        else await db.add('client_social_connections', [record]);
        if (page.instagram_business_account?.id) {
          const ig = await db.list('client_social_connections', { limit: 20, filter: { ownerUserId: state.ownerUserId, clientId: state.clientId, provider: 'instagram' } });
          const igRecord = { ownerUserId: state.ownerUserId, clientId: state.clientId, provider: 'instagram', status: 'Connected', instagramAccountId: page.instagram_business_account.id, pageId: page.id, connectedAt: Date.now(), publishingEnabled: false };
          if (ig.items[0]) await db.tx.update('client_social_connections', [{ id: ig.items[0].id, record: igRecord }], { patch: true });
          else await db.add('client_social_connections', [igRecord]);
        }
        await db.delete('client_oauth_states', [state.id]);
        return callbackPage(APP_ORIGIN, 'Client Facebook connected', 'The client Page is securely linked to its own workspace. Automatic publishing remains disabled.');
      } catch (caught) {
        console.error('Client Facebook authorization failed:', caught instanceof Error ? caught.message : 'Unknown failure');
        return callbackPage(APP_ORIGIN, 'Client connection not completed', 'The Page could not be connected. If this Facebook account manages multiple Pages, Page selection must be configured first.');
      }
    },
  ],

  'GET /api/clients/:id/connections': [
    requireAuth(),
    async ({ user, params }) => {
      const [client] = await db.get<{ ownerUserId: string }>('social_clients', [params.id], { consistent: true });
      if (!client || client.ownerUserId !== user!.userId) return error('Client not found.', 404);
      const result = await db.list('client_social_connections', {
        limit: 100,
        filter: { ownerUserId: user!.userId, clientId: params.id },
      });
      const facebook = result.items.some(item => item.provider === 'facebook' && item.status === 'Connected');
      const instagram = result.items.some(item => item.provider === 'instagram' && item.status === 'Connected');
      const threads = result.items.some(item => item.provider === 'threads' && item.status === 'Connected');
      return json({ connections: { Facebook: facebook, Instagram: instagram, Threads: threads }, publishingEnabled: false });
    },
  ],

  'GET /api/clients': [
    requireAuth(),
    async ({ user }) => {
      const result = await db.list('social_clients', { limit: 100, filter: { ownerUserId: user!.userId } });
      return json({ clients: result.items });
    },
  ],
  'POST /api/clients': [
    requireAuth(),
    async ({ user, body }) => {
      const input = body as { businessName?: string; contactName?: string; email?: string; phone?: string; notes?: string; status?: string };
      const businessName = typeof input?.businessName === 'string' ? input.businessName.trim() : '';
      if (!businessName) return error('Business name is required.', 400);
      const [id] = await db.add('social_clients', [{ ownerUserId: user!.userId, businessName, contactName: input.contactName?.trim() || '', email: input.email?.trim() || '', phone: input.phone?.trim() || '', notes: input.notes?.trim() || '', status: input.status === 'Paused' ? 'Paused' : 'Active', createdAt: Date.now(), updatedAt: Date.now() }]);
      if (!id) return error('Client could not be saved. Please try again.', 500);
      return json({ client: { id, ownerUserId: user!.userId, businessName, contactName: input.contactName?.trim() || '', email: input.email?.trim() || '', phone: input.phone?.trim() || '', notes: input.notes?.trim() || '', status: input.status === 'Paused' ? 'Paused' : 'Active' } }, 201);
    },
  ],
  'PUT /api/clients/:id': [
    requireAuth(),
    async ({ user, params, body }) => {
      const [existing] = await db.get<{ ownerUserId: string }>('social_clients', [params.id], { consistent: true });
      if (!existing || existing.ownerUserId !== user!.userId) return error('Client not found.', 404);
      const input = body as { businessName?: string; contactName?: string; email?: string; phone?: string; notes?: string; status?: string };
      const businessName = typeof input?.businessName === 'string' ? input.businessName.trim() : '';
      if (!businessName) return error('Business name is required.', 400);
      const [updated] = await db.tx.update('social_clients', [{ id: params.id, record: { businessName, contactName: input.contactName?.trim() || '', email: input.email?.trim() || '', phone: input.phone?.trim() || '', notes: input.notes?.trim() || '', status: input.status === 'Paused' ? 'Paused' : 'Active', updatedAt: Date.now() }, if: { ownerUserId: user!.userId } }], { patch: true });
      if (!updated) return error('Client could not be updated.', 404);
      return json({ updated: true });
    },
  ],
  'DELETE /api/clients/:id': [
    requireAuth(),
    async ({ user, params }) => {
      const [existing] = await db.get<{ ownerUserId: string }>('social_clients', [params.id], { consistent: true });
      if (!existing || existing.ownerUserId !== user!.userId) return error('Client not found.', 404);
      const [deleted] = await db.delete('social_clients', [params.id]);
      if (!deleted) return error('Client could not be deleted.', 500);
      return json({ deleted: true });
    },
  ],

  'GET /api/oauth/status': [
    requireAuth(),
    async ({ user }) => {
      const [threadsConnection, facebookConnection] = await Promise.all([
        findConnection(THREADS_PROVIDER, user!.userId),
        findConnection(FACEBOOK_PROVIDER, user!.userId),
      ]);
      return json({
        connections: {
          threads: {
            connected: Boolean(threadsConnection),
            configured: await secretsConfigured([THREADS_CLIENT_ID_SECRET, THREADS_CLIENT_SECRET_SECRET]),
          },
          facebook: {
            connected: Boolean(facebookConnection),
            configured: await secretsConfigured([FACEBOOK_CLIENT_ID_SECRET, FACEBOOK_CLIENT_SECRET_SECRET, FACEBOOK_CONFIG_ID_SECRET]),
          },
          instagram: {
            connected: Boolean(facebookConnection?.pages?.some((page: { instagramAccountId?: string }) => page.instagramAccountId)),
            configured: await secretsConfigured([FACEBOOK_CLIENT_ID_SECRET, FACEBOOK_CLIENT_SECRET_SECRET, FACEBOOK_CONFIG_ID_SECRET]),
          },
        },
      });
    },
  ],

  'GET /api/oauth/start/:provider': [
    requireAuth(),
    async ({ params, user }) => {
      if (params.provider === FACEBOOK_PROVIDER) {
        if (!(await secretsConfigured([FACEBOOK_CLIENT_ID_SECRET, FACEBOOK_CLIENT_SECRET_SECRET, FACEBOOK_CONFIG_ID_SECRET]))) {
          return error('Facebook app credentials and Login for Business configuration are not set up yet.', 409);
        }
        const clientId = (await secrets.readSecret(FACEBOOK_CLIENT_ID_SECRET)).trim();
        const configId = (await secrets.readSecret(FACEBOOK_CONFIG_ID_SECRET)).trim();
        if (!/^\d+$/.test(clientId) || !/^\d+$/.test(configId)) {
          return error('The saved Facebook App ID or Login for Business configuration ID is invalid.', 409);
        }
        const stateValue = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
        const [stateId] = await db.add('oauth_states', [{
          provider: FACEBOOK_PROVIDER,
          userId: user!.userId,
          state: stateValue,
          createdAt: Date.now(),
        }]);
        if (!stateId) return error('Unable to start secure Facebook authorization.', 500);
        const oauthParams = new URLSearchParams({
          client_id: clientId,
          redirect_uri: FACEBOOK_CALLBACK,
          config_id: configId,
          response_type: 'code',
          override_default_response_type: 'true',
          state: stateValue,
        });
        return json({ url: `https://www.facebook.com/v22.0/dialog/oauth?${oauthParams.toString()}` });
      }

      if (params.provider !== THREADS_PROVIDER) return error('This platform connection is not available yet', 501);
      if (!(await secretsConfigured([THREADS_CLIENT_ID_SECRET, THREADS_CLIENT_SECRET_SECRET]))) return error('Threads app credentials are not configured yet', 409);
      const clientId = (await secrets.readSecret(THREADS_CLIENT_ID_SECRET)).trim();
      if (!/^\d+$/.test(clientId)) {
        return error('The saved Threads App ID is empty or invalid. Please verify the App ID in Meta for Developers and save it again.', 409);
      }
      const stateValue = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      const [stateId] = await db.tx.add('oauth_states', [{
        id: stateValue,
        provider: THREADS_PROVIDER,
        userId: user!.userId,
        state: stateValue,
        createdAt: Date.now(),
      }]);
      if (!stateId) return error('Unable to start secure Threads authorization', 500);
      const oauthParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: THREADS_CALLBACK,
        scope: 'threads_basic,threads_content_publish',
        response_type: 'code',
        state: stateValue,
      });
      return json({ url: `https://threads.net/oauth/authorize?${oauthParams.toString()}` });
    },
  ],

  'GET /api/oauth/callback/facebook': [
    async ({ query }) => finishFacebookCallback(query),
  ],

  'GET /api/oauth/callback/:provider': [
    async ({ params, query }) => {
      if (params.provider === FACEBOOK_PROVIDER) return finishFacebookCallback(query);
      console.info('Threads OAuth callback reached', { provider: params.provider, hasCode: Boolean(query.code), hasState: Boolean(query.state), hasProviderError: Boolean(query.error) });
      if (params.provider !== THREADS_PROVIDER) return callbackPage(APP_ORIGIN, 'Unsupported connection', 'This platform connection is not supported.');
      if (query.error) {
        return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=threads`, 'Threads connection not completed', 'Meta did not complete the authorization. Please return to the app and try again.');
      }
      const state = query.state;
      const code = query.code;
      if (!state || !code) {
        console.error('Threads OAuth callback missing required parameters');
        return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=threads&reason=missing_parameters`, 'Threads connection could not be completed', 'Meta did not return the information needed to finish connecting Threads.');
      }
      try {
        const [stateRecord] = await db.get<{
          provider: string;
          userId: string;
          state: string;
          createdAt: number;
        }>('oauth_states', [state], { consistent: true });
        if (!stateRecord || Date.now() - Number(stateRecord.createdAt) > 10 * 60 * 1000) {
          console.error('Threads OAuth callback state missing, expired, or invalid');
          return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=threads&reason=invalid_state`, 'Threads authorization expired', 'For your security, this authorization could not be verified. Please start a fresh connection.');
        }
        const clientId = await secrets.readSecret(THREADS_CLIENT_ID_SECRET);
        const clientSecret = await secrets.readSecret(THREADS_CLIENT_SECRET_SECRET);
        const response = await fetch('https://graph.threads.net/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: THREADS_CALLBACK, code }).toString(),
        });
        const payload = await response.json() as { access_token?: string; user_id?: string | number; token_type?: string; expires_in?: number };
        if (!response.ok || !payload.access_token) throw new Error('Threads token exchange failed');
        const longLived = await exchangeThreadsShortLivedToken(payload.access_token);
        const connectedAt = Date.now();
        const existing = await findConnection(THREADS_PROVIDER, String(stateRecord.userId));
        const record = {
          provider: THREADS_PROVIDER,
          userId: String(stateRecord.userId),
          connectedAt,
          platformUserId: payload.user_id ? String(payload.user_id) : '',
          accessToken: longLived.access_token,
          tokenType: longLived.token_type ?? payload.token_type ?? 'bearer',
          expiresIn: Number(longLived.expires_in),
          tokenIssuedAt: connectedAt,
          tokenExpiresAt: connectedAt + Number(longLived.expires_in) * 1000,
        };
        if (existing) await db.update('social_connections', [{ id: existing.id, record }]);
        else await db.add('social_connections', [record]);
        await db.delete('oauth_states', [state]);
        return callbackPage(`${APP_ORIGIN}/?oauth=success&provider=threads`, 'Threads authorization received', 'Rene Social Hub is finishing the connection check. If the account does not show as connected, return to the app and try again.');
      } catch (caught) {
        const safeMessage = caught instanceof Error ? caught.message : 'Unknown callback failure';
        console.error('Threads OAuth callback failed:', safeMessage);
        return callbackPage(`${APP_ORIGIN}/?oauth=error&provider=threads&reason=token_exchange`, 'Threads connection could not be completed', 'Meta returned you to Rene Social Hub, but the secure token exchange failed. Check the Threads app ID and secret configuration, then start a fresh connection.');
      }
    },
  ],

  'POST /api/ai/generate-image': [
    requireAuth(),
    async ({ user, body }) => {
      const input = body as { imageBrief?: string; theme?: string };
      const imageBrief = typeof input?.imageBrief === 'string' ? input.imageBrief.trim().slice(0, 1200) : '';
      const theme = typeof input?.theme === 'string' ? input.theme.trim().slice(0, 180) : 'Helpful administrative support';
      if (!imageBrief) return error('Generate your daily content first so the image has a clear direction.', 400);
      try {
        const configured = await secretsConfigured(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
        if (!configured) return error('Cloudflare image generation is not configured yet. Please check the app secrets.', 503);

        const accountId = (await secrets.readSecret('CLOUDFLARE_ACCOUNT_ID')).trim();
        const apiToken = (await secrets.readSecret('CLOUDFLARE_API_TOKEN')).trim();
        const prompt = `Create a polished, original square social media graphic for Rene VA Services, a virtual assistant and administrative support business. Brand palette: deep navy and warm gold, used as distinct solid colors with clean white space. Theme: ${theme}. Visual direction: ${imageBrief}. Use a professional, modern, calm business aesthetic suitable for small business owners. Include no logos, no fake contact details, no watermarks, and avoid long or misspelled text. Prefer a strong visual metaphor and minimal or no embedded wording.`.slice(0, 2048);

        const cloudflareResponse = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt, steps: 4 }),
          },
        );

        const cloudflarePayload = await cloudflareResponse.json() as {
          success?: boolean;
          result?: { image?: string };
          errors?: Array<{ code?: number; message?: string }>;
        };

        if (!cloudflareResponse.ok || cloudflarePayload.success === false || !cloudflarePayload.result?.image) {
          if (cloudflareResponse.status === 429) {
            return error('Cloudflare’s free daily image allowance has been reached. Please try again after the allowance resets.', 429);
          }
          if (cloudflareResponse.status === 401 || cloudflareResponse.status === 403) {
            console.error('Cloudflare Workers AI rejected the configured credentials or permissions.');
            return error('Cloudflare could not authorize image generation. Please check the Workers AI API token permissions.', 502);
          }
          const providerMessage = cloudflarePayload.errors?.[0]?.message || 'Cloudflare image generation failed';
          console.error('Cloudflare image generation failed:', cloudflareResponse.status, providerMessage.slice(0, 180));
          return error('Cloudflare could not generate the image. Please try again.', cloudflareResponse.status >= 500 ? 503 : 502);
        }

        const imageData = cloudflarePayload.result.image;
        const path = `generated-content/${encodeURIComponent(user!.userId)}/${Date.now()}.jpg`;
        const [saved] = await storage.write([{ path, content: imageData, contentType: 'image/jpeg' }]);
        if (!saved) return error('The image was generated but could not be saved. Please try again.', 502);
        const [signed] = await storage.url([path]);
        if (!signed?.url) return error('The image was saved but a publishing link could not be created.', 502);
        return json({ imageUrl: signed.url, path, mimeType: 'image/jpeg', expiresInMinutes: 15, provider: 'Cloudflare Workers AI' });
      } catch (caught) {
        console.error('Cloudflare image generation failed:', caught instanceof Error ? caught.message.slice(0, 180) : 'Unknown error');
        return error('The image could not be generated. Please try again.', 502);
      }
    },
  ],

  'POST /api/ai/daily-content': [
    requireAuth(),
    async ({ body }) => {
      const input = body as { topic?: string };
      const topic = typeof input?.topic === 'string' ? input.topic.trim().slice(0, 240) : '';
      const result = await ai.generate({
        system: 'You are the social content writer for Rene VA Services, a South African virtual assistance business. Write truthful, useful, friendly, professional content. Rene provides virtual assistance and administrative support: document preparation, forms, data entry, organising business information and day-to-day admin support for small businesses and entrepreneurs. Do not claim Rene provides marketing, advertising, lead generation, or guaranteed business growth. Avoid invented testimonials, client results, prices, guarantees, and contact details. Keep the content practical and not overly salesy.',
        prompt: `Create one fresh daily social post for Rene VA Services${topic ? ` about this angle: ${topic}` : ' using a useful, varied angle relevant to small business owners'}. Return platform-specific copy for Facebook, Instagram and Threads. Facebook: conversational and useful, up to 1,000 characters. Instagram: engaging caption, up to 1,000 characters, with a small number of relevant hashtags. Threads: concise and natural, maximum 450 characters. Do not include markdown or explanations. Make each version sound native to its platform and keep the core message consistent.`,
        schema: {
          type: 'object',
          properties: {
            theme: { type: 'string' },
            facebook: { type: 'string' },
            instagram: { type: 'string' },
            threads: { type: 'string' },
            imageBrief: { type: 'string' },
          },
          required: ['theme', 'facebook', 'instagram', 'threads', 'imageBrief'],
        },
        maxTokens: 1200,
        temperature: 0.8,
        thinkingMode: 'FAST',
      });
      try {
        const content = JSON.parse(result.text) as { theme?: string; facebook?: string; instagram?: string; threads?: string; imageBrief?: string };
        if (!content.facebook || !content.instagram || !content.threads || !content.imageBrief) return error('The content writer returned an incomplete draft. Please try again.', 502);
        if (content.threads.length > 500) content.threads = content.threads.slice(0, 490).trimEnd();
        return json({ content });
      } catch {
        console.error('AI content generation returned invalid structured output');
        return error('The content writer could not format the post. Please try again.', 502);
      }
    },
  ],

  'POST /api/facebook/publish': [
    requireAuth(),
    async ({ user, body }) => {
      const input = body as { message?: string };
      const message = typeof input?.message === 'string' ? input.message.trim() : '';
      if (!message) return error('Write a Facebook post before publishing.', 400);
      if (message.length > 63206) return error('This Facebook post is too long. Please shorten it and try again.', 400);

      const connection = await findConnection(FACEBOOK_PROVIDER, user!.userId);
      const pages = Array.isArray(connection?.pages) ? connection.pages : [];
      const page = pages.find((item: { id?: string; accessToken?: string }) => item.id && item.accessToken);
      if (!page) return error('Connect a Facebook Page with publishing access before publishing.', 409);

      try {
        const publishUrl = new URL(`https://graph.facebook.com/v22.0/${encodeURIComponent(page.id)}/feed`);
        const response = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            message,
            access_token: page.accessToken,
          }).toString(),
        });
        const payload = await response.json() as {
          id?: string;
          error?: { message?: string; code?: number; error_subcode?: number };
        };
        if (!response.ok || !payload.id) {
          console.error('Facebook Page publish failed', {
            status: response.status,
            code: payload.error?.code,
            subcode: payload.error?.error_subcode,
          });
          return error(payload.error?.message || 'Facebook did not confirm publication. Check your Page permissions and try again.', 502);
        }
        return json({ published: true, postId: payload.id, pageName: page.name });
      } catch (caught) {
        console.error('Facebook publishing request failed:', caught instanceof Error ? caught.message : 'Unknown error');
        return error('Facebook publishing could not be completed. Please check your Page before retrying.', 502);
      }
    },
  ],

  'POST /api/instagram/publish': [
    requireAuth(),
    async ({ user, body }) => {
      const input = body as { caption?: string; imageUrl?: string };
      const caption = typeof input?.caption === 'string' ? input.caption.trim() : '';
      const imageUrl = typeof input?.imageUrl === 'string' ? input.imageUrl.trim() : '';
      if (!imageUrl) return error('Add a publicly accessible image URL before publishing to Instagram.', 400);
      if (caption.length > 2200) return error('Instagram captions can contain up to 2,200 characters.', 400);
      let parsedImageUrl: URL;
      try { parsedImageUrl = new URL(imageUrl); } catch { return error('Enter a valid image URL.', 400); }
      if (parsedImageUrl.protocol !== 'https:') return error('Instagram image URLs must use HTTPS.', 400);

      const connection = await findConnection(FACEBOOK_PROVIDER, user!.userId);
      const page = (Array.isArray(connection?.pages) ? connection.pages : []).find((item: { instagramAccountId?: string; accessToken?: string }) => item.instagramAccountId && item.accessToken);
      if (!page) return error('Reconnect Facebook and approve Instagram permissions for the linked professional account.', 409);

      try {
        const createUrl = new URL(`https://graph.facebook.com/v22.0/${encodeURIComponent(page.instagramAccountId)}/media`);
        const createResponse = await fetch(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ image_url: imageUrl, caption, access_token: page.accessToken }).toString(),
        });
        const createPayload = await createResponse.json() as { id?: string; error?: { message?: string; code?: number; error_subcode?: number } };
        if (!createResponse.ok || !createPayload.id) {
          console.error('Instagram media container creation failed', { status: createResponse.status, code: createPayload.error?.code, subcode: createPayload.error?.error_subcode });
          return error(createPayload.error?.message || 'Instagram could not prepare this image. Check that the image URL is public and try again.', 502);
        }
        const statusUrl = new URL(`https://graph.facebook.com/v22.0/${encodeURIComponent(createPayload.id)}`);
        statusUrl.search = new URLSearchParams({
          fields: 'status_code',
          access_token: page.accessToken,
        }).toString();

        let containerStatus = '';
        const maxChecks = 30;
        for (let attempt = 0; attempt < maxChecks; attempt += 1) {
          const statusResponse = await fetch(statusUrl);
          const statusPayload = await statusResponse.json() as {
            status_code?: string;
            error?: { message?: string; code?: number; error_subcode?: number };
          };
          if (!statusResponse.ok) {
            console.error('Instagram media status check failed', {
              status: statusResponse.status,
              code: statusPayload.error?.code,
              subcode: statusPayload.error?.error_subcode,
            });
            return error(statusPayload.error?.message || 'Instagram could not check whether the image is ready. Please try again later.', 502);
          }

          containerStatus = String(statusPayload.status_code ?? '').toUpperCase();
          if (containerStatus === 'FINISHED') break;
          if (containerStatus === 'ERROR' || containerStatus === 'EXPIRED') {
            console.error('Instagram media container is not publishable', { status: containerStatus });
            return error(`Instagram could not prepare this image (container status: ${containerStatus}). Check the image URL and try again.`, 502);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (containerStatus !== 'FINISHED') {
          console.error('Instagram media container did not finish processing in time', { status: containerStatus || 'UNKNOWN' });
          return error('Instagram is still preparing this image. Please check your Instagram profile before trying again.', 504);
        }

        const publishUrl = new URL(`https://graph.facebook.com/v22.0/${encodeURIComponent(page.instagramAccountId)}/media_publish`);
        const publishResponse = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ creation_id: createPayload.id, access_token: page.accessToken }).toString(),
        });
        const publishPayload = await publishResponse.json() as { id?: string; error?: { message?: string; code?: number; error_subcode?: number } };
        if (!publishResponse.ok || !publishPayload.id) {
          console.error('Instagram media publish failed', { status: publishResponse.status, code: publishPayload.error?.code, subcode: publishPayload.error?.error_subcode });
          return error(publishPayload.error?.message || 'Instagram did not confirm publication. Check your profile before retrying.', 502);
        }
        return json({ published: true, mediaId: publishPayload.id, username: connection?.instagramUsername });
      } catch (caught) {
        console.error('Instagram publishing request failed:', caught instanceof Error ? caught.message : 'Unknown error');
        return error('Instagram publishing could not be completed. Please check your profile before retrying.', 502);
      }
    },
  ],

  'POST /api/threads/publish': [
    requireAuth(),
    async ({ user, body }) => {
      const input = body as { text?: string };
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      if (!text) return error('Write a Threads post before publishing.', 400);
      if (text.length > 500) return error('Threads text posts can contain up to 500 characters.', 400);

      const connection = await findConnection(THREADS_PROVIDER, user!.userId);
      if (!connection?.accessToken) return error('Connect your Threads account before publishing.', 409);

      const headers = {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      try {
        const createUrl = new URL('https://graph.threads.net/v1.0/me/threads');
        const createResponse = await fetch(createUrl, {
          method: 'POST',
          headers,
          body: new URLSearchParams({ media_type: 'TEXT', text }).toString(),
        });
        const createPayload = await createResponse.json() as {
          id?: string;
          error?: { message?: string; code?: number; error_subcode?: number };
        };
        if (!createResponse.ok || !createPayload.id) {
          console.error('Threads container creation failed', {
            status: createResponse.status,
            code: createPayload.error?.code,
            subcode: createPayload.error?.error_subcode,
          });
          return error(createPayload.error?.message || 'Threads could not prepare this post. Check your authorization and try again.', 502);
        }

        const statusUrl = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(createPayload.id)}`);
        statusUrl.search = new URLSearchParams({ fields: 'status,error_message' }).toString();

        let containerStatus = '';
        let containerError = '';
        const maxChecks = 30;
        for (let attempt = 0; attempt < maxChecks; attempt += 1) {
          const statusResponse = await fetch(statusUrl, { headers: { Authorization: headers.Authorization } });
          const statusPayload = await statusResponse.json() as {
            status?: string;
            error_message?: string;
            error?: { message?: string; code?: number; error_subcode?: number };
          };
          if (!statusResponse.ok) {
            console.error('Threads container status check failed', {
              status: statusResponse.status,
              code: statusPayload.error?.code,
              subcode: statusPayload.error?.error_subcode,
            });
            return error(statusPayload.error?.message || 'Threads could not check whether the post is ready. Please try again later.', 502);
          }

          containerStatus = String(statusPayload.status ?? '').toUpperCase();
          containerError = statusPayload.error_message ?? '';
          if (containerStatus === 'FINISHED' || containerStatus === 'PUBLISHED') break;
          if (containerStatus === 'ERROR' || containerStatus === 'EXPIRED') {
            console.error('Threads container is not publishable', { status: containerStatus, error: containerError });
            return error(containerError || `Threads could not prepare this post (container status: ${containerStatus}).`, 502);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (containerStatus !== 'FINISHED') {
          if (containerStatus === 'PUBLISHED') {
            return error('Threads reports this post container is already published. Check your Threads profile before trying again.', 409);
          }
          console.error('Threads container did not finish processing in time', { status: containerStatus || 'UNKNOWN' });
          return error('Threads is still preparing this post. Please check your Threads profile before trying again.', 504);
        }

        const publishUrl = new URL('https://graph.threads.net/v1.0/me/threads_publish');
        const publishResponse = await fetch(publishUrl, {
          method: 'POST',
          headers,
          body: new URLSearchParams({ creation_id: createPayload.id }).toString(),
        });
        const publishPayload = await publishResponse.json() as {
          id?: string;
          error?: { message?: string; code?: number; error_subcode?: number };
        };
        if (!publishResponse.ok || !publishPayload.id) {
          console.error('Threads container publish failed', {
            status: publishResponse.status,
            code: publishPayload.error?.code,
            subcode: publishPayload.error?.error_subcode,
            containerCreated: true,
            containerStatus,
          });
          return error(publishPayload.error?.message || 'Threads prepared the post but did not confirm publication. Check Threads before retrying to avoid a duplicate.', 502);
        }

        return json({ published: true, mediaId: publishPayload.id });
      } catch (caught) {
        console.error('Threads publishing request failed:', caught instanceof Error ? caught.message : 'Unknown error');
        return error('Threads publishing could not be completed. Please try again.', 502);
      }
    },
  ],
  });
