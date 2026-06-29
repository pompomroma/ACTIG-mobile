/* speech.js — voice INPUT for iOS, where the Web Speech recognition API is
   unavailable in Safari. Records the mic (getUserMedia + MediaRecorder) and
   transcribes on-device with Whisper via transformers.js — no API key, runs in
   the browser. The model (~tens of MB) downloads once and is cached. */

let asrPipe = null, loading = null;

async function getPipe(onStatus) {
  if (asrPipe) return asrPipe;
  if (loading) return loading;
  onStatus?.("Loading speech model… (first time only)");
  loading = (async () => {
    const t = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3");
    t.env.allowLocalModels = false;
    asrPipe = await t.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", { dtype: "q8" });
    return asrPipe;
  })();
  return loading;
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

export async function transcribeBlob(blob, lang, onStatus) {
  const pipe = await getPipe(onStatus);
  const audio = await blobToMono16k(blob);
  onStatus?.("Transcribing…");
  const opts = { chunk_length_s: 30 };
  if (lang && lang !== "auto") opts.language = lang.split("-")[0]; // e.g. "ko"
  const out = await pipe(audio, opts);
  return (out.text || "").trim();
}

/* Start recording; returns { stop, done }. Auto-stops after maxMs. */
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

/* Is on-device voice input usable here? (secure context + mic + recorder) */
export function voiceInputSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.isSecureContext);
}
