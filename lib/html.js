import path from "node:path";

export function decodeHtml(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function encodeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function getTitle(html) {
  return decodeHtml((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
}

export function getMeta(html, key, attribute = "name") {
  const escapedKey = escapeRegExp(key);
  const patterns = [
    new RegExp(`<meta\\b[^>]*\\b${attribute}=["']${escapedKey}["'][^>]*\\bcontent=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attribute}=["']${escapedKey}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return "";
}

export function getCanonical(html) {
  const patterns = [
    /<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["'][^>]*>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return "";
}

export function getElement(html, tagName, startAt = 0) {
  const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tokenPattern.lastIndex = startAt;
  const first = tokenPattern.exec(html);
  if (!first || first[0].startsWith("</")) return null;
  const openStart = first.index;
  const contentStart = tokenPattern.lastIndex;
  let depth = 1;
  let token;
  while ((token = tokenPattern.exec(html))) {
    depth += token[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return {
        openStart,
        contentStart,
        contentEnd: token.index,
        closeEnd: tokenPattern.lastIndex,
        openTag: first[0],
        innerHtml: html.slice(contentStart, token.index)
      };
    }
  }
  return null;
}

export function replaceElementInner(html, element, innerHtml) {
  return html.slice(0, element.contentStart) + innerHtml + html.slice(element.contentEnd);
}

export function replaceTitle(html, value) {
  const safe = encodeHtml(value);
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safe}</title>`);
}

export function replaceMeta(html, key, value, attribute = "name") {
  const safe = encodeHtml(value);
  const escapedKey = escapeRegExp(key);
  const patterns = [
    new RegExp(`(<meta\\b[^>]*\\b${attribute}=["']${escapedKey}["'][^>]*\\bcontent=["'])[^"']*(["'][^>]*>)`, "i"),
    new RegExp(`(<meta\\b[^>]*\\bcontent=["'])[^"']*(["'][^>]*\\b${attribute}=["']${escapedKey}["'][^>]*>)`, "i")
  ];
  for (const pattern of patterns) {
    if (pattern.test(html)) return html.replace(pattern, `$1${safe}$2`);
  }
  return html.replace(/<\/head>/i, `  <meta ${attribute}="${encodeHtml(key)}" content="${safe}">\n</head>`);
}

export function replaceJsonLdString(html, key, value) {
  const safe = JSON.stringify(String(value)).slice(1, -1);
  const pattern = new RegExp(`("${escapeRegExp(key)}"\\s*:\\s*")[^"]*(")`, "i");
  return pattern.test(html) ? html.replace(pattern, `$1${safe}$2`) : html;
}

export function toSiteRelativeUrl(absoluteUrl, baseUrl) {
  if (!absoluteUrl) return "";
  return absoluteUrl.startsWith(baseUrl) ? absoluteUrl.slice(baseUrl.length) || "/" : absoluteUrl;
}

export function expectedCanonical(site, slug) {
  return `${site.baseUrl}/${site.postsDirectory}/${slug}/`;
}

export function safeChild(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...parts);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Ruta no permitida");
  }
  return candidate;
}

export function reviewDraft({ site, slug, title, description, contentHtml, canonical, robots }) {
  const issues = [];
  const warnings = [];
  const expected = expectedCanonical(site, slug);
  const text = stripTags(contentHtml);
  const words = text ? text.split(/\s+/).length : 0;
  const h1Count = (contentHtml.match(/<h1\b/gi) || []).length;
  const h2Count = (contentHtml.match(/<h2\b/gi) || []).length;
  const images = [...contentHtml.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const imagesWithoutAlt = images.filter((img) => !/\balt=["'][^"']+["']/i.test(img)).length;

  if (!title.trim()) issues.push("Falta el título SEO.");
  if (title.length > 65) warnings.push(`El título tiene ${title.length} caracteres; intenta dejarlo entre 45 y 65.`);
  if (title.length > 0 && title.length < 30) warnings.push(`El título es corto (${title.length} caracteres).`);
  if (!description.trim()) issues.push("Falta la meta description.");
  if (description.length > 165) warnings.push(`La descripción tiene ${description.length} caracteres; intenta no superar 165.`);
  if (description.length > 0 && description.length < 110) warnings.push(`La descripción es corta (${description.length} caracteres).`);
  if (canonical !== expected) issues.push(`La canonical debe ser ${expected}`);
  if (/noindex/i.test(robots)) issues.push("El post canónico está marcado como noindex.");
  if (h1Count !== 1) issues.push(`Debe haber exactamente un H1; ahora hay ${h1Count}.`);
  if (h2Count === 0) warnings.push("El contenido no tiene ningún H2.");
  if (words < 300) warnings.push(`El contenido tiene unas ${words} palabras; revisa si responde con suficiente profundidad.`);
  if (imagesWithoutAlt) issues.push(`${imagesWithoutAlt} imagen/imágenes no tienen texto alt.`);
  if (!/application\/ld\+json/i.test(contentHtml) && words > 0) {
    // El JSON-LD suele estar en head, por eso no se considera error aquí.
  }

  return {
    ok: issues.length === 0,
    score: Math.max(0, 100 - issues.length * 18 - warnings.length * 5),
    issues,
    warnings,
    stats: { words, h1Count, h2Count, images: images.length, imagesWithoutAlt }
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
