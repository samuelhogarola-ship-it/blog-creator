import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import {
  expectedCanonical,
  getCanonical,
  getElement,
  getMeta,
  getTitle,
  replaceElementInner,
  replaceJsonLdString,
  replaceMeta,
  replaceTitle,
  reviewDraft,
  safeChild,
  stripTags,
  toSiteRelativeUrl
} from "./lib/html.js";
import { createWordpressClient, wordpressReady } from "./lib/wordpress.js";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const CONFIG_PATH = process.env.BLOG_CREATOR_CONFIG || path.join(APP_ROOT, "config", "sites.json");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4545);
const MAX_BODY = 18 * 1024 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const sitesConfig = JSON.parse(await fsp.readFile(CONFIG_PATH, "utf8"));

function siteById(id) {
  const site = sitesConfig.sites.find((entry) => entry.id === id);
  if (!site) throw httpError(404, "Web no encontrada");
  return site;
}

function postPath(site, slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw httpError(400, "Slug no válido");
  return safeChild(site.root, site.postsDirectory, slug, "index.html");
}

async function scanPosts(site) {
  if (site.type === "wordpress") return scanWordpressPosts(site);
  const directory = safeChild(site.root, site.postsDirectory);
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const canonical = [];
  const aliases = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = postPath(site, entry.name);
    if (!fs.existsSync(file)) continue;
    const html = await fsp.readFile(file, "utf8");
    const pageCanonical = getCanonical(html);
    const expected = expectedCanonical(site, entry.name);
    const robots = getMeta(html, "robots");
    const item = {
      slug: entry.name,
      title: getTitle(html),
      canonical: pageCanonical,
      robots,
      url: expected,
      targetSlug: site.aliases?.[entry.name] || (pageCanonical.startsWith(`${site.baseUrl}/${site.postsDirectory}/`)
        ? pageCanonical.split(`/${site.postsDirectory}/`)[1]?.split("/")[0] || ""
        : "")
    };
    if (pageCanonical === expected && !/noindex/i.test(robots)) canonical.push(item);
    else aliases.push(item);
  }
  canonical.sort((a, b) => a.title.localeCompare(b.title, "es"));
  aliases.sort((a, b) => a.slug.localeCompare(b.slug, "es"));
  return { canonical, aliases };
}

async function scanWordpressPosts(site) {
  if (!wordpressReady(site)) throw httpError(412, "WordPress no está conectado: configura la Application Password del editor.");
  const posts = await createWordpressClient(site).listPosts();
  return {
    canonical: posts.map((post) => ({
      slug: String(post.id),
      title: post.title?.rendered || post.title?.raw || "Sin título",
      canonical: post.link || "",
      robots: "",
      url: post.link || "",
      targetSlug: ""
    })),
    aliases: []
  };
}

async function readPost(site, slug) {
  if (site.type === "wordpress") return readWordpressPost(site, slug);
  const file = postPath(site, slug);
  const html = await fsp.readFile(file, "utf8");
  const article = getElement(html, "article");
  if (!article) throw httpError(422, "No se encontró el artículo editable");
  const canonical = getCanonical(html);
  const ogImage = getMeta(html, "og:image", "property");
  const h1 = (article.innerHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
  return {
    slug,
    title: getTitle(html),
    description: getMeta(html, "description"),
    canonical,
    robots: getMeta(html, "robots"),
    h1Text: stripTags(h1),
    image: toSiteRelativeUrl(ogImage, site.baseUrl),
    imageAlt: getMeta(html, "og:image:alt", "property"),
    contentHtml: article.innerHtml,
    liveUrl: expectedCanonical(site, slug)
  };
}

async function readWordpressPost(site, id) {
  if (!wordpressReady(site)) throw httpError(412, "WordPress no está conectado: configura la Application Password del editor.");
  const post = await createWordpressClient(site).readPost(id);
  return {
    slug: String(post.id),
    title: post.title?.raw || post.title?.rendered || "",
    description: post.excerpt?.raw || stripTags(post.excerpt?.rendered || ""),
    canonical: post.link || "",
    robots: "",
    h1Text: post.title?.raw || post.title?.rendered || "",
    image: post.featured_media ? "" : "",
    imageAlt: "",
    contentHtml: post.content?.raw || post.content?.rendered || "",
    liveUrl: post.link || "",
    status: post.status || "draft"
  };
}

async function savePost(site, slug, draft, force = false) {
  if (site.type === "wordpress") return saveWordpressPost(site, slug, draft);
  const file = postPath(site, slug);
  const currentHtml = await fsp.readFile(file, "utf8");
  const article = getElement(currentHtml, "article");
  if (!article) throw httpError(422, "No se encontró el artículo editable");
  const canonical = getCanonical(currentHtml);
  const robots = getMeta(currentHtml, "robots");
  const review = reviewDraft({ site, slug, ...draft, canonical, robots });
  if (!review.ok && !force) {
    const error = httpError(422, "La revisión SEO ha detectado errores que debes corregir.");
    error.review = review;
    throw error;
  }

  let nextHtml = replaceElementInner(currentHtml, article, draft.contentHtml);
  nextHtml = replaceTitle(nextHtml, draft.title.trim());
  nextHtml = replaceMeta(nextHtml, "description", draft.description.trim());
  nextHtml = replaceMeta(nextHtml, "og:title", draft.title.trim(), "property");
  nextHtml = replaceMeta(nextHtml, "og:description", draft.description.trim(), "property");
  nextHtml = replaceMeta(nextHtml, "twitter:title", draft.title.trim());
  nextHtml = replaceMeta(nextHtml, "twitter:description", draft.description.trim());
  nextHtml = replaceJsonLdString(nextHtml, "headline", draft.title.trim());
  nextHtml = replaceJsonLdString(nextHtml, "description", draft.description.trim());

  const backupDir = safeChild(APP_ROOT, "data", "backups", site.id, slug);
  await fsp.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  await fsp.writeFile(path.join(backupDir, `${stamp}.html`), currentHtml, "utf8");
  await atomicWrite(file, nextHtml);
  return { saved: true, review, file };
}

async function saveWordpressPost(site, id, draft) {
  if (!wordpressReady(site)) throw httpError(412, "WordPress no está conectado: configura la Application Password del editor.");
  const review = reviewDraft({ site, slug: String(id), ...draft, canonical: draft.canonical || "", robots: "" });
  if (!review.ok && !draft.force) {
    const error = httpError(422, "La revisión SEO ha detectado errores que debes corregir.");
    error.review = review;
    throw error;
  }
  const post = await createWordpressClient(site).updatePost(id, {
    title: draft.title.trim(),
    excerpt: draft.description.trim(),
    content: draft.contentHtml,
    status: draft.status || "draft"
  });
  return { saved: true, review, post: { id: post.id, link: post.link, status: post.status } };
}

async function uploadImage(site, body) {
  if (site.type === "wordpress") {
    if (!wordpressReady(site)) throw httpError(412, "WordPress no está conectado: configura la Application Password del editor.");
    const media = await createWordpressClient(site).uploadMedia(body);
    return { url: media.source_url, mediaId: media.id };
  }
  const extensionByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const extension = extensionByMime[body.mime];
  if (!extension) throw httpError(415, "Formato de imagen no permitido");
  const base = String(body.filename || "imagen")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imagen";
  const filename = `${base.replace(/\.(jpg|jpeg|png|webp|gif)$/i, "")}${extension}`;
  const directory = safeChild(site.root, site.imageDirectory);
  await fsp.mkdir(directory, { recursive: true });
  const target = safeChild(directory, filename);
  const bytes = Buffer.from(String(body.data || ""), "base64");
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw httpError(413, "Imagen vacía o demasiado grande");
  await fsp.writeFile(target, bytes, { flag: "wx" }).catch((error) => {
    if (error.code === "EEXIST") throw httpError(409, "Ya existe una imagen con ese nombre");
    throw error;
  });
  return { url: `/${site.imageDirectory}/${filename}` };
}

async function runSiteAudit(site) {
  if (!site.siteAuditCommand) throw httpError(400, "Esta web no tiene auditoría configurada");
  const [command, ...args] = site.siteAuditCommand.split(/\s+/);
  return new Promise((resolve) => {
    execFile(command, args, { cwd: site.root, timeout: 120000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout || ""}${stderr || ""}`.trim() });
    });
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (url.pathname === "/api/sites" && request.method === "GET") {
      return json(response, 200, { sites: sitesConfig.sites.map(({ root, ...site }) => ({ ...site, wordpressReady: site.type === "wordpress" ? wordpressReady(site) : undefined })) });
    }
    if (url.pathname === "/api/wordpress/preflight" && request.method === "POST") {
      const body = await readJson(request);
      const site = siteById(body.site);
      if (site.type !== "wordpress") throw httpError(400, "Esta web no usa el adaptador WordPress");
      if (!wordpressReady(site)) throw httpError(412, "Faltan BLOG_CREATOR_WP_USERNAME y BLOG_CREATOR_WP_APPLICATION_PASSWORD");
      return json(response, 200, await createWordpressClient(site).preflight());
    }
    if (url.pathname === "/api/wordpress/posts" && request.method === "POST") {
      const body = await readJson(request);
      const site = siteById(body.site);
      if (site.type !== "wordpress") throw httpError(400, "Esta web no usa el adaptador WordPress");
      if (!wordpressReady(site)) throw httpError(412, "WordPress no está conectado: configura la Application Password del editor.");
      const draft = body.draft || {};
      const post = await createWordpressClient(site).createPost({ title: String(draft.title || "Sin título"), excerpt: String(draft.description || ""), content: String(draft.contentHtml || ""), status: "draft" });
      return json(response, 201, { id: post.id, link: post.link, status: post.status });
    }
    if (url.pathname === "/api/posts" && request.method === "GET") {
      return json(response, 200, await scanPosts(siteById(url.searchParams.get("site"))));
    }
    if (url.pathname.startsWith("/api/posts/")) {
      const slug = decodeURIComponent(url.pathname.slice("/api/posts/".length));
      const site = siteById(url.searchParams.get("site"));
      if (request.method === "GET") return json(response, 200, await readPost(site, slug));
      if (request.method === "PUT") {
        const body = await readJson(request);
        return json(response, 200, await savePost(site, slug, body.draft, Boolean(body.force)));
      }
    }
    if (url.pathname === "/api/review" && request.method === "POST") {
      const body = await readJson(request);
      const site = siteById(body.site);
      const current = await readPost(site, body.slug);
      return json(response, 200, reviewDraft({
        site,
        slug: body.slug,
        ...body.draft,
        canonical: current.canonical,
        robots: current.robots
      }));
    }
    if (url.pathname === "/api/upload" && request.method === "POST") {
      const body = await readJson(request);
      return json(response, 201, await uploadImage(siteById(body.site), body));
    }
    if (url.pathname === "/api/site-audit" && request.method === "POST") {
      const body = await readJson(request);
      return json(response, 200, await runSiteAudit(siteById(body.site)));
    }
    if (url.pathname.startsWith("/site-assets/") && request.method === "GET") {
      const siteId = url.searchParams.get("site");
      const site = siteById(siteId);
      const relative = decodeURIComponent(url.pathname.slice("/site-assets/".length));
      const file = safeChild(site.root, relative);
      return await serveFile(response, file);
    }
    if (request.method === "GET") {
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      return await serveFile(response, safeChild(PUBLIC_ROOT, relative));
    }
    throw httpError(404, "Ruta no encontrada");
  } catch (error) {
    const status = error.status || 500;
    json(response, status, { error: error.message || "Error interno", review: error.review });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Blog Creator listo en http://${HOST}:${PORT}`);
});

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, "Petición demasiado grande");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function atomicWrite(file, content) {
  const temp = `${file}.blog-creator-${process.pid}.tmp`;
  await fsp.writeFile(temp, content, "utf8");
  await fsp.rename(temp, file);
}

async function serveFile(response, file) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) throw httpError(404, "Archivo no encontrado");
  response.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(file).pipe(response);
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
