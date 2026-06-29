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

const $ = (id) => document.getElementById(id);
const store = {
  get key() { return localStorage.getItem("actig.key") || ""; },
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
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang || "en-US";
  u.onstart = () => { speaking = true; };
  u.onend = () => { speaking = false; };
  speechSynthesis.speak(u);
}

/* ---------- speech input ----------
   iOS Safari has no Web Speech *recognition* API, so we record the mic and
   transcribe on-device with Whisper (speech.js). Where the native API DOES
   exist (Android/desktop) we use it for a hands-free wake word too. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRec = null, recording = null, speechMod = null;

async function speech() { return (speechMod ??= await import("./speech.js")); }

function startWakeWord() {
  if (SR) {
    try {
      wakeRec = new SR();
      wakeRec.continuous = true; wakeRec.interimResults = true; wakeRec.lang = "en-US";
      wakeRec.onresult = (e) => {
        const heard = Array.from(e.results).map(r => r[0].transcript).join(" ").toLowerCase();
        if (heard.includes(WAKE)) wake();
      };
      wakeRec.onerror = () => {};
      wakeRec.onend = () => { if (!userMuted) { try { wakeRec.start(); } catch {} } };
      wakeRec.start();
      setStatus('Listening for “wake up ACTIG”');
      return;
    } catch {}
  }
  // iOS / no continuous recognition: push-to-talk.
  setStatus('Tap ⚡ or 🎤 to talk');
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

/* Record the open stream, transcribe on-device, and submit. */
async function recordFromStream(stream) {
  if (recording) { recording.stop(); return; }
  if (speaking) speechSynthesis.cancel();                 // barge-in
  setMicActive(true);
  try {
    const sp = await speech();
    recording = sp.recordStream(stream, { maxMs: 8000, onStatus: setStatus });
    const blob = await recording.done;
    recording = null; setMicActive(false);
    const text = await sp.transcribeBlob(blob, "auto", setStatus);
    setStatus("Ready");
    if (text) submit(text, "voice");
    else addBubble("sys", "I didn't catch that — tap 🎤 and try again.");
  } catch (e) {
    recording = null; setMicActive(false); setStatus("Mic error");
    addBubble("sys", "Voice error: " + (e?.message || e) + ". You can still type.");
  }
}

/* Mic button: tap to talk, tap again to stop. */
async function toggleRecord() {
  if (recording) { recording.stop(); return; }
  if (userMuted) return;
  const stream = await acquireMic();          // getUserMedia initiated in-gesture
  if (stream) recordFromStream(stream);
}

function setMicActive(on) {
  const b = $("micUser"); if (b) b.classList.toggle("on", on);
  if (on) setStatus("Listening…");
}

/* Wake (⚡): greet, then listen. Mic + TTS are both started inside the gesture. */
async function wake() {
  if (userMuted) setUserMuted(false);
  if (recording) { recording.stop(); return; }
  setStatus("Awake");
  addBubble("sys", REACTION);
  speak(REACTION, "en-US");                    // TTS started in-gesture
  const stream = await acquireMic();           // mic acquired in-gesture
  if (!stream) return;
  // Let the greeting finish so it isn't recorded, then listen.
  setTimeout(() => recordFromStream(stream), 1500);
}

/* ---------- brain ---------- */
function systemPrompt(lang) {
  return `You are ACTIG, a witty, warm JARVIS-style assistant. Reply naturally in ${lang}. `
    + `When useful, end with:\n<<OPTIONS>>\n- option\n<<SUGGESTIONS>>\n- recommendation`;
}

async function callLLM(history, lang) {
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
      body: JSON.stringify({ model: store.model, messages: msgs, max_tokens: 1024, temperature: 0.6 }),
    });
    if (!res.ok) return `(${res.status}) ` + (await res.text()).slice(0, 200);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || offlineReply(lang);
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

  // LLM brain
  setStatus("Thinking…");
  const raw = await callLLM(messages, lang);
  const { text: reply, options, suggestions } = parseStructured(raw);
  addBubble("ai", reply, options, suggestions);
  messages.push({ role: "assistant", text: reply, options, suggestions }); persist();
  setStatus("Ready");
  if (source === "voice") speak(reply, lang);
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
  b.textContent = text;
  if (options.length || suggestions.length) {
    const wrap = document.createElement("div"); wrap.className = "chips";
    [...options, ...suggestions].forEach(o => {
      const c = document.createElement("span"); c.className = "opt"; c.textContent = o;
      c.onclick = () => submit(o, "text"); wrap.appendChild(c);
    });
    b.appendChild(wrap);
  }
  t.appendChild(b); t.scrollTop = t.scrollHeight;
}
function persist() { store.history = messages; }
function setStatus(s) { $("status").textContent = s; }
function setUserMuted(v) { userMuted = v; $("micUser").classList.toggle("muted-on", v); if (v && wakeRec) try { wakeRec.stop(); } catch {} else startWakeWord(); }
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
  $("micUser").onclick = () => { if (userMuted) setUserMuted(false); else toggleRecord(); };
  $("micAI").onclick = () => setAIMuted(!aiMuted);
  $("open3d").onclick = () => switchTab("studio");
  // tabs
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  // studio buttons
  document.querySelectorAll("[data-shape]").forEach(b => b.onclick = () => { ensureStudio().then(() => studio?.spawn(b.dataset.shape)); });
  $("clone").onclick = () => studio?.clone();
  $("del").onclick = () => studio?.remove();
  $("gesture").onclick = (e) => { ensureStudio().then(() => { const on = studio?.toggleGestures(); e.target.classList.toggle("on", on); }); };

  startWakeWord();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
document.addEventListener("DOMContentLoaded", boot);
