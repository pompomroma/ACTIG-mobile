/* ACTIG Vibe Build — the AI code generator. Given a natural-language spec it asks
   the model (via the app's auto-picked brain) to emit a complete, self-contained
   client-side web program, then assembles a live in-browser preview (blob URLs, no
   server), a downloadable ZIP, and — with a GitHub token — a public shareable URL.

   Loaded lazily by app.js via createBuilder(deps). deps = {
     llmGenerate(system, user, {onToken, maxTokens, temperature}),  // from app.js
     store, addBubble,                                              // from app.js
     dom: { iframe, fileList, openBtn, zipBtn, publishBtn, statusEl }
   } */

const SYSTEM = `You are ACTIG Build, a world-class full-stack web engineer. Generate a COMPLETE, production-quality web program that runs ENTIRELY in the browser — no build step, no server.

OUTPUT FORMAT — output ONLY files, nothing else. For each file:
===FILE: <relative/path>===
<full file contents>
After the last file output a final line:
===END===
No explanations, no markdown fences, nothing outside the file blocks.

HARD RULES:
- The entry point MUST be index.html. STRONGLY PREFER a single self-contained index.html with all CSS and JavaScript inline.
- Do NOT use ES module "import" between your own files. Load any libraries from a CDN via <script> tags (e.g. three.js, React UMD, Tone.js).
- Ship polished, responsive, mobile-first, accessible UI; dark-theme friendly; keyboard usable; graceful error handling.
- Persist state with localStorage/IndexedDB when needed. Only call public CORS-friendly APIs, if any.
- For 3D: prefer procedural geometry with three.js from CDN. If a model FILE is required, emit a valid, self-contained glTF 2.0 file (buffers inlined as base64 data URIs) at assets/<name>.gltf and load it with GLTFLoader from CDN.
- Optimize: minimal dependencies, efficient, no dead code, no placeholders — implement the whole thing so it actually works.

Build EXACTLY what the user asks, fully functional and high quality.`;

export function createBuilder(deps) {
  let last = null;               // { files, previewUrl, blobUrls }

  /* ---- generation ---- */
  async function generate(spec, { onStatus, atts = [] } = {}) {
    revokeLast();
    onStatus?.("Designing…");
    let ref = "";
    const texts = atts.filter(a => a.kind === "text" && a.text);
    if (texts.length) {
      ref += "\n\nReference files the user attached — use them as appropriate:";
      for (const a of texts) ref += `\n===FILE: ${a.name}===\n${a.text}`;
    }
    const smallImgs = atts.filter(a => a.kind === "image" && a.dataUrl && a.dataUrl.length < 60000);
    if (smallImgs.length) {
      ref += "\n\nUser-provided images — embed these EXACT data URIs where appropriate (e.g. <img src=…>):";
      for (const a of smallImgs) ref += `\n${a.name}: ${a.dataUrl}`;
    }
    const bigImgs = atts.filter(a => a.kind === "image" && (!a.dataUrl || a.dataUrl.length >= 60000));
    if (bigImgs.length) ref += `\n\nThe user also attached large image(s): ${bigImgs.map(a => a.name).join(", ")} (too big to inline — reference by name / use a placeholder).`;
    const user = `Build this program:\n${spec}${ref}\n\nRemember: index.html entry point, self-contained, runs in the browser.`;
    let raw = "";
    raw = await deps.llmGenerate(SYSTEM, user, {
      onToken: (_d, full) => { onStatus?.(`Generating… ${full.length.toLocaleString()} chars`); },
      maxTokens: 8000,
      temperature: 0.25,
    });
    onStatus?.("Assembling…");
    const files = parseFiles(raw);
    if (!files["index.html"]) throw new Error("the model did not return an index.html — try again or rephrase");
    const { previewUrl, blobUrls } = assemblePreview(files);
    last = { files, previewUrl, blobUrls };
    render(files, previewUrl);
    onStatus?.("Build finished ✓");
    return { files, previewUrl, entry: "index.html" };
  }

  /* ---- parse the model output into a { path: content } map ---- */
  function parseFiles(raw) {
    let s = String(raw || "").trim();
    s = s.replace(/^```[a-zA-Z0-9]*\n/, "").replace(/\n```$/, "");   // strip an outer fence
    const files = {};
    const re = /===\s*FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)(?=\r?\n===\s*(?:FILE:|END)|\s*$)/g;
    let m, found = false;
    while ((m = re.exec(s)) !== null) {
      found = true;
      const path = m[1].trim().replace(/^\.?\//, "");
      let content = m[2].replace(/^```[a-zA-Z0-9]*\r?\n/, "").replace(/\r?\n```\s*$/, "");
      if (path) files[path] = content;
    }
    if (!found && /<html|<!doctype|<body|<canvas|<script/i.test(s)) files["index.html"] = s;
    return files;
  }

  /* ---- assemble a runnable preview from blob URLs (no server) ---- */
  function assemblePreview(files) {
    const blobUrls = {};
    for (const [path, content] of Object.entries(files)) {
      if (path === "index.html") continue;
      blobUrls[path] = URL.createObjectURL(new Blob([content], { type: mimeFor(path) }));
    }
    let html = files["index.html"];
    // Rewrite references to sibling assets → their blob URLs (longest paths first).
    for (const p of Object.keys(blobUrls).sort((a, b) => b.length - a.length)) {
      const url = blobUrls[p];
      html = html.split(`"./${p}"`).join(`"${url}"`).split(`'./${p}'`).join(`'${url}'`)
                 .split(`"${p}"`).join(`"${url}"`).split(`'${p}'`).join(`'${url}'`)
                 .split(`./${p}`).join(url).split(p).join(url);
    }
    const previewUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    blobUrls["index.html"] = previewUrl;
    return { previewUrl, blobUrls };
  }

  function revokeLast() {
    if (!last) return;
    for (const u of Object.values(last.blobUrls || {})) { try { URL.revokeObjectURL(u); } catch {} }
    last = null;
  }

  /* ---- render into the Build tab ---- */
  function render(files, previewUrl) {
    const list = deps.dom.fileList;
    list.innerHTML = "";
    for (const p of Object.keys(files)) {
      const row = document.createElement("div");
      row.className = "build-file";
      row.textContent = `${p} · ${files[p].length.toLocaleString()} B`;
      list.appendChild(row);
    }
    deps.dom.iframe.src = previewUrl;
    deps.dom.openBtn.disabled = false;
    deps.dom.zipBtn.disabled = false;
    deps.dom.publishBtn.disabled = false;
  }

  /* ---- downloadable ZIP of the real source ---- */
  async function downloadZip() {
    if (!last) return;
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const zip = new JSZip();
    for (const [path, content] of Object.entries(last.files)) zip.file(path, content);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "actig-program.zip";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---- publish to a public URL via a GitHub Gist (needs a token) ---- */
  async function publish() {
    if (!last) throw new Error("nothing to publish yet");
    const token = deps.store.ghToken;
    if (!token) throw new Error("add a GitHub token in Settings to publish a public URL");
    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ description: "ACTIG generated program", public: true, files: flattenForGist(last.files) }),
    });
    if (!res.ok) throw new Error("Gist API " + res.status + " " + (await res.text().catch(() => "")).slice(0, 140));
    const data = await res.json();
    return `https://gist.githack.com/${data.owner?.login}/${data.id}/raw/index.html`;
  }

  /* Gist filenames can't contain slashes; flatten paths and fix references so a
     multi-file program still resolves on the public URL. */
  function flattenForGist(files) {
    const map = {};
    for (const p of Object.keys(files)) map[p] = p === "index.html" ? "index.html" : p.replace(/\//g, "__");
    const out = {};
    for (const [p, content] of Object.entries(files)) {
      let c = content;
      if (/\.(html|css|js|json|svg|gltf|obj)$/i.test(p) || p === "index.html") {
        for (const [orig, flat] of Object.entries(map)) {
          if (orig === p) continue;
          c = c.split(`./${orig}`).join(flat).split(orig).join(flat);
        }
      }
      out[map[p]] = { content: c || " " };
    }
    return out;
  }

  function mimeFor(path) {
    const e = path.split(".").pop().toLowerCase();
    return ({
      js: "text/javascript", mjs: "text/javascript", css: "text/css",
      json: "application/json", gltf: "model/gltf+json", obj: "text/plain",
      svg: "image/svg+xml", html: "text/html", txt: "text/plain", wasm: "application/wasm",
    })[e] || "text/plain";
  }

  // wire the tab action buttons
  deps.dom.openBtn.onclick = () => { if (last) window.open(last.previewUrl, "_blank"); };
  deps.dom.zipBtn.onclick = () => downloadZip().catch(e => deps.addBubble("sys", "ZIP failed: " + (e?.message || e)));
  deps.dom.publishBtn.onclick = async () => {
    try {
      deps.dom.statusEl.textContent = "Publishing…";
      const url = await publish();
      deps.dom.statusEl.textContent = "Public URL ready";
      deps.addBubble("ai", "🌐 Public link: " + url);
      window.open(url, "_blank");
    } catch (e) {
      deps.dom.statusEl.textContent = "Publish failed: " + (e?.message || e);
      deps.addBubble("sys", "Publish failed: " + (e?.message || e));
    }
  };

  return { generate, downloadZip, publish };
}
