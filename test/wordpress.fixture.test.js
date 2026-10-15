import assert from "node:assert/strict";
import test from "node:test";
import { createWordpressClient, wordpressReady } from "../lib/wordpress.js";

test("WordPress adapter maps read/write/media operations without real network", async () => {
  const calls = [];
  const client = createWordpressClient({
    baseUrl: "https://fixture.test",
    wordpress: { apiUrl: "https://fixture.test/wp-json/wp/v2" }
  }, {
    env: { BLOG_CREATOR_WP_USERNAME: "editor", BLOG_CREATOR_WP_APPLICATION_PASSWORD: "secret" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      const body = url.endsWith("users/me") ? { id: 7, name: "Editor", slug: "editor" } : { id: 11, title: { rendered: "Fixture" } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(await client.preflight(), { ok: true, user: { id: 7, name: "Editor", slug: "editor" } });
  await client.listPosts();
  await client.readPost(11);
  await client.updatePost(11, { title: "Updated" });
  await client.deletePost(11, true);
  await client.uploadMedia({ filename: "foto.jpg", mime: "image/jpeg", data: Buffer.from("x").toString("base64") });
  assert.equal(calls.length, 6);
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[4].options.method, "DELETE");
  assert.equal(calls[5].options.headers["content-type"], "image/jpeg");
});

test("WordPress adapter stays blocked until credentials exist", () => {
  assert.equal(wordpressReady({ baseUrl: "https://fixture.test", wordpress: {} }, {}), false);
  assert.equal(wordpressReady({ baseUrl: "https://fixture.test", wordpress: {} }, {
    BLOG_CREATOR_WP_USERNAME: "editor",
    BLOG_CREATOR_WP_APPLICATION_PASSWORD: "secret"
  }), true);
});
