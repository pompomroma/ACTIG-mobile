/* ACTIG PWA — installable from Safari (no PC/account/signing needed).
   Covers the browser-feasible subset: holographic chat, voice in/out, wake word,
   language switching, command routing, history, and the 3D studio. Native-only
   features (Siri, widgets, HealthKit, Apple on-device model) are out of a browser
   sandbox and live in the native app. */

const WAKE = "wake up actig";
const REACTION = "ACTIG at your service sir";
// Default brain: Pollinations — a free, OpenAI-compatible, CORS-enabled endpoint
// that needs NO API key and NO proxy, so the web app answers out of the box.
// (NVIDIA Nemotron is still available: paste its endpoint + key in Settings, but
//  it has no browser CORS headers so it also needs the proxy in web/proxy/.)
const DEFAULT_ENDPOINT = "https://text.pollinations.ai/openai";
const DEFAULT_MODEL = "openai";
// Optional fallback NVIDIA key (used only if you switch the endpoint to NVIDIA).
const BUILTIN_KEY = "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";
// Endpoints that need no Authorization header (keyless, browser-callable).
const KEYLESS = /pollinations\.ai/i;

const $ = (id) => document.getElementById(id);
const store = {
  get key() { return (localStorage.getItem("actig.key") || BUILTIN_KEY).trim(); },
  set key(v) { localStorage.setItem("actig.key", (v || "").trim()); },
  get endpoint() { return (localStorage.getItem("actig.endpoint") || DEFAULT_ENDPOINT).trim(); },
  set endpoint(v) { localStorage.setItem("actig.endpoint", (v || "").trim() || DEFAULT_ENDPOINT); },
  get offline() { return localStorage.getItem("actig.offline") === "1"; },
  set offline(v) { localStorage.setItem("actig.offline", v ? "1" : "0"); },
  get model() { return (localStorage.getItem("actig.model") || DEFAULT_MODEL).trim(); },
  set model(v) { localStorage.setItem("actig.model", (v || "").trim() || DEFAULT_MODEL); },
  // Vibe Build: optional code model override, and a GitHub token for public URLs.
  get buildModel() { return (localStorage.getItem("actig.buildModel") || "").trim(); },
  set buildModel(v) { localStorage.setItem("actig.buildModel", (v || "").trim()); },
  get ghToken() { return (localStorage.getItem("actig.ghToken") || "").trim(); },
  set ghToken(v) { localStorage.setItem("actig.ghToken", (v || "").trim()); },
  get quality() { return (localStorage.getItem("actig.quality") || "max").trim(); },  // fast|high|max
  set quality(v) { localStorage.setItem("actig.quality", (v || "max").trim()); },
  // In-progress build checkpoint so a suspended/reloaded build can resume.
  get buildWip() { try { return JSON.parse(localStorage.getItem("actig.buildWip") || "null"); } catch { return null; } },
  set buildWip(v) { if (v) { try { localStorage.setItem("actig.buildWip", JSON.stringify(v)); } catch {} } else localStorage.removeItem("actig.buildWip"); },
  get history() { try { return JSON.parse(localStorage.getItem("actig.history") || "[]"); } catch { return []; } },
  set history(v) { localStorage.setItem("actig.history", JSON.stringify(v.slice(-400))); },
};

/* One-time migration: drop any previously-saved NVIDIA endpoint/model so existing
   installs adopt the new zero-setup keyless default. The user's offline choice and
   any custom (non-NVIDIA) endpoint they set are left untouched. */
(function migrateConfig() {
  if (localStorage.getItem("actig.cfgv") === "2") return;
  const ep = localStorage.getItem("actig.endpoint") || "";
  const md = localStorage.getItem("actig.model") || "";
  if (ep.includes("integrate.api.nvidia.com")) localStorage.removeItem("actig.endpoint");
  if (md.includes("nemotron")) localStorage.removeItem("actig.model");
  localStorage.setItem("actig.cfgv", "2");
})();

let messages = store.history;        // {role, text, options?, suggestions?}
let aiMuted = false, userMuted = false, speaking = false;
let attachments = [];                 // files staged in the input bar: {name,type,size,kind,text?,dataUrl?}

/* ---------- file attachments ---------- */
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|html?|css|s[ac]ss|jsx?|mjs|cjs|tsx?|py|rb|go|rs|java|kt|swift|c|h|cpp|cc|hpp|cs|php|sh|bash|zsh|sql|toml|ini|env|gltf|obj|mtl|svg|log|vue|astro|dart|lua|r|jl)$/i;
function classifyFile(f) {
  if (TEXT_EXT.test(f.name)) return "text";                 // .svg etc. are text even if MIME says image
  if ((f.type || "").startsWith("image/")) return "image";
  if ((f.type || "").startsWith("text/") || (f.type || "").includes("json") || (f.type || "").includes("xml")) return "text";
  return "binary";
}
const readDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

async function addFiles(fileList) {
  for (const f of Array.from(fileList || [])) {
    const kind = classifyFile(f);
    const att = { name: f.name, type: f.type || "", size: f.size, kind };
    try {
      if (kind === "text") att.text = (await f.text()).slice(0, 30000);     // cap per-file text
      else if (kind === "image") att.dataUrl = await readDataUrl(f);
      else att.dataUrl = await readDataUrl(f);                              // keep binary for the ZIP/build
    } catch {}
    attachments.push(att);
  }
  renderAttachments();
}
function takeAttachments() { const a = attachments.slice(); attachments = []; renderAttachments(); return a; }
function renderAttachments() {
  const bar = $("attachBar"); if (!bar) return;
  bar.innerHTML = "";
  bar.style.display = attachments.length ? "flex" : "none";
  attachments.forEach((a, i) => {
    const chip = document.createElement("span"); chip.className = "att";
    chip.textContent = (a.kind === "image" ? "🖼 " : "📄 ") + a.name;
    const x = document.createElement("button"); x.className = "att-x"; x.textContent = "×";
    x.onclick = () => { attachments.splice(i, 1); renderAttachments(); };
    chip.appendChild(x); bar.appendChild(chip);
  });
}
/* Inline attached text-file contents into the message the model sees. */
function augmentWithFiles(text, atts) {
  const texts = (atts || []).filter(a => a.kind === "text" && a.text);
  if (!texts.length) return text || "";
  let out = (text || "Here are the attached files.") + "\n\n--- Attached files ---";
  for (const a of texts) out += `\n\n===FILE: ${a.name}===\n${a.text}`;
  return out;
}

/* ---------- language ---------- */
function detectLang(t) {
  if (/[가-힣]/.test(t)) return "ko-KR";
  if (/[぀-ヿ]/.test(t)) return "ja-JP";
  if (/[一-鿿]/.test(t)) return "zh-CN";
  if (/[à-ÿ]/.test(t) && /\b(le|la|une?|est|je)\b/i.test(t)) return "fr-FR";
  return "en-US";
}

/* ---------- text to speech ---------- */
function speak(text, lang) {
  if (aiMuted || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  speakQueued(text, lang);
}
/* Enqueue a chunk without cancelling what's already queued — lets us start
   talking on the first finished sentence while the rest still streams in. */
function speakQueued(text, lang) {
  if (aiMuted || !("speechSynthesis" in window)) return;
  const t = (text || "").trim();
  if (!t) return;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = lang || "en-US";
  u.onstart = () => { speaking = true; };
  u.onend = () => { speaking = false; };
  speechSynthesis.speak(u);
}
/* Length up to and including the last sentence terminator (so we only speak
   complete sentences as they arrive). 0 when there isn't one yet. */
function lastSentenceEnd(s) {
  const m = s.match(/^[\s\S]*[.!?。！？\n]/);
  return m ? m[0].length : 0;
}

/* ---------- speech input ----------
   iOS Safari has no Web Speech *recognition* API, so we record the mic and
   transcribe on-device with Whisper (speech.js). Where the native API DOES
   exist (Android/desktop) we use it for a hands-free wake word too. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRec = null, recording = null, speechMod = null;
/* Continuous-mic state. One tap turns the mic ON and keeps it on: it first
   listens only for the wake word, then (once awake) feeds everything you say to
   the AI — until you mute it by button, voice, or text. */
let micOn = false, awake = false, listenStream = null, listenAbort = false;
let audioCtx = null, analyser = null;          // Web Audio, for silence detection (VAD)

async function speech() { return (speechMod ??= await import("./speech.js")); }
const delay = (ms) => new Promise(r => setTimeout(r, ms));

/* iOS only lets speech synthesis AND Web Audio start from inside a user gesture.
   Call this synchronously in the mic/⚡ tap handlers (before any await) to unlock
   both — otherwise the spoken reply is silently blocked and VAD can't run. */
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) { audioCtx = audioCtx || new Ctx(); if (audioCtx.state === "suspended") audioCtx.resume(); }
  } catch {}
  try {
    if ("speechSynthesis" in window) {          // prime TTS with a silent utterance
      const u = new SpeechSynthesisUtterance(" "); u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {}
}

/* Attach a Web Audio analyser to the mic stream so we can measure loudness for
   voice-activity (silence) detection. Not connected to the speakers (no echo). */
function makeAnalyser(stream) {
  try {
    if (!audioCtx) { const Ctx = window.AudioContext || window.webkitAudioContext; if (Ctx) audioCtx = new Ctx(); }
    if (!audioCtx) return null;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    return an;
  } catch { return null; }
}

/* Current RMS loudness (0..~1) from the analyser. */
function micLevel(an) {
  const data = new Uint8Array(an.fftSize);
  an.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
  return Math.sqrt(sum / data.length);
}

/* Drive a recording with voice-activity detection: stop it automatically once the
   speaker has talked and then gone quiet for `silenceMs`. Resolves true if speech
   was heard (worth transcribing), false if the window passed in silence.
   Falls back to a fixed window when no analyser is available. */
function recordWithVAD(rec, an, { silenceMs = 1000, preSpeechMs = 6000, maxMs = 15000, speechRms = 0.03, silenceRms = 0.02 } = {}) {
  if (!an) { setTimeout(() => { try { rec.stop(); } catch {} }, awake ? 7000 : 4000); return Promise.resolve(true); }
  return new Promise((resolve) => {
    const start = performance.now();
    let speechStarted = false, lastVoice = start, done = false;
    const finish = (heard) => { if (done) return; done = true; try { rec.stop(); } catch {} resolve(heard); };
    const tick = () => {
      if (done) return;
      if (!micOn || listenAbort) return finish(speechStarted);
      const rms = micLevel(an);
      const now = performance.now();
      if (rms > speechRms) {
        if (!speechStarted) { speechStarted = true; setStatus(awake ? "Listening…" : 'Say “wake up ACTIG”'); }
        lastVoice = now;
      }
      if (!speechStarted && now - start > preSpeechMs) return finish(false);          // nothing said
      if (speechStarted && rms < silenceRms && now - lastVoice > silenceMs) return finish(true); // end of turn
      if (now - start > maxMs) return finish(speechStarted);                          // safety cap
      setTimeout(tick, 60);
    };
    tick();
  });
}

/* Tolerant wake-word match: on-device Whisper often mishears the coined word
   "ACTIG" (e.g. "active", "at tig"), so accept any "wake up …" phrasing. */
function isWake(t) {
  const s = (t || "").toLowerCase();
  return s.includes(WAKE) || (s.includes("wake") && s.includes("up"));
}

/* Open the mic. MUST be called synchronously inside a tap handler (before any
   await) — iOS only grants mic access during a live user gesture. */
async function acquireMic() {
  if (!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.isSecureContext)) {
    addBubble("sys", "Voice needs microphone access over HTTPS. Type instead, or open the page in Safari and allow the mic.");
    return null;
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    addBubble("sys", "Microphone blocked (" + (e?.name || e?.message || e) + "). Allow it in iOS Settings ▸ Safari ▸ Microphone, or type your message.");
    return null;
  }
}

/* Mic button: one tap turns the mic permanently on (tap again, or a mute
   command, turns it off). Must run inside the tap gesture for iOS. */
async function toggleMic() {
  if (micOn) { stopMic("Mic off"); return; }
  unlockAudio();                               // unlock TTS + Web Audio in-gesture (iOS)
  userMuted = false; $("micUser").classList.remove("muted-on");
  const stream = await acquireMic();          // getUserMedia initiated in-gesture
  if (stream) startMic(stream);
}

/* Begin continuous listening on an already-open stream. */
function startMic(stream) {
  micOn = true; awake = false; listenAbort = false;
  setMicActive(true);
  setStatus('Mic on — say “wake up ACTIG”');
  if (SR) {
    // Native recognition manages its own audio; the gesture stream was only
    // needed to confirm the mic permission, so release it to avoid a double hold.
    stream.getTracks().forEach(t => t.stop());
    listenStream = null;
    startWakeRecognition();                    // Android/desktop: native continuous recognition
  } else {
    listenStream = stream;
    analyser = makeAnalyser(stream);            // for silence detection (auto end-of-turn)
    listenLoop(stream);                         // iOS: continuous on-device Whisper loop
  }
}

/* Turn the mic fully off and release the hardware. */
function stopMic(status) {
  micOn = false; awake = false; listenAbort = true;
  if (recording) { try { recording.stop(); } catch {} }
  if (wakeRec) { try { wakeRec.onend = null; wakeRec.stop(); } catch {} wakeRec = null; }
  if (listenStream) { try { listenStream.getTracks().forEach(t => t.stop()); } catch {} listenStream = null; }
  analyser = null;                              // audioCtx is kept (reused next time)
  setMicActive(false);
  setStatus(status || "Mic off");
}

/* The wake word was heard — greet once and start feeding speech to the AI. */
function becomeAwake() {
  if (awake) return;
  awake = true;
  setStatus("Awake — listening…");
  addBubble("sys", REACTION);
  speak(REACTION, "en-US");
}

/* Android/desktop path: native continuous recognition handles both the wake
   word and, once awake, each spoken request. */
function startWakeRecognition() {
  try {
    wakeRec = new SR();
    wakeRec.continuous = true; wakeRec.interimResults = true; wakeRec.lang = "en-US";
    wakeRec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const heard = (r[0].transcript || "").trim();
        if (!awake) { if (isWake(heard)) becomeAwake(); }
        else if (r.isFinal && heard) submit(heard, "voice");
      }
    };
    wakeRec.onerror = () => {};
    wakeRec.onend = () => { if (micOn && !userMuted) { try { wakeRec.start(); } catch {} } };
    wakeRec.start();
  } catch { listenLoop(listenStream); }       // fall back to the Whisper loop
}

/* iOS path: keep the one stream open and continuously record → transcribe. Each
   turn auto-ends when you stop speaking (silence detection), so you never have to
   stop the mic. Before the wake word we only watch for it; after, your speech is
   sent to the AI. */
async function listenLoop(stream) {
  let sp;
  try { sp = await speech(); }
  catch (e) { stopMic("Voice unavailable"); addBubble("sys", "Couldn't load the speech model: " + (e?.message || e)); return; }
  while (micOn && !listenAbort) {
    if (speaking) { await delay(150); continue; }   // wait while ACTIG is speaking (no self-record)
    let text = "";
    try {
      recording = sp.recordStream(stream, { maxMs: 16000, keepAlive: true, onStatus: setStatus });
      setStatus(awake ? "Listening…" : 'Say “wake up ACTIG”');
      const heard = await recordWithVAD(recording, analyser); // auto-stops on end of speech
      const blob = await recording.done;
      recording = null;
      if (!micOn || listenAbort) break;
      if (!heard) continue;                            // window passed in silence — listen again
      setStatus("Transcribing…");
      text = await sp.transcribeBlob(blob, "auto", setStatus);
    } catch (e) {
      recording = null;
      if (!micOn || listenAbort) break;
      await delay(300); continue;                      // transient error — keep listening
    }
    if (!micOn || listenAbort) break;
    if (!text) { setStatus(awake ? "Listening…" : 'Say “wake up ACTIG”'); continue; }
    if (!awake) {
      if (isWake(text)) becomeAwake();
      else setStatus('Say “wake up ACTIG”');
    } else {
      await submit(text, "voice");                     // await so we don't talk over the reply
    }
  }
}

function setMicActive(on) {
  const b = $("micUser"); if (b) b.classList.toggle("on", on);
}

/* Wake (⚡): turn the mic on (if needed) and skip straight to awake. */
async function wake() {
  unlockAudio();                               // unlock TTS + Web Audio in-gesture (iOS)
  userMuted = false; $("micUser").classList.remove("muted-on");
  if (!micOn) {
    const stream = await acquireMic();          // mic acquired in-gesture
    if (!stream) return;
    startMic(stream);
  }
  becomeAwake();
}

/* ---------- brain ---------- */
function systemPrompt(lang) {
  return `You are ACTIG, a witty, warm JARVIS-style assistant. Reply in ${lang}. `
    + `Keep answers short, natural and conversational — like spoken dialogue, usually 1-3 sentences. `
    + `Get to the point; expand only when asked. `
    + `When genuinely useful, end with:\n<<OPTIONS>>\n- option\n<<SUGGESTIONS>>\n- recommendation`;
}

/* Streaming chat completion. Tokens are pushed to `onToken(delta, full)` as they
   arrive so the reply renders (and starts speaking) immediately instead of after
   the whole 550B generation finishes — the single biggest perceived-speed win. */
async function callLLM(history, lang, onToken) {
  const endpoint = store.endpoint;
  const keyless = KEYLESS.test(endpoint);   // Pollinations etc. need no key
  const key = store.key;
  // Honour the explicit "prefer offline" choice; only require a key for
  // endpoints that actually need one (NVIDIA). Real failures get a specific msg.
  if (store.offline) return offlineReply(lang);
  if (!keyless && !key) return offlineReply(lang);

  if (keyless) {
    // Keyless default: the streaming GET is the fastest reliable browser path —
    // it's a CORS "simple request" (no preflight round-trip) AND streams tokens.
    // Only if it fails do we try the POST form.
    try { return await pollinationsGet(history, lang, onToken); }
    catch (e1) {
      try { return await openaiPost(endpoint, history, lang, onToken, ""); }
      catch (e2) { return `⚠️ Couldn't reach the AI right now (${shortErr(e1)}). It may be busy — try again in a moment.`; }
    }
  }
  // Keyed providers (e.g. NVIDIA via your proxy).
  try { return await openaiPost(endpoint, history, lang, onToken, key); }
  catch (e) {
    if (e.status) return httpErrorMessage(e.status, e.body || "", lang);
    const direct = endpoint.includes("integrate.api.nvidia.com");
    return direct
      ? "⚠️ The browser blocked the request to NVIDIA (CORS). NVIDIA's API can't be called directly from a web app. "
        + "Open Settings ▸ API endpoint and paste your CORS-proxy URL (see web/proxy/cloudflare-worker.js), then Save. "
        + `(${shortErr(e)})`
      : `⚠️ Couldn't reach the AI endpoint. Check Settings, or try again. (${shortErr(e)})`;
  }
}

const shortErr = (e) => (e && (e.message || e.name)) || String(e);

/* Read a streamed fetch body token-by-token, calling onToken(delta, full) as text
   arrives. Handles both OpenAI-style SSE ("data: {json}") and a plain text stream,
   so it works across providers. Returns the full text. */
async function readStream(body, onToken) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "", mode = null;        // 'sse' | 'raw', detected from the first chunk
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    if (mode === null) mode = /(^|\n)\s*data:/.test(chunk) ? "sse" : "raw";
    if (mode === "raw") { full += chunk; onToken?.(chunk, full); continue; }
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const p = line.slice(5).trim();
      if (!p || p === "[DONE]") continue;
      let delta = "";
      try { delta = JSON.parse(p)?.choices?.[0]?.delta?.content || ""; }
      catch { delta = p; }                      // payload wasn't JSON → treat as raw text
      if (delta) { full += delta; onToken?.(delta, full); }
    }
  }
  return full.trim();
}

/* Pollinations' GET text API — a CORS "simple request" (no preflight) so it works
   from any browser page, with stream=true for token-by-token delivery. Recent turns
   are flattened into one prompt (GET URLs have a length limit). Tries a couple of
   URL variants for resilience. */
async function pollinationsGet(history, lang, onToken) {
  const recent = history.filter(m => m.role !== "sys").slice(-6)
    .map(m => (m.role === "user" ? "User: " : "ACTIG: ") + m.text).join("\n");
  const prompt = (systemPrompt(lang) + "\n\n" + recent + "\nACTIG:").slice(-1800);
  const enc = encodeURIComponent(prompt);
  const model = encodeURIComponent(store.model || "openai");
  const variants = [
    `https://text.pollinations.ai/${enc}?model=${model}&stream=true&referrer=actig-pwa`, // streamed
    `https://text.pollinations.ai/${enc}?model=${model}&referrer=actig-pwa`,             // plain
    `https://text.pollinations.ai/${enc}`,                                               // bare
  ];
  let lastErr;
  for (let i = 0; i < variants.length; i++) {
    try {
      const res = await fetch(variants[i]);     // simple request — no preflight
      if (!res.ok) { lastErr = new Error("GET " + res.status); continue; }
      if (i === 0 && res.body && res.body.getReader) {
        const full = await readStream(res.body, onToken);
        if (full) return full;
        lastErr = new Error("empty stream"); continue;
      }
      const text = (await res.text()).trim();
      if (!text) { lastErr = new Error("empty reply"); continue; }
      onToken?.(text, text);
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no response");
}

/* OpenAI-compatible streaming POST core. Takes an explicit messages array and
   params so both chat and the code generator can share it. Returns the reply
   text; throws on failure (with .status/.body for HTTP errors). */
async function openaiPostRaw(endpoint, messages, { onToken, key, model, maxTokens = 512, temperature = 0.6 } = {}) {
  const headers = { "content-type": "application/json" };
  if (key) headers["authorization"] = "Bearer " + key;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: model || store.model, messages, max_tokens: maxTokens, temperature, stream: true }),
  });
  if (!res.ok) {
    const err = new Error("HTTP " + res.status);
    err.status = res.status;
    err.body = (await res.text().catch(() => "")).slice(0, 240);
    throw err;
  }
  if (!res.body || !res.body.getReader) {       // runtime can't expose a stream body
    const data = await res.json().catch(() => null);
    const full = data?.choices?.[0]?.message?.content || data?.message?.content || "";
    if (!full) throw new Error("empty reply");
    onToken?.(full, full);
    return full;
  }
  const full = await readStream(res.body, onToken);
  if (!full) throw new Error("empty reply");
  return full;
}

/* Chat POST (NVIDIA via proxy, or Pollinations fallback). */
async function openaiPost(endpoint, history, lang, onToken, key) {
  const messages = [{ role: "system", content: systemPrompt(lang) }].concat(
    history.filter(m => m.role !== "sys")
      .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))
  );
  return openaiPostRaw(endpoint, messages, { onToken, key, model: store.model, maxTokens: 512, temperature: 0.6 });
}

/* Vision chat: send the latest user turn as a multimodal message (text + images)
   via a POST. Works when the endpoint/model supports vision (e.g. Pollinations
   "openai"); the caller falls back to text-only if this throws. */
async function callLLMVision(history, images, lang, onToken) {
  const endpoint = store.endpoint;
  const keyless = KEYLESS.test(endpoint);
  const key = store.key;
  const src = history.filter(m => m.role !== "sys");
  const messages = [{ role: "system", content: systemPrompt(lang) }];
  src.forEach((m, i) => {
    const isLastUser = i === src.length - 1 && m.role === "user";
    if (isLastUser) {
      const content = [{ type: "text", text: m.text }];
      for (const im of images) content.push({ type: "image_url", image_url: { url: im.dataUrl } });
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.text });
    }
  });
  return openaiPostRaw(endpoint, messages, { onToken, key: keyless ? "" : key, model: store.model, maxTokens: 1024, temperature: 0.5 });
}

/* Generic single-shot generation with an arbitrary system+user prompt — used by
   the code generator (Vibe Build). Auto-picks the provider like chat does: keyless
   default (Pollinations) tries the no-preflight GET first for large outputs and
   falls back to POST; a keyed endpoint (NVIDIA proxy) uses POST. */
async function llmGenerate(system, user, { onToken, maxTokens = 4000, temperature = 0.3 } = {}) {
  if (store.offline) throw new Error("offline mode is on — turn off ‘Prefer offline’ in Settings");
  const endpoint = store.endpoint;
  const keyless = KEYLESS.test(endpoint);
  const key = store.key;
  const model = store.buildModel || store.model;
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  if (keyless) {
    // Streaming GET first (no CORS preflight); POST as a fallback.
    try { return await pollinationsGenerate(system, user, model, onToken); }
    catch { return await openaiPostRaw(endpoint, messages, { onToken, key: "", model, maxTokens, temperature }); }
  }
  return await openaiPostRaw(endpoint, messages, { onToken, key, model, maxTokens, temperature });
}

/* Pollinations GET for a system+user codegen prompt (no preflight, streamed). */
async function pollinationsGenerate(system, user, model, onToken) {
  const prompt = system + "\n\n" + user;
  const enc = encodeURIComponent(prompt);
  const m = encodeURIComponent(model || "openai");
  const variants = [
    `https://text.pollinations.ai/${enc}?model=${m}&stream=true&referrer=actig-pwa`,
    `https://text.pollinations.ai/${enc}?model=${m}&referrer=actig-pwa`,
  ];
  let lastErr;
  for (let i = 0; i < variants.length; i++) {
    try {
      const res = await fetch(variants[i]);
      if (!res.ok) { lastErr = new Error("GET " + res.status); continue; }
      if (i === 0 && res.body && res.body.getReader) {
        const full = await readStream(res.body, onToken);
        if (full) return full;
        lastErr = new Error("empty stream"); continue;
      }
      const text = (await res.text()).trim();
      if (!text) { lastErr = new Error("empty reply"); continue; }
      onToken?.(text, text);
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no response");
}

/* Turn an HTTP failure into a clear, actionable line instead of a vague "offline". */
function httpErrorMessage(status, body, lang) {
  if (status === 401 || status === 403)
    return `⚠️ API key rejected (HTTP ${status}). The default brain needs no key — clear the API key field in Settings, or paste a valid one for your endpoint, then Save. ${body}`;
  if (status === 404 || status === 400)
    return `⚠️ The model id looks wrong (HTTP ${status}). Set a valid model in Settings (default: ${DEFAULT_MODEL}). ${body}`;
  if (status === 429)
    return `⚠️ Rate-limited (HTTP 429). Wait a moment and try again. ${body}`;
  return `⚠️ AI request failed (HTTP ${status}). ${body || offlineReply(lang)}`;
}

function offlineReply(lang) {
  const m = {
    "ko-KR": "오프라인 모드예요. 설정에서 ‘오프라인 우선’을 끄면 온라인으로 답할 수 있어요.",
    "ja-JP": "オフラインモードです。設定で「オフライン優先」をオフにすればオンラインで答えます。",
    "zh-CN": "当前为离线模式。在设置中关闭“优先离线”即可联网回答。",
    "en-US": "I'm in offline mode, sir. Turn off “Prefer offline” in Settings and I'll answer online.",
  };
  return m[lang] || m["en-US"];
}

function parseStructured(raw) {
  const out = { text: raw, options: [], suggestions: [] };
  const oi = raw.indexOf("<<OPTIONS>>"), si = raw.indexOf("<<SUGGESTIONS>>");
  if (oi < 0 && si < 0) return out;
  const cut = Math.min(...[oi, si].filter(i => i >= 0));
  out.text = raw.slice(0, cut).trim();
  const list = (from, to) => raw.slice(from, to < 0 ? undefined : to)
    .split("\n").map(s => s.trim()).filter(s => s.startsWith("-")).map(s => s.slice(1).trim());
  if (oi >= 0) out.options = list(oi + 11, si);
  if (si >= 0) out.suggestions = list(si + 15, -1);
  return out;
}

/* ---------- command routing ---------- */
async function submit(text, source, atts) {
  atts = atts || takeAttachments();               // files attached in the input bar
  const lang = detectLang(text || (atts.length ? "the attached files" : ""));
  const modelText = augmentWithFiles(text, atts); // text-file contents inlined for the model
  addBubble("user", text || "(attached files)", [], [], atts);
  messages.push({ role: "user", text: modelText, display: text, attNames: atts.map(a => a.name) }); persist();

  const low = (text || "").toLowerCase();
  // deterministic intents (work offline, no key needed)
  if (/(3d|three d).*(project|space|studio)|open studio|3d 프로젝트|3dプロジェクト/.test(low)) {
    switchTab("studio"); return finish("Opening the 3D project space.", lang, source);
  }
  if (/^\s*(play |put on |음악 틀어|노래 틀어|播放)/.test(low)) {
    const q = text.replace(/^.*?(play |put on |음악 틀어|노래 틀어|播放)/i, "").trim() || text;
    window.open("https://music.apple.com/search?term=" + encodeURIComponent(q), "_blank");
    return finish(`Searching music for “${q}”.`, lang, source);
  }
  if (/(mute).*(me|mic)|음소거/.test(low)) { setUserMuted(true); return finish("Your mic is muted.", lang, source); }
  if (/(be quiet|mute (yourself|ai)|stop talking|조용히)/.test(low)) { setAIMuted(true); return finish("Voice muted.", lang, source); }

  // Vibe Build — "build/make/create/generate a … app/website/game/3D/program".
  if (/\b(build|make|create|generate|develop|code)\b[\s\S]*\b(app|application|web ?app|web ?site|website|web ?page|page|site|game|program|tool|dashboard|landing|clone|3d|three ?d|model|viewer|simulation|visuali[sz]er)\b/.test(low)
      || /^\s*vibe ?code\b/.test(low)) {
    const spec = text.replace(/^\s*(please\s+)?(vibe ?code|build|make|create|generate|develop|code)\s+(me\s+)?(a|an|the)?\s*/i, "").trim() || text;
    clearBuildEditMode();
    runBuild(spec, source, lang, atts);
    return;
  }

  // Adjust the loaded program — when a saved/loaded program is active and the
  // message reads like an edit instruction, apply it instead of chatting.
  if (buildEditMode && /\b(add|change|make it|make the|remove|delete|adjust|edit|update|modify|set (the|it)|rename|replace|turn .* into|fix|increase|decrease|resize|recolor|restyle|move|swap|instead|also add|also make)\b/i.test(low)) {
    runAdjust(text, source);
    return;
  }

  // LLM brain — stream straight into a live bubble so the reply appears (and,
  // for voice, starts speaking) the moment the first tokens land.
  setStatus("Thinking…");
  const bubble = addBubble("ai", "");
  if (source === "voice" && "speechSynthesis" in window) speechSynthesis.cancel();
  let spoken = 0, firstToken = true;
  const onToken = (_delta, full) => {
    if (firstToken) { firstToken = false; setStatus("Replying…"); }
    const shown = parseStructured(full).text;      // hide <<OPTIONS>>/<<SUGGESTIONS>> markers
    setBubbleText(bubble, shown);
    if (source === "voice") {                       // speak completed sentences as they form
      const pending = shown.slice(spoken);
      const end = lastSentenceEnd(pending);
      if (end > 0) { speakQueued(pending.slice(0, end), lang); spoken += end; }
    }
  };
  const images = atts.filter(a => a.kind === "image" && a.dataUrl);
  let raw;
  if (images.length) {                              // vision: send image(s) via a multimodal POST
    try { raw = await callLLMVision(messages, images, lang, onToken); }
    catch { raw = await callLLM(messages, lang, onToken); } // provider has no vision/CORS → text only
  } else {
    raw = await callLLM(messages, lang, onToken);
  }
  const { text: reply, options, suggestions } = parseStructured(raw);
  setBubbleText(bubble, reply);
  decorateBubble(bubble, options, suggestions);
  messages.push({ role: "assistant", text: reply, options, suggestions }); persist();
  setStatus("Ready");
  if (source === "voice") {                          // speak any trailing remainder past the last sentence
    const rest = reply.slice(spoken).trim();
    if (rest) speakQueued(rest, lang);
  }
}

function finish(reply, lang, source) {
  addBubble("ai", reply);
  messages.push({ role: "assistant", text: reply }); persist();
  if (source === "voice") speak(reply, lang);
}

/* ---------- UI ---------- */
function addBubble(kind, text, options = [], suggestions = [], atts = []) {
  const t = $("transcript");
  const b = document.createElement("div");
  b.className = "bubble " + (kind === "user" ? "user" : kind === "sys" ? "sys" : "ai");
  const txt = document.createElement("span");
  txt.className = "txt"; txt.textContent = text;
  b.appendChild(txt);
  if (atts && atts.length) {                       // show attached-file badges on the bubble
    const files = document.createElement("div"); files.className = "att-list";
    atts.forEach(a => {
      const name = typeof a === "string" ? a : a.name;
      const isImg = typeof a !== "string" && a.kind === "image";
      const f = document.createElement("span"); f.className = "att-badge";
      f.textContent = (isImg ? "🖼 " : "📄 ") + name;
      files.appendChild(f);
    });
    b.appendChild(files);
  }
  decorateBubble(b, options, suggestions);
  t.appendChild(b); t.scrollTop = t.scrollHeight;
  return b;
}
/* Replace a bubble's text in place (used while a reply streams in). */
function setBubbleText(b, text) {
  const txt = b.querySelector(".txt"); if (txt) txt.textContent = text;
  const t = $("transcript"); t.scrollTop = t.scrollHeight;
}
/* Render (or re-render) the option/suggestion chips for a bubble. */
function decorateBubble(b, options = [], suggestions = []) {
  const old = b.querySelector(".chips"); if (old) old.remove();
  if (!(options.length || suggestions.length)) return;
  const wrap = document.createElement("div"); wrap.className = "chips";
  [...options, ...suggestions].forEach(o => {
    const c = document.createElement("span"); c.className = "opt"; c.textContent = o;
    c.onclick = () => submit(o, "text"); wrap.appendChild(c);
  });
  b.appendChild(wrap);
}
function persist() { store.history = messages; }
function setStatus(s) { $("status").textContent = s; }
/* Muting (button, voice, or text) turns the mic fully off; unmuting just clears
   the flag — the user re-taps 🎤 to switch the mic back on (iOS needs the gesture). */
function setUserMuted(v) {
  userMuted = v;
  $("micUser").classList.toggle("muted-on", v);
  if (v) stopMic("Mic muted");
}
function setAIMuted(v) { aiMuted = v; $("micAI").classList.toggle("muted-on", v); if (v) speechSynthesis.cancel(); }

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $("tab-" + name).classList.add("active");
  if (name === "studio") ensureStudio();
  if (name === "build") ensureBuild().then(b => b && b.renderLibrary && b.renderLibrary()).catch(() => {});
}

/* ---------- 3D studio (lazy) ---------- */
let studio = null;
async function ensureStudio() {
  if (studio) return;
  try {
    const mod = await import("./studio.js");
    studio = await mod.createStudio($("studio-host"));
  } catch (e) { addBubble("sys", "3D studio needs a network connection the first time."); }
}

/* ---------- Vibe Build (lazy) — AI generates a full client-side program ---------- */
let builder = null;
async function ensureBuild() {
  if (builder) return builder;
  const mod = await import("./build.js");
  builder = mod.createBuilder({
    llmGenerate, store, addBubble,
    dom: {
      iframe: $("buildPreview"), fileList: $("buildFiles"), statusEl: $("buildStatus"),
      metricsEl: $("buildMetrics"), libraryEl: $("buildLibrary"),
      openBtn: $("buildOpen"), zipBtn: $("buildZip"), publishBtn: $("buildPublish"),
    },
    // a saved program was loaded → enter edit mode so requests adjust it
    onActive: (rec) => setBuildEditMode(rec?.name || ""),
    onAdjustRequested: () => { switchTab("build"); const el = $("buildSpec"); el.placeholder = `Describe a change to “${buildActiveName}”…`; el.focus(); },
  });
  return builder;
}

/* Build lifecycle + resilience. iOS suspends backgrounded web apps, so we can't
   truly keep computing in another app — instead we checkpoint progress (in
   build.js) and AUTO-RESUME the moment ACTIG is foregrounded again, and hold a
   screen wake-lock so a build isn't killed by the screen sleeping. */
let building = false, wakeLock = null;
let buildEditMode = false, buildActiveName = "";
async function acquireWakeLock() {
  try { if ("wakeLock" in navigator && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

/* A saved program is loaded → subsequent requests adjust it (until "New"). */
function setBuildEditMode(name) {
  buildEditMode = true; buildActiveName = name || "";
  const s = $("buildSave"), a = $("buildApply");
  if (s) s.disabled = false;
  if (a) a.disabled = false;
  setStatus(`Editing “${buildActiveName}” — say or type a change`);
}
function clearBuildEditMode() {
  buildEditMode = false; buildActiveName = "";
  const el = $("buildSpec"); if (el) { el.value = ""; el.placeholder = "Describe a program to build…"; }
  const a = $("buildApply"); if (a) a.disabled = true;
}

/* Apply a requested change to the loaded program via the AI editor. */
async function runAdjust(request, source) {
  if (building) { addBubble("sys", "Busy — one build/edit at a time."); return; }
  building = true; acquireWakeLock();
  switchTab("build");
  const b = await ensureBuild().catch(() => null);
  if (!b || !b.hasProgram()) { building = false; releaseWakeLock(); addBubble("sys", "Open or generate a program first, then request a change."); return; }
  addBubble("ai", "Applying your change…");
  if (source === "voice") speak("Applying your change, sir.", "en-US");
  setStatus("Editing…"); $("buildStatus").textContent = "Editing…";
  try {
    const res = await b.applyAdjustment(request, { onStatus: (s) => { setStatus(s); $("buildStatus").textContent = s; } });
    notifyBuildDone(res, source, b.isSaved() ? " (saved changes)" : "");
  } catch (e) {
    setStatus("Edit failed"); $("buildStatus").textContent = "Edit failed: " + shortErr(e);
    addBubble("sys", "Edit failed: " + shortErr(e));
    if (source === "voice") speak("Sorry, the change failed.", "en-US");
  } finally { building = false; releaseWakeLock(); }
}

/* Generate a program from a spec, then auto-deliver the testable link(s).
   `resume` (a saved checkpoint) continues an interrupted build. */
async function runBuild(spec, source, lang, atts, resume) {
  if (building) { addBubble("sys", "A build is already running — one at a time."); return; }
  atts = atts || takeAttachments();
  building = true;
  acquireWakeLock();
  switchTab("build");
  try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {}
  const b = await ensureBuild().catch(() => null);
  if (!b) { building = false; releaseWakeLock(); addBubble("sys", "Build engine failed to load (needs a network connection)."); return; }
  if (!resume) {
    addBubble("ai", "On it — generating your program. It keeps going and auto-resumes if you leave and come back.");
    if (source === "voice") speak("On it. Generating your program now, sir.", "en-US");
  }
  setStatus("Building…");
  $("buildStatus").textContent = "Building…";
  try {
    const res = await b.generate(spec, { atts, resume, onStatus: (s) => { setStatus(s); $("buildStatus").textContent = s; } });
    notifyBuildDone(res, source);
  } catch (e) {
    setStatus("Build paused");
    $("buildStatus").textContent = "Paused: " + shortErr(e) + " — will resume when you return.";
    // Keep the checkpoint so it resumes on foreground; only surface a note.
    addBubble("sys", "Build interrupted (" + shortErr(e) + "). It will auto-resume when ACTIG is back in the foreground, or tap Generate to continue.");
  } finally {
    building = false;
    releaseWakeLock();
  }
}

/* Continue an interrupted build from its saved checkpoint. */
async function resumeBuild() {
  const wip = store.buildWip;
  if (!wip || building) return;
  addBubble("ai", `Resuming your build: “${(wip.spec || "").slice(0, 80)}”…`);
  await runBuild(wip.spec, "text", "en-US", [], wip);
}

/* Announce completion three ways: a chat bubble with the link, spoken TTS, and a
   Web Notification. Auto-publishes a public URL if a GitHub token is configured. */
function notifyBuildDone(res, source, note = "") {
  const score = res.metrics ? ` (quality ${res.metrics.score}/100)` : "";
  const saveBtn = $("buildSave"); if (saveBtn) saveBtn.disabled = false;   // can now save/update
  const applyBtn = $("buildApply"); if (applyBtn) applyBtn.disabled = false;
  buildEditMode = true;                                                     // allow "make it red" follow-ups
  buildActiveName = (builder && builder.defaultName && builder.defaultName()) || buildActiveName;
  setStatus("Build finished ✓");
  const b = addBubble("ai", `✅ Build finished${score}${note} — your program is ready to test.`);
  const wrap = document.createElement("div"); wrap.className = "chips";
  const open = document.createElement("span"); open.className = "opt"; open.textContent = "▶ Open program";
  open.onclick = () => window.open(res.previewUrl, "_blank"); wrap.appendChild(open);
  const zip = document.createElement("span"); zip.className = "opt"; zip.textContent = "⬇ Download ZIP";
  zip.onclick = () => builder?.downloadZip(); wrap.appendChild(zip);
  b.appendChild(wrap);
  speak(`Your program is ready, sir. The build is finished${res.metrics ? `, quality score ${res.metrics.score} out of 100` : ""}.`, "en-US");
  webNotify("ACTIG — build finished", "Your program is ready to test." + score, res.previewUrl);
  if (store.ghToken && builder) {
    $("buildStatus").textContent = "Publishing public link…";
    builder.publish()
      .then(url => { addBubble("ai", "🌐 Public link (share/test anywhere): " + url); $("buildStatus").textContent = "Public URL ready"; })
      .catch(e => { addBubble("sys", "Auto-publish failed: " + shortErr(e)); });
  }
}

/* Best-effort desktop/PWA notification (installed PWAs on iOS 16.4+). */
function webNotify(title, body, url) {
  try {
    if (!("Notification" in window)) return;
    const show = () => { const n = new Notification(title, { body }); n.onclick = () => { window.open(url, "_blank"); n.close(); }; };
    if (Notification.permission === "granted") show();
    else if (Notification.permission !== "denied") Notification.requestPermission().then(p => { if (p === "granted") show(); });
  } catch {}
}

/* ---------- wiring ---------- */
function boot() {
  // restore transcript (show the clean display text + attachment badges)
  messages.forEach(m => addBubble(m.role === "user" ? "user" : "ai", m.display || m.text, m.options, m.suggestions, m.attNames || []));
  // settings
  $("apiKey").value = store.key; $("preferOffline").checked = store.offline;
  $("model").value = store.model; $("endpoint").value = store.endpoint;
  $("buildModel").value = store.buildModel; $("ghToken").value = store.ghToken;
  $("buildQuality").value = store.quality;
  $("saveKey").onclick = () => {
    store.key = $("apiKey").value;
    store.model = $("model").value;
    store.endpoint = $("endpoint").value;
    store.buildModel = $("buildModel").value;
    store.ghToken = $("ghToken").value;
    store.quality = $("buildQuality").value;
    store.offline = $("preferOffline").checked;
    $("model").value = store.model; $("endpoint").value = store.endpoint; // reflect defaults
    setStatus("Saved");
  };
  $("clearHistory").onclick = () => { messages = []; persist(); $("transcript").innerHTML = ""; };
  // input
  $("send").onclick = send; $("draft").addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  function send() { const v = $("draft").value.trim(); if (!v && !attachments.length) return; $("draft").value = ""; submit(v, "text"); }
  // file attachments
  $("attach").onclick = () => $("fileInput").click();
  $("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  // HUD
  $("emergency").onclick = wake;
  $("micUser").onclick = toggleMic;            // one tap turns the mic on/off
  $("micAI").onclick = () => setAIMuted(!aiMuted);
  $("open3d").onclick = () => switchTab("studio");
  // tabs
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  // studio buttons
  document.querySelectorAll("[data-shape]").forEach(b => b.onclick = () => { ensureStudio().then(() => studio?.spawn(b.dataset.shape)); });
  $("clone").onclick = () => studio?.clone();
  $("del").onclick = () => studio?.remove();
  $("gesture").onclick = (e) => { ensureStudio().then(() => { const on = studio?.toggleGestures(); e.target.classList.toggle("on", on); }); };
  // Vibe Build
  $("buildGo").onclick = () => { const v = $("buildSpec").value.trim(); if (v) { clearBuildEditMode(); runBuild(v, "text", "en-US"); } };
  $("buildApply").onclick = () => { const v = $("buildSpec").value.trim(); if (!v) { addBubble("sys", "Type the change to apply first."); return; } $("buildSpec").value = ""; runAdjust(v, "text"); };
  $("buildNew").onclick = () => { clearBuildEditMode(); setStatus("Ready for a new build"); };
  $("buildSave").onclick = async () => {
    const b = await ensureBuild().catch(() => null);
    if (!b || !b.hasProgram()) { addBubble("sys", "Generate or open a program first."); return; }
    const name = (prompt("Save program as:", b.defaultName() || "My program") || "").trim();
    if (!name) return;
    try { await b.saveCurrent(name); setBuildEditMode(name); addBubble("ai", `💾 Saved “${name}” to your library.`); }
    catch (e) { addBubble("sys", "Save failed: " + shortErr(e)); }
  };

  setStatus('Tap 🎤 to turn on the mic');
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // Resilience for backgrounding: re-acquire the wake-lock and auto-resume an
  // interrupted build whenever ACTIG returns to the foreground.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (building && !wakeLock) acquireWakeLock();
    if (!building && store.buildWip) resumeBuild();
  });
  // If a build was in progress when the app was last closed, pick it back up.
  if (store.buildWip) setTimeout(resumeBuild, 600);
}
document.addEventListener("DOMContentLoaded", boot);
