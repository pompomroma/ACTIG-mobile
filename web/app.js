/* ACTIG PWA — installable from Safari (no PC/account/signing needed).
   Covers the browser-feasible subset: holographic chat, voice in/out, wake word,
   language switching, command routing, history, and the 3D studio. Native-only
   features (Siri, widgets, HealthKit, Apple on-device model) are out of a browser
   sandbox and live in the native app. */

const WAKE = "wake up actig";
const REACTION = "ACTIG at your service sir";
// Primary brain: NVIDIA Nemotron via the OpenAI-compatible NIM endpoint.
const LLM_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "nemotron-3-ultra-550b-a55b";
// Built-in NVIDIA API key so the app answers with full accuracy out of the box —
// no Settings step needed. A key typed in Settings overrides this one.
const BUILTIN_KEY = "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";

const $ = (id) => document.getElementById(id);
const store = {
  get key() { return localStorage.getItem("actig.key") || BUILTIN_KEY; },
  set key(v) { localStorage.setItem("actig.key", v); },
  get offline() { return localStorage.getItem("actig.offline") === "1"; },
  set offline(v) { localStorage.setItem("actig.offline", v ? "1" : "0"); },
  get model() { return localStorage.getItem("actig.model") || DEFAULT_MODEL; },
  set model(v) { localStorage.setItem("actig.model", v || DEFAULT_MODEL); },
  get history() { try { return JSON.parse(localStorage.getItem("actig.history") || "[]"); } catch { return []; } },
  set history(v) { localStorage.setItem("actig.history", JSON.stringify(v.slice(-400))); },
};

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

async function speech() { return (speechMod ??= await import("./speech.js")); }
const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
    listenLoop(stream);                         // iOS: chunked on-device Whisper loop
  }
}

/* Turn the mic fully off and release the hardware. */
function stopMic(status) {
  micOn = false; awake = false; listenAbort = true;
  if (recording) { try { recording.stop(); } catch {} }
  if (wakeRec) { try { wakeRec.onend = null; wakeRec.stop(); } catch {} wakeRec = null; }
  if (listenStream) { try { listenStream.getTracks().forEach(t => t.stop()); } catch {} listenStream = null; }
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

/* iOS path: keep the one stream open and loop record → transcribe. Before the
   wake word we only watch for it; after, each window is sent to the AI. */
async function listenLoop(stream) {
  let sp;
  try { sp = await speech(); }
  catch (e) { stopMic("Voice unavailable"); addBubble("sys", "Couldn't load the speech model: " + (e?.message || e)); return; }
  while (micOn && !listenAbort) {
    if (speaking) { await delay(250); continue; }   // don't record ACTIG's own voice
    let text = "";
    try {
      recording = sp.recordStream(stream, { maxMs: awake ? 7000 : 4000, keepAlive: true, onStatus: setStatus });
      const blob = await recording.done;
      recording = null;
      if (!micOn || listenAbort) break;
      text = await sp.transcribeBlob(blob, "auto", setStatus);
    } catch (e) {
      recording = null;
      if (!micOn || listenAbort) break;
      await delay(400); continue;                    // transient error — keep listening
    }
    if (!micOn || listenAbort) break;
    if (!text) { setStatus(awake ? "Listening…" : 'Say “wake up ACTIG”'); continue; }
    if (!awake) {
      if (isWake(text)) becomeAwake();
      else setStatus('Say “wake up ACTIG”');
    } else {
      await submit(text, "voice");                    // await so we don't talk over the reply
    }
  }
}

function setMicActive(on) {
  const b = $("micUser"); if (b) b.classList.toggle("on", on);
}

/* Wake (⚡): turn the mic on (if needed) and skip straight to awake. */
async function wake() {
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
  return `You are ACTIG, a witty, warm JARVIS-style assistant. Reply naturally in ${lang}. `
    + `When useful, end with:\n<<OPTIONS>>\n- option\n<<SUGGESTIONS>>\n- recommendation`;
}

/* Streaming chat completion. Tokens are pushed to `onToken(delta, full)` as they
   arrive so the reply renders (and starts speaking) immediately instead of after
   the whole 550B generation finishes — the single biggest perceived-speed win. */
async function callLLM(history, lang, onToken) {
  const key = store.key;
  if (!key || store.offline) return offlineReply(lang);
  try {
    // OpenAI-compatible chat completion (NVIDIA NIM). System prompt is the first
    // message; the tool/options protocol is prompt-based so behaviour matches the
    // previous Claude setup exactly.
    const msgs = [{ role: "system", content: systemPrompt(lang) }].concat(
      history.filter(m => m.role !== "sys")
        .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))
    );
    const res = await fetch(LLM_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + key },
      body: JSON.stringify({ model: store.model, messages: msgs, max_tokens: 1024, temperature: 0.6, stream: true }),
    });
    if (!res.ok) return `(${res.status}) ` + (await res.text()).slice(0, 200);
    // Fall back to a plain read if the runtime can't expose a stream body.
    if (!res.body || !res.body.getReader) {
      const data = await res.json();
      const full = data?.choices?.[0]?.message?.content || offlineReply(lang);
      onToken?.(full, full);
      return full;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content || "";
          if (delta) { full += delta; onToken?.(delta, full); }
        } catch {}
      }
    }
    return full || offlineReply(lang);
  } catch (e) {
    // Browsers may block cross-origin API calls (CORS); fall back gracefully.
    return offlineReply(lang) + ` (network/CORS: ${e.message})`;
  }
}

function offlineReply(lang) {
  const m = {
    "ko-KR": "오프라인 모드예요. 설정에서 NVIDIA API 키를 넣으면 정확히 답할 수 있어요.",
    "ja-JP": "オフラインです。設定でNVIDIA APIキーを入れると正確に答えられます。",
    "zh-CN": "当前离线。在设置中填入 NVIDIA API 密钥后我能准确回答。",
    "en-US": "I'm offline right now, sir. Add your NVIDIA API key in Settings and I'll answer with full accuracy.",
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
  $("apiKey").value = store.key; $("preferOffline").checked = store.offline; $("model").value = store.model;
  $("saveKey").onclick = () => { store.key = $("apiKey").value.trim(); store.model = $("model").value.trim(); store.offline = $("preferOffline").checked; setStatus("Saved"); };
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
