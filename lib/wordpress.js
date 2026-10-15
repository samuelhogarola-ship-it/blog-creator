const DEFAULT_TIMEOUT = 15000;

export function wordpressConfig(site, env = process.env) {
  const config = site.wordpress || {};
  const baseUrl = String(config.baseUrl || site.baseUrl || "").replace(/\/$/, "");
  return {
    baseUrl,
    apiUrl: String(config.apiUrl || `${baseUrl}/wp-json/wp/v2`).replace(/\/$/, ""),
    username: env[config.usernameEnv || "BLOG_CREATOR_WP_USERNAME"] || "",
    applicationPassword: env[config.passwordEnv || "BLOG_CREATOR_WP_APPLICATION_PASSWORD"] || "",
    timeout: Number(config.timeout || DEFAULT_TIMEOUT)
  };
}

export function wordpressReady(site, env = process.env) {
  const config = wordpressConfig(site, env);
  return Boolean(config.apiUrl && config.username && config.applicationPassword);
}

export function createWordpressClient(site, { fetchImpl = fetch, env = process.env } = {}) {
  const config = wordpressConfig(site, env);
  const credentials = config.username && config.applicationPassword
    ? `Basic ${Buffer.from(`${config.username}:${config.applicationPassword}`).toString("base64")}`
    : "";

  async function request(endpoint, options = {}) {
    if (!config.apiUrl) throw new Error("WordPress no tiene API configurada");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeout);
    const headers = { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) };
    if (credentials) headers.authorization = credentials;
    try {
      const response = await fetchImpl(`${config.apiUrl}/${endpoint.replace(/^\//, "")}`, {
        ...options,
        headers,
        signal: controller.signal
      });
      const text = await response.text();
      let body;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (!response.ok) {
        const error = new Error(body?.message || `WordPress respondió ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async preflight() {
      const body = await request("users/me");
      return { ok: true, user: { id: body.id, name: body.name, slug: body.slug } };
    },
    listPosts({ page = 1, perPage = 100 } = {}) {
      return request(`posts?context=edit&page=${page}&per_page=${perPage}&orderby=modified&order=desc`);
    },
    readPost(id) { return request(`posts/${encodeURIComponent(id)}?context=edit`); },
    createPost(draft) { return request("posts", { method: "POST", body: JSON.stringify(draft) }); },
    updatePost(id, draft) { return request(`posts/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(draft) }); },
    deletePost(id, force = false) { return request(`posts/${encodeURIComponent(id)}?force=${force}`, { method: "DELETE" }); },
    uploadMedia({ filename, mime, data }) {
      const bytes = Buffer.from(data, "base64");
      return request("media", { method: "POST", headers: { "content-type": mime, "content-disposition": `attachment; filename=\"${filename}\"` }, body: bytes });
    }
  };
}
