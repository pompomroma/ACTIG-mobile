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

// Games must be *playable*, not title/screen mockups.
const GAME_RE = /\b(game|gameplay|playable|arcade|snake|tetris|pong|platformer|shooter|puzzle|maze|flappy|breakout|invaders|runner|rpg|score|player|enemy|level|shoot|jump|dodge)\b/i;
const GAME_REQ = `\n\nTHIS IS A GAME — it MUST be fully playable, never a title screen or mockup. Implement: a real game loop with requestAnimationFrame; responsive controls for BOTH keyboard (arrow keys / WASD / space) AND touch (on-screen buttons or swipe/tap); a player and entities that actually move with collision detection; scoring and increasing difficulty; clear win/lose states with a restart button. Any start screen must lead directly into real, interactive gameplay.`;

const DESIGN_PROMPT = `Analyze the attached image(s) so a developer can faithfully reproduce them in a web app. Be concrete and structured. Cover: color palette (list hex values), typography (font families/weights/sizes/hierarchy), layout & spacing (grid, alignment, sizing), key components/controls, iconography & imagery style, overall theme/mood (light or dark), and any ANIMATION/motion shown or implied (transitions, easing, duration, hover/scroll effects, loops). If it's a UI mockup, describe each screen region. Output a concise design brief — no code.`;

const EDITOR = `You are editing an EXISTING browser-only web app. Apply the user's requested change(s) to the given files. Preserve everything that already works; change only what the request needs. Keep it a complete, self-contained, runnable program: index.html entry point, libraries via CDN <script> tags, NO ES module imports between your own files. Return the COMPLETE updated project (every file in full).

${OUTPUT_FORMAT}

No explanations.`;

const REVIEWER = `You are a ruthless senior code reviewer and QA engineer for a browser-only web app. You will be given the current program files and a list of concrete defects found by ACTUALLY RUNNING it (runtime/console errors) plus a feature checklist. Fix EVERY defect and any other bug, missing feature, accessibility, or robustness issue you can find. Return the COMPLETE corrected project (every file in full), not a diff.

${OUTPUT_FORMAT}

Keep what works, fix what doesn't, fully implement anything missing. Do not add explanations.`;

// Quality tiers: how many candidates to generate and how hard to repair.
// (All use the SAME free model — higher tiers just do more inference-time passes.)
const TIERS = {
  fast: { candidates: 1, plan: false, repairs: 0, tokens: 8000 },
  high: { candidates: 1, plan: true, repairs: 1, tokens: 9000 },
  max: { candidates: 3, plan: true, repairs: 4, tokens: 12000 },   // pushed to the practical ceiling
  // OVERDRIVE 🚀: beyond Max — adds an architecture pass, best-of-4, 6 repairs,
  // and post-edit verification. Same free model; it just works much harder.
  overdrive: { candidates: 4, plan: true, arch: true, repairs: 6, tokens: 12000, verifyEdits: true, label: "OVERDRIVE" },
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

/* ---- IndexedDB: durable library of saved programs ---- */
const DB_NAME = "actig", DB_STORE = "programs";
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "id" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const rq = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbPut(rec) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(rec);
    tx.oncomplete = () => res(rec);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbDel(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export function createBuilder(deps) {
  // Overdrive (store.overdrive) overrides the quality select with the deepest tier.
  const activeTier = () => (deps.store.overdrive ? TIERS.overdrive : (TIERS[deps.store.quality] || TIERS.max));
  const tierTag = (t, label) => (t.label ? `${t.label} · ${label}` : label);
  let last = null;               // { files, previewUrl, blobUrls, eval }
  let lastSpec = "";             // the spec/description behind `last`
  let currentId = null, currentName = "", currentCreatedAt = null; // saved-library link

  /* ---- generation pipeline: plan → best-of-N → run-eval → self-repair ----
     Checkpoints after every stage to deps.store.buildWip so a build interrupted by
     the OS suspending the app (backgrounding) resumes from where it stopped. */
  async function generate(spec, { onStatus, atts = [], resume = null } = {}) {
    revokeLast();
    currentId = null; currentName = ""; currentCreatedAt = null; lastSpec = spec; // a fresh build is a new, unsaved program
    const tier = activeTier();
    const ref = resume ? (resume.ref || "") : await analyzeContext(atts, onStatus);
    let checklist = resume ? (resume.checklist || []) : [];
    let arch = resume ? (resume.arch || "") : "";
    let best = resume ? (resume.best || null) : null;
    let candStart = resume ? (resume.candidatesDone || 0) : 0;
    let repStart = resume ? (resume.repairsDone || 0) : 0;
    const save = (extra) => { try { deps.store.buildWip = { spec, ref, checklist, arch, best, candidatesDone: candStart, repairsDone: repStart, ts: Date.now(), ...extra }; } catch {} };

    // 1) Plan an acceptance checklist (steers generation + drives the eval score).
    if (tier.plan && !checklist.length && candStart === 0) {
      onStatus?.("Planning…");
      try { checklist = await planChecklist(spec, ref); } catch {}
      save({});
    }
    // 1b) OVERDRIVE: architecture pass — decide the technical design up front.
    if (tier.arch && !arch && candStart === 0) {
      onStatus?.(tierTag(tier, "Architecture pass…"));
      try { arch = await planArchitecture(spec, ref, checklist); } catch {}
      save({});
    }
    const isGame = GAME_RE.test(spec + " " + checklist.join(" "));
    const user = `Build this program:\n${spec}${ref}`
      + (checklist.length ? `\n\nIt MUST satisfy every item on this checklist:\n- ${checklist.join("\n- ")}` : "")
      + (arch ? `\n\nFollow this technical design (deviate only if it's clearly wrong):\n${arch}` : "")
      + (isGame ? GAME_REQ : "")
      + `\n\nRemember: index.html entry point, self-contained, runs in the browser.`;

    // 2) Generate candidate(s), evaluate each, keep the best.
    for (let c = candStart; c < tier.candidates; c++) {
      onStatus?.(tier.candidates > 1 ? `Generating candidate ${c + 1}/${tier.candidates}…` : "Generating…");
      let raw;
      try {
        raw = await deps.llmGenerate(SYSTEM, user, {
          onToken: (_d, full) => onStatus?.(`Generating… ${full.length.toLocaleString()} chars`),
          maxTokens: tier.tokens || 8000, temperature: c === 0 ? 0.2 : 0.5,
        });
      } catch (e) { if (!best) throw e; else break; }
      const files = parseFiles(raw);
      candStart = c + 1;
      if (files["index.html"]) {
        onStatus?.("Testing candidate…");
        const evalRes = await evaluate(files, checklist, isGame);
        renderMetrics(evalRes, tierTag(tier, `Candidate ${c + 1}`));
        if (!best || evalRes.score > best.eval.score) best = { files, eval: evalRes };
      }
      save({ candidatesDone: candStart, repairsDone: 0 });
      if (best && best.eval.score >= 100) break;
    }
    if (!best) throw new Error("the model did not return a usable index.html — try again or rephrase");

    // 3) Self-critique + auto-repair loop until the score plateaus / is perfect.
    for (let i = repStart; i < tier.repairs && best.eval.score < 100; i++) {
      onStatus?.(`Repairing (pass ${i + 1}/${tier.repairs})…`);
      let repaired;
      try { repaired = await repairOnce(best.files, best.eval, checklist); }
      catch { break; }                               // repair failed → keep the best we have
      const files = parseFiles(repaired);
      repStart = i + 1;
      if (files["index.html"]) {
        const evalRes = await evaluate(files, checklist, isGame);
        const prev = best.eval.score;
        renderMetrics(evalRes, tierTag(tier, `Repair ${i + 1}: ${prev} → ${evalRes.score}`));
        if (evalRes.score > best.eval.score) { best = { files, eval: evalRes }; save({ candidatesDone: tier.candidates, repairsDone: repStart }); }
        else { save({ candidatesDone: tier.candidates, repairsDone: repStart }); break; } // no improvement → stop
      } else { break; }
    }

    // 4) Finalize the best result and clear the checkpoint.
    onStatus?.("Assembling…");
    const { previewUrl, blobUrls } = assemblePreview(best.files);
    last = { files: best.files, previewUrl, blobUrls, eval: best.eval };
    render(best.files, previewUrl);
    renderMetrics(best.eval, tierTag(tier, "Final"));
    deps.store.buildWip = null;
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

  /* Like attachmentContext, but also VISION-ANALYZES attached images into a design
     brief (colors, layout, animation…) the model can implement. Falls back to plain
     embedding if the endpoint/model can't do vision. */
  async function analyzeContext(atts, onStatus) {
    let ref = attachmentContext(atts);
    const imgs = atts.filter(a => a.kind === "image" && a.dataUrl);
    if (imgs.length && deps.visionDescribe) {
      onStatus?.("Analyzing attached image(s)…");
      try {
        const brief = await deps.visionDescribe(imgs, DESIGN_PROMPT);
        if (brief && brief.trim()) ref += `\n\nDESIGN ANALYSIS of the attached image(s) — match this look, layout, and motion in the program:\n${brief.trim()}`;
      } catch { /* no vision available — the embedded image (if small) still helps */ }
    }
    return ref;
  }

  /* Ask the model for a short acceptance checklist (also used as eval criteria). */
  async function planChecklist(spec, ref) {
    const sys = "You are a product engineer. Given a request, list 4–8 short, concrete, testable acceptance criteria for a browser-only web app (features, key interactions, must-not-error). Output ONLY a plain list, one item per line, no numbering, no prose.";
    const out = await deps.llmGenerate(sys, `Request:\n${spec}${ref}`, { maxTokens: 500, temperature: 0.2 });
    return String(out || "").split("\n").map(s => s.replace(/^[\s\-*\d.)]+/, "").trim()).filter(Boolean).slice(0, 8);
  }

  /* OVERDRIVE: one extra call that decides the technical design before any code
     is written — sharper planning/structure than generating cold. */
  async function planArchitecture(spec, ref, checklist) {
    const sys = "You are a principal web engineer. Produce a SHORT technical design for a browser-only, single-page web app: components/modules, state model (shape of the data), core algorithms, key edge cases to handle, and the 2–3 riskiest parts with how to de-risk them. Max ~15 lines, telegraphic style, no code, no prose padding.";
    const user = `Request:\n${spec}${ref}` + (checklist.length ? `\nAcceptance checklist:\n- ${checklist.join("\n- ")}` : "");
    const out = await deps.llmGenerate(sys, user, { maxTokens: 600, temperature: 0.2 });
    return String(out || "").trim().slice(0, 2400);
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
    const tier = activeTier();
    return deps.llmGenerate(REVIEWER, user, {
      maxTokens: tier.tokens || 8000, temperature: 0.2,
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
  async function evaluate(files, checklist, isGame = false) {
    const html = files["index.html"] || "";
    const combined = Object.values(files).join("\n").toLowerCase();
    const codeAll = Object.values(files).join("\n");
    const run = await runInFrame(files);
    const errors = (run.errors || []).filter(Boolean);
    const metrics = [];
    const add = (label, pass, weight) => metrics.push({ label, pass: !!pass, weight });
    // Accessibility: every <img> should carry an alt attribute.
    const imgTags = html.match(/<img\b[^>]*>/gi) || [];
    const imgsHaveAlt = imgTags.every(t => /\balt\s*=/.test(t));
    add("Parses & has entry point", !!files["index.html"], 18);
    add("Runs with 0 console/runtime errors", !run.timeout && errors.length === 0, 26);
    add("Renders visible UI", run.kids > 0, 14);
    add("No TODO/placeholder text", !/\b(todo|fixme|lorem ipsum|your code here|implement this|coming soon)\b/i.test(html), 8);
    add("Mobile-ready (viewport meta)", /<meta[^>]+name=["']?viewport/i.test(html), 6);
    add("Accessibility basics (lang + img alt)", /<html[^>]+lang=/i.test(html) && imgsHaveAlt, 8);
    if (checklist.length) {
      let covered = 0;
      for (const item of checklist) {
        const strong = (item.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) || []).filter(w => !STOP.has(w));
        if (!strong.length || strong.some(w => combined.includes(w))) covered++;
      }
      add(`Checklist coverage (${covered}/${checklist.length})`, covered >= Math.ceil(checklist.length * 0.7), 15);
    } else {
      add("Substantial implementation", html.length > 1200, 15);
    }
    add("Reasonable size", html.length > 400, 5);
    if (isGame) {                                     // a game must actually be playable
      const hasLoop = /requestAnimationFrame|setInterval/.test(codeAll);
      const hasInput = /(keydown|keyup|keypress|pointerdown|touchstart|onkeydown)/i.test(codeAll);
      add("Playable (game loop + controls)", hasLoop && hasInput, 20);
    }
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

  /* ---- saved-programs library (IndexedDB) ---- */
  async function saveCurrent(name) {
    if (!last) throw new Error("nothing to save yet — generate a program first");
    const now = Date.now();
    const id = currentId || ("p" + now + "_" + Math.random().toString(36).slice(2, 7));
    const rec = {
      id, name: (name || currentName || lastSpec || "Untitled").toString().slice(0, 80),
      spec: lastSpec, files: last.files, metrics: last.eval || null,
      createdAt: currentCreatedAt || now, updatedAt: now,
    };
    await idbPut(rec);
    currentId = id; currentName = rec.name; currentCreatedAt = rec.createdAt;
    await renderLibrary();
    return rec;
  }
  async function open(id) {
    const rec = (await idbAll()).find(r => r.id === id);
    if (!rec) throw new Error("saved program not found");
    revokeLast();
    const { previewUrl, blobUrls } = assemblePreview(rec.files);
    last = { files: rec.files, previewUrl, blobUrls, eval: rec.metrics };
    currentId = rec.id; currentName = rec.name; currentCreatedAt = rec.createdAt; lastSpec = rec.spec || "";
    render(rec.files, previewUrl);
    if (rec.metrics) renderMetrics(rec.metrics, "Saved");
    deps.onActive?.(rec);
    await renderLibrary();
    return rec;
  }
  async function remove(id) {
    await idbDel(id);
    if (currentId === id) { currentId = null; currentName = ""; currentCreatedAt = null; }
    await renderLibrary();
  }
  async function renderLibrary() {
    const el = deps.dom.libraryEl; if (!el) return;
    let items = [];
    try { items = await idbAll(); } catch {}
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    el.innerHTML = `<div class="lib-head">Saved programs (${items.length})</div>`;
    if (!items.length) { el.insertAdjacentHTML("beforeend", `<div class="lib-empty">Build one, then tap 💾 Save to keep it here.</div>`); return; }
    for (const r of items) {
      const row = document.createElement("div"); row.className = "lib-row" + (r.id === currentId ? " active" : "");
      const meta = document.createElement("div"); meta.className = "lib-meta";
      meta.textContent = `${r.name} · ${new Date(r.updatedAt || r.createdAt).toLocaleDateString()}${r.metrics ? " · " + r.metrics.score + "/100" : ""}`;
      row.appendChild(meta);
      const acts = document.createElement("div"); acts.className = "lib-acts";
      const mk = (label, fn) => { const b = document.createElement("button"); b.className = "lib-btn"; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
      mk("Open", () => open(r.id).catch(e => deps.addBubble("sys", "Open failed: " + (e?.message || e))));
      mk("Adjust", () => open(r.id).then(() => deps.onAdjustRequested?.(r)).catch(e => deps.addBubble("sys", "Open failed: " + (e?.message || e))));
      mk("ZIP", () => open(r.id).then(() => downloadZip()));
      mk("Delete", () => { if (confirm(`Delete “${r.name}”?`)) remove(r.id); });
      row.appendChild(acts);
      el.appendChild(row);
    }
  }

  /* ---- AI edit: apply a requested change to the loaded program ---- */
  async function applyAdjustment(request, { onStatus, atts = [] } = {}) {
    if (!last) throw new Error("open or generate a program first, then request a change");
    const tier = activeTier();
    const ctx = atts.length ? await analyzeContext(atts, onStatus) : "";
    const isGame = GAME_RE.test(lastSpec + " " + request);
    const filesBlock = Object.entries(last.files).map(([p, c]) => `===FILE: ${p}===\n${c}`).join("\n");
    const user = `Current program:\n${filesBlock}\n\nRequested change:\n${request}${ctx ? `\n\nAttached references to use:${ctx}` : ""}${isGame ? GAME_REQ : ""}\n\nReturn the COMPLETE updated project.`;
    onStatus?.("Applying change…");
    const raw = await deps.llmGenerate(EDITOR, user, {
      onToken: (_d, full) => onStatus?.(`Editing… ${full.length.toLocaleString()} chars`),
      maxTokens: tier.tokens || 8000, temperature: 0.2,
    });
    let files = parseFiles(raw);
    if (!files["index.html"]) throw new Error("the edit didn't return a valid program — try rephrasing");
    onStatus?.("Testing…");
    let evalRes = await evaluate(files, [], isGame);
    renderMetrics(evalRes, tierTag(tier, "Edited"));
    // OVERDRIVE: verify every requested change actually landed; fix what's missing.
    if (tier.verifyEdits) {
      onStatus?.(tierTag(tier, "Verifying the change…"));
      try {
        const vSys = "You are a meticulous QA reviewer. Given a requested change and the updated project files, list ONLY the parts of the request that are NOT fully implemented, one per line. If everything is implemented, output exactly: OK";
        const vUser = `Requested change:\n${request}\n\nUpdated project:\n${Object.entries(files).map(([p, c]) => `===FILE: ${p}===\n${c}`).join("\n")}`;
        const verdict = (await deps.llmGenerate(vSys, vUser, { maxTokens: 400, temperature: 0 })).trim();
        if (verdict && !/^ok\b/i.test(verdict)) {
          onStatus?.(tierTag(tier, "Completing missed parts…"));
          const fixUser = `Current program:\n${Object.entries(files).map(([p, c]) => `===FILE: ${p}===\n${c}`).join("\n")}\n\nThese requested changes were NOT fully implemented — implement them now, keeping everything else intact:\n${verdict.slice(0, 1200)}\n\nOriginal request:\n${request}\n\nReturn the COMPLETE updated project.`;
          const f2 = parseFiles(await deps.llmGenerate(EDITOR, fixUser, { maxTokens: tier.tokens || 8000, temperature: 0.2 }));
          if (f2["index.html"]) {
            const e2 = await evaluate(f2, [], isGame);
            if (e2.score >= evalRes.score - 5) { files = f2; evalRes = e2; renderMetrics(evalRes, tierTag(tier, "Edited (verified)")); }
          }
        }
      } catch {}
    }
    if (tier.repairs > 0 && evalRes.score < 100) {          // one light repair pass for edits
      onStatus?.("Repairing…");
      try {
        const f2 = parseFiles(await repairOnce(files, evalRes, []));
        if (f2["index.html"]) { const e2 = await evaluate(f2, [], isGame); if (e2.score >= evalRes.score) { files = f2; evalRes = e2; renderMetrics(evalRes, tierTag(tier, "Edited (repaired)")); } }
      } catch {}
    }
    revokeLast();
    const { previewUrl, blobUrls } = assemblePreview(files);
    last = { files, previewUrl, blobUrls, eval: evalRes };
    lastSpec = lastSpec ? `${lastSpec} | ${request}` : request;
    render(files, previewUrl);
    if (currentId) { try { await saveCurrent(currentName); } catch {} } // auto-update the saved entry
    onStatus?.(`Change applied ✓ (quality ${evalRes.score}/100)`);
    return { files, previewUrl, entry: "index.html", metrics: evalRes };
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

  // initial library paint
  renderLibrary();

  return {
    generate, downloadZip, publish,
    saveCurrent, open, remove, renderLibrary, applyAdjustment,
    hasProgram: () => !!last,
    defaultName: () => (currentName || lastSpec || "").toString().slice(0, 60),
    isSaved: () => !!currentId,
  };
}
