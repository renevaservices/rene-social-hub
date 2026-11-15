/**
 * Rene Social Hub — Facebook Page publishing helper.
 * NOT connected to the live Worker. No public publishing occurs by adding this file.
 * Caller must supply a secure token resolver and explicitly enable publishing.
 */
export async function publishScheduledFacebookPost({ db, postId, resolvePageAccessToken, enabled = false, fetchImpl = fetch }) {
  if (!enabled) return { ok: false, reason: "publishing_disabled" };
  if (!db || !postId || typeof resolvePageAccessToken !== "function") {
    throw new Error("Missing publisher dependencies");
  }
  // Atomic claim ensures overlapping cron runs cannot publish the same post twice.
  const claim = await db.prepare(
    "UPDATE scheduled_posts SET status = 'processing' WHERE id = ? AND platform = 'facebook' AND status = 'scheduled' AND scheduled_at <= ?"
  ).bind(postId, new Date().toISOString()).run();
  if (claim.meta?.changes !== 1) return { ok: false, reason: "not_due_or_already_claimed" };

  try {
    const post = await db.prepare(
      "SELECT id, content FROM scheduled_posts WHERE id = ? AND status = 'processing'"
    ).bind(postId).first();
    if (!post?.content?.trim()) throw new Error("Empty or missing post");

    // Resolve the encrypted connection inside the Worker. Never log credentials.
    const { pageId, accessToken } = await resolvePageAccessToken(db);
    if (!/^\d+$/.test(String(pageId)) || !accessToken) throw new Error("Facebook Page not connected");

    const response = await fetchImpl(`https://graph.facebook.com/v22.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: post.content, access_token: accessToken }).toString()
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error("Facebook publishing request failed");

    await db.prepare(
      "UPDATE scheduled_posts SET status = 'published', published_at = ?, error_message = NULL WHERE id = ? AND status = 'processing'"
    ).bind(new Date().toISOString(), postId).run();
    return { ok: true, facebookPostId: result.id };
  } catch (error) {
    // Deliberately avoid automatic retry: Facebook might have accepted a post
    // before a network interruption. Review manually to prevent duplicates.
    await db.prepare(
      "UPDATE scheduled_posts SET status = 'failed', error_message = ? WHERE id = ? AND status = 'processing'"
    ).bind("Publishing requires review; check the Facebook Page before retrying.", postId).run();
    return { ok: false, reason: "review_required" };
  }
}
