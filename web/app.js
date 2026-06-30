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

/* OpenAI-compatible streaming POST (NVIDIA via proxy, or Pollinations fallback).
   Returns the reply text; throws on failure (with .status/.body for HTTP errors). */
async function openaiPost(endpoint, history, lang, onToken, key) {
  const msgs = [{ role: "system", content: systemPrompt(lang) }].concat(
    history.filter(m => m.role !== "sys")
      .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))
  );
  const headers = { "content-type": "application/json" };
  if (key) headers["authorization"] = "Bearer " + key;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: store.model, messages: msgs, max_tokens: 512, temperature: 0.6, stream: true }),
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
async function submit(text, source) {
  const lang = detectLang(text);
  addBubble("user", text);
  messages.push({ role: "user", text }); persist();

  const low = text.toLowerCase();
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

  // LLM brain — stream straight into a live bubble so the reply appears (and,
  // for voice, starts speaking) the moment the first tokens land.
  setStatus("Thinking…");
  const bubble = addBubble("ai", "");
  if (source === "voice" && "speechSynthesis" in window) speechSynthesis.cancel();
  let spoken = 0, firstToken = true;
  const raw = await callLLM(messages, lang, (_delta, full) => {
    if (firstToken) { firstToken = false; setStatus("Replying…"); }
    const shown = parseStructured(full).text;      // hide <<OPTIONS>>/<<SUGGESTIONS>> markers
    setBubbleText(bubble, shown);
    if (source === "voice") {                       // speak completed sentences as they form
      const pending = shown.slice(spoken);
      const end = lastSentenceEnd(pending);
      if (end > 0) { speakQueued(pending.slice(0, end), lang); spoken += end; }
    }
  });
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
function addBubble(kind, text, options = [], suggestions = []) {
  const t = $("transcript");
  const b = document.createElement("div");
  b.className = "bubble " + (kind === "user" ? "user" : kind === "sys" ? "sys" : "ai");
  const txt = document.createElement("span");
  txt.className = "txt"; txt.textContent = text;
  b.appendChild(txt);
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

/* ---------- wiring ---------- */
function boot() {
  // restore transcript
  messages.forEach(m => addBubble(m.role === "user" ? "user" : "ai", m.text, m.options, m.suggestions));
  // settings
  $("apiKey").value = store.key; $("preferOffline").checked = store.offline;
  $("model").value = store.model; $("endpoint").value = store.endpoint;
  $("saveKey").onclick = () => {
    store.key = $("apiKey").value;
    store.model = $("model").value;
    store.endpoint = $("endpoint").value;
    store.offline = $("preferOffline").checked;
    $("model").value = store.model; $("endpoint").value = store.endpoint; // reflect defaults
    setStatus("Saved");
  };
  $("clearHistory").onclick = () => { messages = []; persist(); $("transcript").innerHTML = ""; };
  // input
  $("send").onclick = send; $("draft").addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  function send() { const v = $("draft").value.trim(); if (!v) return; $("draft").value = ""; submit(v, "text"); }
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

  setStatus('Tap 🎤 to turn on the mic');
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
document.addEventListener("DOMContentLoaded", boot);
