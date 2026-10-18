// Engine sound synthesis (AudioWorklet). Pulse train per cylinder firing → exhaust resonances → soft clip.
// Main thread sends {rpm, load, engine} via port; everything else is generated here.

const ENGINES = {
  v12:   { cyl: 12, amps: [1, 0.9, 0.97, 0.88, 1, 0.92, 0.95, 0.9, 1, 0.87, 0.96, 0.91], timing: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], res: [160, 480, 1400], q: [2.5, 3.5, 3], bright: 1.35, scream: 1 },
  i4:    { cyl: 4, amps: [1, 0.92, 0.97, 0.9],                 timing: [1, 1, 1, 1],                  res: [110, 320, 950],  q: [2.5, 3, 2], bright: 1.0 },
  v6:    { cyl: 6, amps: [1, 0.85, 0.95, 0.8, 0.98, 0.83],     timing: [1, 1, 1, 1, 1, 1],            res: [95, 260, 780],   q: [3, 3, 2.5], bright: 0.9 },
  v8:    { cyl: 8, amps: [1, 0.55, 0.95, 0.7, 0.9, 0.5, 1, 0.65], timing: [1.12, 0.88, 1.05, 0.95, 1.1, 0.9, 1.03, 0.97], res: [75, 210, 620], q: [3.5, 3, 2.5], bright: 0.75 },
  boxer: { cyl: 4, amps: [1, 0.6, 0.95, 0.65],                 timing: [1.1, 0.9, 1.1, 0.9],          res: [85, 240, 700],   q: [3, 2.5, 2], bright: 0.8 },
};

class SVF { // Chamberlin state-variable filter, band-pass output
  constructor() { this.lp = 0; this.bp = 0; }
  run(x, f, q, sr) {
    const F = 2 * Math.sin(Math.PI * Math.min(f, sr / 6) / sr);
    const hp = x - this.lp - this.bp / q;
    this.bp += F * hp;
    this.lp += F * this.bp;
    return this.bp;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rpm = 850; this.load = 0; this.tRpm = 850; this.tLoad = 0;
    this.engine = ENGINES.i4; this.redline = 7000;
    this.countdown = 0; this.idx = 0; this.env = 0; this.tau = 0.002;
    this.pop = 0; this.popDelay = -1;
    this.res = [new SVF(), new SVF(), new SVF()];
    this.popF = new SVF(); this.intakeF = new SVF();
    this.lp1 = 0; this.lp2 = 0; this.dc = 0; this.dcIn = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.rpm !== undefined) this.tRpm = d.rpm;
      if (d.load !== undefined) this.tLoad = d.load;
      if (d.engine && ENGINES[d.engine]) this.engine = ENGINES[d.engine];
      if (d.redline) this.redline = d.redline;
    };
  }

  fire(sr) {
    const E = this.engine, i = this.idx % E.cyl;
    let amp = (0.45 + 0.55 * this.load) * E.amps[i] * (1 + 0.1 * (Math.random() - 0.5));
    if (this.rpm > this.redline && Math.random() < 0.7) amp = 0; // limiter cut
    this.env = amp;
    this.tau = 0.0015 + 0.0025 * this.load;
    // overrun crackle: off-throttle at higher rpm
    if (this.load < 0.06 && this.rpm > 2300 && this.popDelay < 0 && Math.random() < 0.05) {
      this.popDelay = Math.floor(sr * (0.005 + 0.03 * Math.random()));
    }
    this.idx++;
    const firePerSec = Math.max(this.rpm, 300) / 60 * E.cyl / 2;
    this.countdown += sr / firePerSec * E.timing[i];
  }

  process(_in, outputs) {
    const out = outputs[0], ch0 = out[0], sr = sampleRate;
    const n = ch0.length, E = this.engine;
    const k = 1 - Math.exp(-n / (sr * 0.03));
    this.rpm += (this.tRpm - this.rpm) * k;
    this.load += (this.tLoad - this.load) * Math.min(1, k * 1.5);
    const decay = Math.exp(-1 / (sr * this.tau));
    const cutoff = (600 + 2600 * this.load + 0.25 * this.rpm) * E.bright;
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
    const drive = 1.2 + 2.5 * this.load;
    for (let s = 0; s < n; s++) {
      this.countdown -= 1;
      if (this.countdown <= 0) this.fire(sr);
      const noise = Math.random() * 2 - 1;
      const exc = this.env * (0.6 + 0.4 * noise);
      this.env *= decay;
      let x = exc * 0.5
        + this.res[0].run(exc, E.res[0], E.q[0], sr) * 1.4
        + this.res[1].run(exc, E.res[1], E.q[1], sr) * 0.8
        + this.res[2].run(exc, E.res[2] * (E.scream ? 0.7 + this.rpm / 9000 : 1), E.q[2], sr) * (0.35 + (E.scream ? 0.5 * this.rpm / 9000 : 0)) * (0.4 + this.load);
      // 2-pole low-pass, opens with load/rpm
      this.lp1 += a * (x - this.lp1); this.lp2 += a * (this.lp1 - this.lp2);
      x = this.lp2;
      // intake / mechanical noise
      x += this.intakeF.run(noise, 1800 + this.rpm * 0.2, 1.5, sr) * 0.04 * (0.2 + this.load) * (this.rpm / 7000);
      // crackle pop
      if (this.popDelay >= 0) { if (this.popDelay-- === 0) this.pop = 0.9 + 0.6 * Math.random(); }
      if (this.pop > 0.001) { x += this.popF.run(noise * this.pop, 1300, 1.2, sr) * 2.2; this.pop *= Math.exp(-1 / (sr * 0.007)); }
      // DC block + soft clip
      this.dc = x - this.dcIn + 0.995 * this.dc; this.dcIn = x;
      ch0[s] = Math.tanh(this.dc * drive) * 0.6;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}

registerProcessor('engine', EngineProcessor);
