const state = {
  sites: [],
  site: "",
  posts: [],
  aliases: [],
  activeSlug: "",
  dirty: false,
  draft: null,
  mode: "visual",
  selectedImage: null,
  savedSelection: null
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  siteSelect: $("#siteSelect"),
  auditSiteButton: $("#auditSiteButton"),
  postSearch: $("#postSearch"),
  postList: $("#postList"),
  postCount: $("#postCount"),
  aliasList: $("#aliasList"),
  aliasCount: $("#aliasCount"),
  emptyState: $("#emptyState"),
  editorForm: $("#editorForm"),
  editorName: $("#editorName"),
  editorStatus: $("#editorStatus"),
  liveLink: $("#liveLink"),
  seoTitle: $("#seoTitle"),
  seoDescription: $("#seoDescription"),
  slug: $("#slug"),
  canonical: $("#canonical"),
  titleCounter: $("#titleCounter"),
  descriptionCounter: $("#descriptionCounter"),
  contentEditor: $("#contentEditor"),
  htmlSourceEditor: $("#htmlSourceEditor"),
  visualModeButton: $("#visualModeButton"),
  htmlModeButton: $("#htmlModeButton"),
  toolbar: $(".toolbar"),
  reviewPanel: $("#reviewPanel"),
  reviewButton: $("#reviewButton"),
  saveButton: $("#saveButton"),
  imageButton: $("#imageButton"),
  moveImageUpButton: $("#moveImageUpButton"),
  moveImageDownButton: $("#moveImageDownButton"),
  removeImageButton: $("#removeImageButton"),
  imageInput: $("#imageInput"),
  linkButton: $("#linkButton"),
  toast: $("#toast"),
  auditDialog: $("#auditDialog"),
  auditOutput: $("#auditOutput"),
  closeAudit: $("#closeAudit")
};

await initialise();

async function initialise() {
  const data = await api("/api/sites");
  state.sites = data.sites;
  elements.siteSelect.innerHTML = state.sites
    .map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)}</option>`).join("");
  state.site = state.sites[0]?.id || "";
  bindEvents();
  if (state.site) await loadPosts();
}

function bindEvents() {
  elements.siteSelect.addEventListener("change", async () => {
    if (!confirmDiscard()) return elements.siteSelect.value = state.site;
    state.site = elements.siteSelect.value;
    closeEditor();
    await loadPosts();
  });
  elements.postSearch.addEventListener("input", renderPosts);
  elements.editorForm.addEventListener("input", () => markDirty());
  elements.editorForm.addEventListener("submit", saveActivePost);
  elements.reviewButton.addEventListener("click", reviewActivePost);
  elements.auditSiteButton.addEventListener("click", auditSite);
  elements.closeAudit.addEventListener("click", () => elements.auditDialog.close());
  elements.visualModeButton.addEventListener("click", () => setEditorMode("visual"));
  elements.htmlModeButton.addEventListener("click", () => setEditorMode("html"));
  elements.imageButton.addEventListener("click", beginImageInsert);
  elements.imageInput.addEventListener("change", uploadSelectedImage);
  elements.moveImageUpButton.addEventListener("click", () => moveSelectedImage(-1));
  elements.moveImageDownButton.addEventListener("click", () => moveSelectedImage(1));
  elements.removeImageButton.addEventListener("click", removeSelectedImage);
  elements.linkButton.addEventListener("click", insertLink);
  elements.contentEditor.addEventListener("click", selectImageFromClick);
  elements.contentEditor.addEventListener("keyup", rememberSelection);
  elements.contentEditor.addEventListener("mouseup", rememberSelection);
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.contentEditor.focus();
      document.execCommand(button.dataset.command, false);
      markDirty();
    });
  });
  document.querySelectorAll("[data-block]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.contentEditor.focus();
      document.execCommand("formatBlock", false, button.dataset.block);
      markDirty();
    });
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function loadPosts() {
  setBusy(true);
  try {
    const data = await api(`/api/posts?site=${encodeURIComponent(state.site)}`);
    state.posts = data.canonical;
    state.aliases = data.aliases;
    elements.postCount.textContent = state.posts.length;
    elements.aliasCount.textContent = state.aliases.length;
    renderPosts();
    renderAliases();
  } finally {
    setBusy(false);
  }
}

function renderPosts() {
  const query = normalise(elements.postSearch.value);
  const visible = state.posts.filter((post) => normalise(`${post.title} ${post.slug}`).includes(query));
  elements.postList.innerHTML = visible.map((post) => `
    <button class="post-item ${post.slug === state.activeSlug ? "active" : ""}" data-slug="${escapeHtml(post.slug)}">
      <span>${escapeHtml(cleanBrand(post.title))}</span>
      <small>/${escapeHtml(post.slug)}/</small>
    </button>`).join("") || `<p class="no-results">No hay coincidencias.</p>`;
  elements.postList.querySelectorAll(".post-item").forEach((button) => {
    button.addEventListener("click", () => openPost(button.dataset.slug));
  });
}

function renderAliases() {
  elements.aliasList.innerHTML = state.aliases.map((item) => `
    <div class="alias-item">
      <span>/${escapeHtml(item.slug)}/</span>
      <small>${item.targetSlug ? `→ /${escapeHtml(item.targetSlug)}/` : escapeHtml(item.robots || "no canónica")}</small>
    </div>`).join("");
}

async function openPost(slug) {
  if (slug === state.activeSlug || !confirmDiscard()) return;
  setBusy(true);
  try {
    const post = await api(`/api/posts/${encodeURIComponent(slug)}?site=${encodeURIComponent(state.site)}`);
    state.activeSlug = slug;
    state.draft = post;
    state.dirty = false;
    state.mode = "visual";
    state.selectedImage = null;
    state.savedSelection = null;
    elements.emptyState.classList.add("hidden");
    elements.editorForm.classList.remove("hidden");
    elements.editorName.textContent = cleanBrand(post.title);
    elements.liveLink.href = post.liveUrl;
    elements.seoTitle.value = post.title;
    elements.seoDescription.value = post.description;
    elements.slug.value = post.slug;
    elements.canonical.value = post.canonical;
    elements.contentEditor.innerHTML = rewriteAssetUrlsForEditor(post.contentHtml);
    elements.htmlSourceEditor.value = post.contentHtml;
    setEditorMode("visual");
    updateImageControls();
    elements.reviewPanel.classList.add("hidden");
    updateCounters();
    setStatus("Sin cambios");
    renderPosts();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } finally {
    setBusy(false);
  }
}

async function reviewActivePost() {
  if (!state.activeSlug) return;
  setBusy(true);
  try {
    const review = await api("/api/review", {
      method: "POST",
      body: JSON.stringify({ site: state.site, slug: state.activeSlug, draft: collectDraft() })
    });
    showReview(review);
    return review;
  } finally {
    setBusy(false);
  }
}

async function saveActivePost(event) {
  event.preventDefault();
  setBusy(true);
  try {
    const result = await api(`/api/posts/${encodeURIComponent(state.activeSlug)}?site=${encodeURIComponent(state.site)}`, {
      method: "PUT",
      body: JSON.stringify({ draft: collectDraft() })
    });
    state.dirty = false;
    showReview(result.review);
    setStatus("Guardado");
    toast("Post guardado y copia de seguridad creada.");
    await loadPosts();
  } catch (error) {
    if (error.payload?.review) showReview(error.payload.review);
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function collectDraft() {
  return {
    title: elements.seoTitle.value,
    description: elements.seoDescription.value,
    contentHtml: getCurrentContentHtml()
  };
}

function getCurrentContentHtml() {
  return state.mode === "html"
    ? stripEditorState(elements.htmlSourceEditor.value)
    : stripEditorState(restoreAssetUrls(elements.contentEditor.innerHTML));
}

function setEditorMode(mode) {
  if (mode === state.mode && !elements.contentEditor.classList.contains("hidden")) return;
  if (mode === "html") {
    clearSelectedImage(false);
    elements.htmlSourceEditor.value = getCurrentContentHtml();
    elements.contentEditor.classList.add("hidden");
    elements.htmlSourceEditor.classList.remove("hidden");
    elements.toolbar.classList.add("hidden");
    elements.htmlModeButton.classList.add("active");
    elements.visualModeButton.classList.remove("active");
    elements.htmlModeButton.setAttribute("aria-selected", "true");
    elements.visualModeButton.setAttribute("aria-selected", "false");
    elements.imageButton.disabled = true;
    elements.moveImageUpButton.disabled = true;
    elements.moveImageDownButton.disabled = true;
    elements.removeImageButton.disabled = true;
    state.mode = "html";
    return;
  }
  elements.contentEditor.innerHTML = rewriteAssetUrlsForEditor(elements.htmlSourceEditor.value);
  elements.htmlSourceEditor.classList.add("hidden");
  elements.contentEditor.classList.remove("hidden");
  elements.toolbar.classList.remove("hidden");
  elements.visualModeButton.classList.add("active");
  elements.htmlModeButton.classList.remove("active");
  elements.visualModeButton.setAttribute("aria-selected", "true");
  elements.htmlModeButton.setAttribute("aria-selected", "false");
  state.mode = "visual";
  updateImageControls();
}

function stripEditorState(html) {
  return html.replace(/\sclass=(['"])([^'"]*)\1/gi, (_, quote, classes) => {
    const cleanClasses = classes.split(/\s+/).filter((name) => name && name !== "image-selected").join(" ");
    return cleanClasses ? ` class=${quote}${cleanClasses}${quote}` : "";
  });
}

function beginImageInsert() {
  rememberSelection();
  elements.imageInput.click();
}

function rememberSelection() {
  if (state.mode !== "visual") return;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (elements.contentEditor.contains(range.commonAncestorContainer)) {
    state.savedSelection = range.cloneRange();
  }
}

function selectImageFromClick(event) {
  const image = event.target.closest?.("img");
  const block = image ? image.closest("figure") || imageBlockParent(image) || image : null;
  if (!block || !elements.contentEditor.contains(block)) {
    clearSelectedImage();
    return;
  }
  clearSelectedImage(false);
  state.selectedImage = block;
  block.classList.add("image-selected");
  updateImageControls();
}

function imageBlockParent(image) {
  const parent = image.parentElement;
  if (!parent || parent === elements.contentEditor) return null;
  if (parent.children.length !== 1) return null;
  if (["P", "H1", "H2", "H3", "H4", "LI", "TD", "TH"].includes(parent.tagName)) return null;
  return parent;
}

function clearSelectedImage(update = true) {
  state.selectedImage?.classList.remove("image-selected");
  state.selectedImage = null;
  if (update) updateImageControls();
}

function moveSelectedImage(direction) {
  const selected = state.selectedImage;
  if (!selected || !selected.parentElement) return;
  const sibling = direction < 0 ? selected.previousElementSibling : selected.nextElementSibling;
  if (!sibling) return toast(direction < 0 ? "La imagen ya está arriba." : "La imagen ya está abajo.", true);
  if (direction < 0) selected.parentElement.insertBefore(selected, sibling);
  else selected.parentElement.insertBefore(sibling, selected);
  markDirty();
  toast(direction < 0 ? "Imagen movida arriba." : "Imagen movida abajo.");
  updateImageControls();
}

function removeSelectedImage() {
  const selected = state.selectedImage;
  if (!selected) return;
  if (!window.confirm("¿Eliminar esta imagen del artículo? El archivo original se conservará en la carpeta de imágenes.")) return;
  selected.remove();
  clearSelectedImage();
  markDirty();
  toast("Imagen eliminada del artículo. El archivo original se conserva.");
}

function updateImageControls() {
  const selected = state.mode === "visual" ? state.selectedImage : null;
  elements.imageButton.disabled = state.mode !== "visual";
  elements.moveImageUpButton.disabled = !selected || !selected.previousElementSibling;
  elements.moveImageDownButton.disabled = !selected || !selected.nextElementSibling;
  elements.removeImageButton.disabled = !selected;
}

function showReview(review) {
  const tone = review.ok ? "good" : "bad";
  elements.reviewPanel.className = `review-panel ${tone}`;
  elements.reviewPanel.innerHTML = `
    <div class="review-score"><strong>${review.score}</strong><span>/100</span></div>
    <div>
      <h3>${review.ok ? "SEO técnico listo" : "Hay errores antes de guardar"}</h3>
      ${review.issues.length ? `<ul>${review.issues.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${review.warnings.length ? `<p class="warning-title">Recomendaciones</p><ul>${review.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      <small>${review.stats.words} palabras · ${review.stats.h2Count} H2 · ${review.stats.images} imágenes</small>
    </div>`;
  elements.reviewPanel.classList.remove("hidden");
  elements.reviewPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function uploadSelectedImage() {
  const file = elements.imageInput.files[0];
  if (!file) return;
  const alt = window.prompt("Texto alternativo de la imagen (describe lo que aparece):");
  if (!alt?.trim()) return toast("La imagen necesita un texto alternativo.", true);
  setBusy(true);
  try {
    const data = await fileToBase64(file);
    const uploaded = await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({ site: state.site, filename: file.name, mime: file.type, data })
    });
    restoreSelection();
    const range = state.savedSelection || document.createRange();
    if (!state.savedSelection) {
      range.selectNodeContents(elements.contentEditor);
      range.collapse(false);
    }
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = assetProxy(uploaded.url);
    image.alt = alt.trim();
    image.loading = "lazy";
    image.decoding = "async";
    const caption = document.createElement("figcaption");
    figure.append(image, caption);
    range.deleteContents();
    range.insertNode(figure);
    range.setStartAfter(figure);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    clearSelectedImage(false);
    state.selectedImage = figure;
    figure.classList.add("image-selected");
    updateImageControls();
    markDirty();
    toast("Imagen añadida al post.");
  } finally {
    elements.imageInput.value = "";
    setBusy(false);
  }
}

function restoreSelection() {
  if (!state.savedSelection) return;
  elements.contentEditor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(state.savedSelection);
}

function insertLink() {
  const selection = window.getSelection()?.toString();
  if (!selection) return toast("Selecciona primero el texto que quieres enlazar.", true);
  const url = window.prompt("Dirección del enlace:", "https://");
  if (!url) return;
  elements.contentEditor.focus();
  document.execCommand("createLink", false, url);
  markDirty();
}

async function auditSite() {
  elements.auditOutput.textContent = "Ejecutando auditoría completa…";
  elements.auditDialog.showModal();
  try {
    const result = await api("/api/site-audit", {
      method: "POST",
      body: JSON.stringify({ site: state.site })
    });
    elements.auditOutput.textContent = result.output || (result.ok ? "Auditoría superada." : "La auditoría ha fallado.");
  } catch (error) {
    elements.auditOutput.textContent = error.message;
  }
}

function rewriteAssetUrlsForEditor(html) {
  return html.replace(/\b(src|href)=(["'])(\/(?!\/)[^"']*)\2/gi,
    (_, attr, quote, url) => `${attr}=${quote}${assetProxy(url)}${quote}`);
}

function restoreAssetUrls(html) {
  const prefix = `/site-assets/`;
  return html.replace(new RegExp(`\\b(src|href)=(["'])${prefix}([^"'?]+)\\?site=${encodeURIComponent(state.site)}\\2`, "gi"),
    (_, attr, quote, url) => `${attr}=${quote}/${decodeURIComponent(url)}${quote}`);
}

function assetProxy(url) {
  return `/site-assets/${url.replace(/^\//, "")}?site=${encodeURIComponent(state.site)}`;
}

function markDirty() {
  state.dirty = true;
  setStatus("Cambios sin guardar");
  updateCounters();
}

function updateCounters() {
  elements.titleCounter.textContent = `${elements.seoTitle.value.length}/65`;
  elements.descriptionCounter.textContent = `${elements.seoDescription.value.length}/165`;
}

function setStatus(value) {
  elements.editorStatus.textContent = value;
  elements.editorStatus.dataset.state = value === "Guardado" ? "saved" : state.dirty ? "dirty" : "clean";
}

function closeEditor() {
  state.activeSlug = "";
  state.dirty = false;
  elements.editorForm.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
}

function confirmDiscard() {
  return !state.dirty || window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?");
}

function setBusy(busy) {
  document.body.classList.toggle("busy", busy);
  elements.saveButton.disabled = busy;
  elements.reviewButton.disabled = busy;
}

function toast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${error ? "error" : ""}`;
  window.setTimeout(() => elements.toast.classList.remove("show"), 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "No se pudo completar la operación");
    error.payload = payload;
    throw error;
  }
  return payload;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function cleanBrand(value) {
  return value.replace(/\s*\|\s*Samuel Coach de Alemán\s*$/i, "");
}

function normalise(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[char]);
}
