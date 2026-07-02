/* ACTIG Vibe Build — the AI code generator. Given a natural-language spec it asks
   the model (via the app's auto-picked brain) to emit a complete, self-contained
   client-side web program, then assembles a live in-browser preview (blob URLs, no
   server), a downloadable ZIP, and — with a GitHub token — a public shareable URL.

   Loaded lazily by app.js via createBuilder(deps). deps = {
     llmGenerate(system, user, {onToken, maxTokens, temperature}),  // from app.js
     store, addBubble,                                              // from app.js
     dom: { iframe, fileList, openBtn, zipBtn, publishBtn, statusEl }
   } */

const OUTPUT_FORMAT = `OUTPUT FORMAT — output ONLY files, nothing else. For each file:
===FILE: <relative/path>===
<full file contents>
After the last file output a final line:
===END===
No explanations, no markdown fences, nothing outside the file blocks.`;

const SYSTEM = `You are ACTIG Build, a world-class full-stack web engineer. Generate a COMPLETE, production-quality web program that runs ENTIRELY in the browser — no build step, no server.

${OUTPUT_FORMAT}

HARD RULES:
- The entry point MUST be index.html. STRONGLY PREFER a single self-contained index.html with all CSS and JavaScript inline.
- Do NOT use ES module "import" between your own files. Load any libraries from a CDN via <script> tags (e.g. three.js, React UMD, Tone.js).
- FULLY IMPLEMENT every feature — no TODO, no "…", no stubs, no placeholder comments standing in for logic. The program must actually work end to end.
- Robustness: guard against null/undefined, wrap risky code in try/catch, validate inputs, and NEVER throw uncaught errors or log console.error during normal use.
- UX quality: polished, responsive, mobile-first, accessible (semantic HTML, ARIA where needed, visible focus, good contrast), keyboard usable, dark-theme friendly.
- Performance: requestAnimationFrame for animation, clean up timers/listeners, avoid memory leaks, keep it smooth.
- Security: escape/encode any user-provided or dynamic content inserted into the DOM (no unsafe innerHTML with untrusted data).
- Persist state with localStorage/IndexedDB when useful. Only call public CORS-friendly APIs, if any.
- For 3D: prefer procedural geometry with three.js from CDN. If a model FILE is required, emit a valid, self-contained glTF 2.0 file (buffers inlined as base64 data URIs) at assets/<name>.gltf and load it with GLTFLoader from CDN.
- Before finishing, mentally execute each feature and fix anything that would error or look broken.

Build EXACTLY what the user asks — complete, correct, optimized, and genuinely high quality.`;

const REVIEWER = `You are a ruthless senior code reviewer and QA engineer for a browser-only web app. You will be given the current program files and a list of concrete defects found by ACTUALLY RUNNING it (runtime/console errors) plus a feature checklist. Fix EVERY defect and any other bug, missing feature, accessibility, or robustness issue you can find. Return the COMPLETE corrected project (every file in full), not a diff.

${OUTPUT_FORMAT}

Keep what works, fix what doesn't, fully implement anything missing. Do not add explanations.`;

// Quality tiers: how many candidates to generate and how hard to repair.
const TIERS = {
  fast: { candidates: 1, plan: false, repairs: 0 },
  high: { candidates: 1, plan: true, repairs: 1 },
  max: { candidates: 2, plan: true, repairs: 3 },
};

// Common words ignored when heuristically matching checklist items to code.
const STOP = new Set("the a an and or of to in for with that this must should be is are it its user users data use uses using via when then each item items list add show display support include page app apply able allow can will make store when where which what".split(" "));
const escapeHtml = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/* Inject a tiny probe that captures runtime/console errors and reports readiness
   (title, visible element count) back to the parent via postMessage. */
function instrument(html, token) {
  const probe = `<script>(function(){var E=[];function send(){try{parent.postMessage({__actig:"${token}",errors:E.slice(0,20),title:document.title||"",kids:document.body?document.body.childElementCount:0},"*");}catch(e){}}
window.addEventListener("error",function(e){E.push((e.message||"script error")+(e.lineno?" (line "+e.lineno+")":""));});
window.addEventListener("unhandledrejection",function(e){E.push("promise: "+((e.reason&&e.reason.message)||e.reason||"rejection"));});
var _ce=console.error;console.error=function(){try{E.push("console.error: "+Array.prototype.map.call(arguments,String).join(" "));}catch(x){}try{_ce.apply(console,arguments);}catch(x){}};
window.addEventListener("load",function(){setTimeout(send,900);});setTimeout(send,2600);})();<\/script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + probe);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + probe);
  return probe + html;
}

export function createBuilder(deps) {
  let last = null;               // { files, previewUrl, blobUrls }

  /* ---- generation pipeline: plan → best-of-N → run-eval → self-repair ---- */
  async function generate(spec, { onStatus, atts = [] } = {}) {
    revokeLast();
    const tier = TIERS[deps.store.quality] || TIERS.max;
    const ref = attachmentContext(atts);

    // 1) Plan an acceptance checklist (steers generation + drives the eval score).
    let checklist = [];
    if (tier.plan) {
      onStatus?.("Planning…");
      try { checklist = await planChecklist(spec, ref); } catch {}
    }
    const user = `Build this program:\n${spec}${ref}`
      + (checklist.length ? `\n\nIt MUST satisfy every item on this checklist:\n- ${checklist.join("\n- ")}` : "")
      + `\n\nRemember: index.html entry point, self-contained, runs in the browser.`;

    // 2) Generate candidate(s), evaluate each, keep the best.
    let best = null;
    for (let c = 0; c < tier.candidates; c++) {
      onStatus?.(tier.candidates > 1 ? `Generating candidate ${c + 1}/${tier.candidates}…` : "Generating…");
      let raw;
      try {
        raw = await deps.llmGenerate(SYSTEM, user, {
          onToken: (_d, full) => onStatus?.(`Generating… ${full.length.toLocaleString()} chars`),
          maxTokens: 8000, temperature: c === 0 ? 0.2 : 0.5,
        });
      } catch (e) { if (!best) throw e; else continue; }
      const files = parseFiles(raw);
      if (!files["index.html"]) continue;
      onStatus?.("Testing candidate…");
      const evalRes = await evaluate(files, checklist);
      renderMetrics(evalRes, `Candidate ${c + 1}`);
      if (!best || evalRes.score > best.eval.score) best = { files, eval: evalRes };
      if (best.eval.score >= 100) break;
    }
    if (!best) throw new Error("the model did not return a usable index.html — try again or rephrase");

    // 3) Self-critique + auto-repair loop until the score plateaus / is perfect.
    for (let i = 0; i < tier.repairs && best.eval.score < 100; i++) {
      onStatus?.(`Repairing (pass ${i + 1}/${tier.repairs})…`);
      let repaired;
      try { repaired = await repairOnce(best.files, best.eval, checklist); }
      catch { break; }
      const files = parseFiles(repaired);
      if (!files["index.html"]) break;
      const evalRes = await evaluate(files, checklist);
      const prev = best.eval.score;
      renderMetrics(evalRes, `Repair ${i + 1}: ${prev} → ${evalRes.score}`);
      if (evalRes.score > best.eval.score) best = { files, eval: evalRes };
      else break;                                    // no improvement → stop
    }

    // 4) Finalize the best result.
    onStatus?.("Assembling…");
    const { previewUrl, blobUrls } = assemblePreview(best.files);
    last = { files: best.files, previewUrl, blobUrls, eval: best.eval };
    render(best.files, previewUrl);
    renderMetrics(best.eval, "Final");
    onStatus?.(`Build finished ✓ (quality ${best.eval.score}/100)`);
    return { files: best.files, previewUrl, entry: "index.html", metrics: best.eval };
  }

  /* Attached-file context block (text inlined, small images as data URIs). */
  function attachmentContext(atts) {
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
    return ref;
  }

  /* Ask the model for a short acceptance checklist (also used as eval criteria). */
  async function planChecklist(spec, ref) {
    const sys = "You are a product engineer. Given a request, list 4–8 short, concrete, testable acceptance criteria for a browser-only web app (features, key interactions, must-not-error). Output ONLY a plain list, one item per line, no numbering, no prose.";
    const out = await deps.llmGenerate(sys, `Request:\n${spec}${ref}`, { maxTokens: 500, temperature: 0.2 });
    return String(out || "").split("\n").map(s => s.replace(/^[\s\-*\d.)]+/, "").trim()).filter(Boolean).slice(0, 8);
  }

  /* Send current files + concrete defects back for a full corrected rewrite. */
  async function repairOnce(files, evalRes, checklist) {
    const filesBlock = Object.entries(files).map(([p, c]) => `===FILE: ${p}===\n${c}`).join("\n");
    const defects = [];
    if (evalRes.errors.length) defects.push("Runtime/console errors observed when running the app:\n- " + evalRes.errors.slice(0, 12).join("\n- "));
    const failed = evalRes.metrics.filter(m => !m.pass).map(m => m.label);
    if (failed.length) defects.push("Failed checks: " + failed.join("; "));
    if (checklist.length) defects.push("Acceptance checklist:\n- " + checklist.join("\n- "));
    const user = `Current program:\n${filesBlock}\n\n${defects.join("\n\n") || "Improve overall quality, robustness and completeness."}\n\nReturn the COMPLETE corrected project.`;
    return deps.llmGenerate(REVIEWER, user, {
      onToken: (_d, full) => {},
      maxTokens: 8000, temperature: 0.2,
    });
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
  function assetBlobUrls(files) {
    const blobUrls = {};
    for (const [path, content] of Object.entries(files)) {
      if (path === "index.html") continue;
      blobUrls[path] = URL.createObjectURL(new Blob([content], { type: mimeFor(path) }));
    }
    return blobUrls;
  }
  // Rewrite references to sibling assets → their blob URLs (longest paths first).
  function rewriteRefs(html, blobUrls) {
    for (const p of Object.keys(blobUrls).sort((a, b) => b.length - a.length)) {
      const url = blobUrls[p];
      html = html.split(`"./${p}"`).join(`"${url}"`).split(`'./${p}'`).join(`'${url}'`)
                 .split(`"${p}"`).join(`"${url}"`).split(`'${p}'`).join(`'${url}'`)
                 .split(`./${p}`).join(url).split(p).join(url);
    }
    return html;
  }
  function assemblePreview(files) {
    const blobUrls = assetBlobUrls(files);
    const html = rewriteRefs(files["index.html"], blobUrls);
    const previewUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    blobUrls["index.html"] = previewUrl;
    return { previewUrl, blobUrls };
  }

  /* ---- evaluation harness: actually RUN the program and measure it ---- */
  let evalFrame = null, evalSeq = 0;
  function ensureEvalFrame() {
    if (evalFrame) return evalFrame;
    evalFrame = document.createElement("iframe");
    evalFrame.style.cssText = "position:absolute;left:-10000px;top:0;width:390px;height:700px;border:0;visibility:hidden";
    evalFrame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    document.body.appendChild(evalFrame);
    return evalFrame;
  }
  /* Load the program in the hidden iframe and collect runtime signals. */
  async function runInFrame(files) {
    const token = "e" + (++evalSeq) + "_" + Date.now();
    const blobUrls = assetBlobUrls(files);
    let html = rewriteRefs(files["index.html"] || "", blobUrls);
    html = instrument(html, token);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const frame = ensureEvalFrame();
    const run = await new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (done) return; done = true; window.removeEventListener("message", onMsg); resolve(r); };
      const onMsg = (e) => { if (e.data && e.data.__actig === token) finish({ errors: e.data.errors || [], title: e.data.title, kids: e.data.kids }); };
      window.addEventListener("message", onMsg);
      setTimeout(() => finish({ errors: [], title: "", kids: -1, timeout: true }), 4500);
      try { frame.src = url; } catch { finish({ errors: ["failed to load"], kids: -1 }); }
    });
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} for (const u of Object.values(blobUrls)) { try { URL.revokeObjectURL(u); } catch {} } }, 300);
    return run;
  }
  /* Score a candidate by running it + static checks. Returns {score,metrics,errors}. */
  async function evaluate(files, checklist) {
    const html = files["index.html"] || "";
    const combined = Object.values(files).join("\n").toLowerCase();
    const run = await runInFrame(files);
    const errors = (run.errors || []).filter(Boolean);
    const metrics = [];
    const add = (label, pass, weight) => metrics.push({ label, pass: !!pass, weight });
    add("Parses & has entry point", !!files["index.html"], 20);
    add("Runs with 0 console/runtime errors", !run.timeout && errors.length === 0, 30);
    add("Renders visible UI", run.kids > 0, 15);
    add("No TODO/placeholder text", !/\b(todo|fixme|lorem ipsum|your code here|implement this|coming soon)\b/i.test(html), 10);
    if (checklist.length) {
      let covered = 0;
      for (const item of checklist) {
        const strong = (item.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) || []).filter(w => !STOP.has(w));
        if (!strong.length || strong.some(w => combined.includes(w))) covered++;
      }
      add(`Checklist coverage (${covered}/${checklist.length})`, covered >= Math.ceil(checklist.length * 0.7), 20);
    } else {
      add("Substantial implementation", html.length > 1200, 20);
    }
    add("Reasonable size", html.length > 400, 5);
    const totW = metrics.reduce((s, m) => s + m.weight, 0) || 1;
    const gotW = metrics.reduce((s, m) => s + (m.pass ? m.weight : 0), 0);
    return { score: Math.round((gotW / totW) * 100), metrics, errors };
  }
  /* Paint the evaluation scorecard in the Build tab. */
  function renderMetrics(ev, label) {
    const el = deps.dom.metricsEl; if (!el) return;
    el.style.display = "block";
    const rows = ev.metrics.map(m => `<div class="metric ${m.pass ? "ok" : "bad"}">${m.pass ? "✅" : "⚠️"} ${escapeHtml(m.label)}</div>`).join("");
    const errs = ev.errors.length ? `<div class="metric-errs">${ev.errors.slice(0, 4).map(e => "• " + escapeHtml(e)).join("<br>")}</div>` : "";
    el.innerHTML = `<div class="metric-head"><b>Evaluation</b> · ${escapeHtml(label || "")}<span class="metric-score">${ev.score}/100</span></div>${rows}${errs}`;
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
