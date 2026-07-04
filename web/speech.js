/* speech.js — voice INPUT for iOS, where the Web Speech recognition API is
   unavailable in Safari. Records the mic (getUserMedia + MediaRecorder) and
   transcribes on-device with Whisper via transformers.js — no API key, runs in
   the browser. The model (~tens of MB) downloads once and is cached. */

/* Pipelines are cached per model id. whisper-tiny is the fast default;
   whisper-base is used when Korean is active — noticeably better Hangul. */
const DEFAULT_ASR = "Xenova/whisper-tiny";
const pipes = {};    // modelId -> pipeline | Promise<pipeline>

async function getPipe(onStatus, model = DEFAULT_ASR) {
  if (pipes[model]) return pipes[model];
  onStatus?.("Loading speech model… (first time only)");
  pipes[model] = (async () => {
    const t = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3");
    t.env.allowLocalModels = false;
    const p = await t.pipeline("automatic-speech-recognition", model, { dtype: "q8" });
    pipes[model] = p;
    return p;
  })();
  return pipes[model];
}

/* Decode a recorded Blob to mono Float32 @16 kHz for Whisper. */
async function blobToMono16k(blob) {
  const arr = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const buf = await ctx.decodeAudioData(arr);
  const ch = buf.numberOfChannels;
  let data = buf.getChannelData(0);
  if (ch > 1) {
    const mix = new Float32Array(buf.length);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mix[i] += d[i] / ch; }
    data = mix;
  }
  const rate = buf.sampleRate, target = 16000;
  ctx.close?.();
  if (rate === target) return data;
  const ratio = rate / target, len = Math.floor(data.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = data[Math.floor(i * ratio)];
  return out;
}

/* Whisper wants full language names; map codes defensively. */
const LANG_NAMES = { ko: "korean", "ko-kr": "korean", en: "english", "en-us": "english", ja: "japanese", zh: "chinese", fr: "french" };

/* Pick a pipeline without ever hanging a turn: if the wanted model is loaded use
   it; otherwise start loading it in the background and serve this turn with the
   already-loaded default (tiny). Only block when NOTHING is loaded yet. */
async function pickPipe(onStatus, model) {
  const want = model || DEFAULT_ASR;
  const w = pipes[want];
  if (w && !(w instanceof Promise)) return w;
  if (want !== DEFAULT_ASR) {
    getPipe(undefined, want).catch(() => {});          // upgrade in background
    const d = pipes[DEFAULT_ASR];
    if (d && !(d instanceof Promise)) return d;        // serve this turn with tiny
    if (d instanceof Promise) return d;
  }
  return getPipe(onStatus, want);
}

export async function transcribeBlob(blob, lang, onStatus, model) {
  const pipe = await pickPipe(onStatus, model);
  const audio = await blobToMono16k(blob);
  onStatus?.("Transcribing…");
  const opts = { chunk_length_s: 30, task: "transcribe" };
  if (lang && lang !== "auto") {
    const k = String(lang).toLowerCase();
    opts.language = LANG_NAMES[k] || LANG_NAMES[k.split("-")[0]] || k;
  }
  let out;
  try { out = await pipe(audio, opts); }
  catch { out = await pipe(audio, { chunk_length_s: 30 }); }   // bad language opt → retry plain
  return (out.text || "").trim();
}

/* Record from an ALREADY-OPEN stream (the caller must obtain it inside the user
   gesture, which iOS requires). Returns { stop, done }; auto-stops after maxMs.
   Pass keepAlive:true to leave the stream's tracks running between recordings
   (continuous-listening mode reuses one stream across many windows). */
export function recordStream(stream, { maxMs = 8000, onStatus, keepAlive = false } = {}) {
  const mime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
    : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  onStatus?.("Listening…");
  rec.start();
  const cleanup = () => { if (!keepAlive) stream.getTracks().forEach((t) => t.stop()); };
  const stop = () => { if (rec.state !== "inactive") rec.stop(); };
  const timer = setTimeout(stop, maxMs);
  const done = stopped.then(() => { clearTimeout(timer); cleanup(); return new Blob(chunks, { type: mime || "audio/webm" }); });
  return { stop, done };
}

/* Convenience that opens the mic itself (use only inside a user gesture). */
export async function startRecording({ maxMs = 8000, onStatus } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
    : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  onStatus?.("Listening…");
  rec.start();
  const cleanup = () => stream.getTracks().forEach((t) => t.stop());
  const stop = () => { if (rec.state !== "inactive") rec.stop(); };
  const timer = setTimeout(stop, maxMs);
  const done = stopped.then(() => { clearTimeout(timer); cleanup(); return new Blob(chunks, { type: mime || "audio/webm" }); });
  return { stop, done };
}

/* Pre-load the Whisper pipeline (and prime it with a beat of silence) so the
   FIRST spoken turn doesn't pay the model-load + compile cost. Fire-and-forget. */
export async function warmup(onStatus, model) {
  try {
    const pipe = await getPipe(onStatus, model);
    await pipe(new Float32Array(16000), { chunk_length_s: 30 });   // 1s of silence primes kernels
  } catch {}
}

/* Is on-device voice input usable here? (secure context + mic + recorder) */
export function voiceInputSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.isSecureContext);
}
