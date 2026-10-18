// Offline render of worklet.js: rpm sweep with load profile → WAV, plus sanity stats.
const fs = require('fs'), path = require('path');
const sr = 48000;
let Proc;
global.sampleRate = sr;
global.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null }; } };
global.registerProcessor = (_n, c) => { Proc = c; };
eval(fs.readFileSync(path.join(__dirname, '../worklet.js'), 'utf8'));
const engine = process.argv[2] || 'i4', secs = 12;
const p = new Proc(); p.port.onmessage({ data: { engine } });
const N = sr * secs, buf = new Float32Array(N), blk = 128;
for (let i = 0; i < N; i += blk) {
  const t = i / sr;
  // 0-1 idle, 1-6 full throttle 1000->6800, 6-8 lift off, 8-12 part throttle 2500
  let rpm, load;
  if (t < 1) { rpm = 850; load = 0; }
  else if (t < 6) { rpm = 1000 + (t - 1) / 5 * (+process.env.TOP || 6200); load = 1; }
  else if (t < 8) { rpm = 7200 - (t - 6) * 2000; load = 0; }
  else { rpm = 2500; load = 0.3; }
  p.port.onmessage({ data: { rpm, load } });
  const o = [new Float32Array(blk), new Float32Array(blk)];
  p.process([], [o]);
  buf.set(o[0].subarray(0, Math.min(blk, N - i)), i);
}
let nan = 0, peak = 0; const rms = [];
for (let s = 0; s < secs; s++) { let a = 0; for (let j = s * sr; j < (s + 1) * sr; j++) { const v = buf[j]; if (!isFinite(v)) nan++; a += v * v; peak = Math.max(peak, Math.abs(v)); } rms.push(Math.sqrt(a / sr).toFixed(3)); }
console.log(engine, 'nan', nan, 'peak', peak.toFixed(3), 'rms/s', rms.join(' '));
const pcm = Buffer.alloc(44 + N * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28);
pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
fs.writeFileSync(path.join(__dirname, `${engine}.wav`), pcm);
