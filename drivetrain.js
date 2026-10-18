// Pure logic (no DOM): auto gearbox, sensor fusion, and a simple car model for the test mode.
// Exposed as globals in the browser and via module.exports in node tests.

const KMH_PER_MS = 3.6;

// per-engine gearing: rpm per km/h in each gear, redline, sim power factor
const SPECS = {
  v12:   { ratios: [112, 80, 61, 49, 41, 35, 30], idle: 950, redline: 9000, power: 2.2 },
  i4:    { ratios: [118, 72, 50, 39, 31, 25], idle: 850, redline: 7000, power: 1.0 },
  v6:    { ratios: [110, 68, 48, 37, 30, 24], idle: 800, redline: 7000, power: 1.3 },
  v8:    { ratios: [100, 64, 46, 36, 29, 23], idle: 750, redline: 7200, power: 1.6 },
  boxer: { ratios: [118, 74, 52, 40, 32, 26], idle: 850, redline: 7500, power: 1.1 },
};

class Gearbox {
  constructor() { this.setEngine('v12'); this.gear = 1; this.shiftUntil = 0; this.lastShift = 0; }
  setEngine(e) {
    const sp = SPECS[e] || SPECS.i4;
    this.ratios = sp.ratios; this.idle = sp.idle; this.redline = sp.redline; this.power = sp.power;
    this.gear = Math.min(this.gear || 1, this.ratios.length);
  }
  // speed km/h, load 0..1, now ms → {rpm, gear, shifting}
  update(kmh, load, now) {
    const r = this.ratios;
    const rpmIn = (g) => kmh * r[g - 1];
    const upAt = 2600 + (this.redline - 3200) * load;          // light throttle shifts early, full throttle near redline
    const downAt = 1200 + 1300 * load;
    if (now - this.lastShift > 700) {
      if (this.gear < r.length && rpmIn(this.gear) > upAt && rpmIn(this.gear + 1) > 1100) {
        this.gear++; this.lastShift = now; this.shiftUntil = now + 180;
      } else if (this.gear > 1 && rpmIn(this.gear) < downAt) {
        this.gear--; this.lastShift = now; this.shiftUntil = now + 220;
      }
    }
    if (kmh < 2) this.gear = 1;
    let rpm = rpmIn(this.gear);
    // pulling away: clutch slip keeps rpm up
    if (this.gear === 1 && kmh < 18) rpm = Math.max(rpm, this.idle + 1700 * load * (1 - kmh / 18) + kmh * 40);
    rpm = Math.max(this.idle, Math.min(rpm, this.redline + 150));
    return { rpm, gear: this.gear, shifting: now < this.shiftUntil };
  }
}

// Fuses phone accelerometer (fast, noisy, unknown orientation) with GPS speed (slow, absolute).
class Fusion {
  constructor() {
    this.g = null;            // gravity estimate (device frame)
    this.fwd = null;          // learned forward axis (unit, device frame, horizontal)
    this.v = 0;               // fused speed m/s
    this.aFwd = 0;            // forward acceleration m/s² (smoothed)
    this.gpsV = null; this.gpsT = 0; this.prevGpsV = null; this.prevGpsT = 0;
    this.hBuf = [];           // recent horizontal accel samples for axis learning
  }
  static sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  static dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  static scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  static norm(a) { return Math.hypot(a[0], a[1], a[2]); }

  // accG = accelerationIncludingGravity; acc = acceleration without gravity (OS gyro fusion, may be null)
  onMotion(accG, acc, dt, now) {
    const F = Fusion;
    let lin;
    if (acc) {
      // OS already separated gravity: use it directly (a plain low-pass would swallow sustained acceleration)
      lin = acc;
      const gNow = F.sub(accG, acc);
      if (!this.g) this.g = gNow;
      const kg = 1 - Math.exp(-dt / 0.3);
      this.g = this.g.map((x, i) => x + (gNow[i] - x) * kg);
    } else {
      if (!this.g) this.g = accG.slice();
      const kg = 1 - Math.exp(-dt / 2.0);
      this.g = this.g.map((x, i) => x + (accG[i] - x) * kg);
      lin = F.sub(accG, this.g);
    }
    const gn = F.norm(this.g) || 9.8;
    const up = F.scale(this.g, 1 / gn);
    const h = F.sub(lin, F.scale(up, F.dot(lin, up))); // horizontal part
    this.hBuf.push({ t: now, h });
    while (this.hBuf.length && now - this.hBuf[0].t > 1500) this.hBuf.shift();
    let a;
    if (this.fwd) a = F.dot(h, this.fwd);
    else {
      // until the axis is learned: magnitude, signed by GPS trend
      const trend = this.gpsTrend();
      a = F.norm(h) * (trend < -0.3 ? -1 : 1);
    }
    const ka = 1 - Math.exp(-dt / 0.12);
    this.aFwd += (a - this.aFwd) * ka;
    // dead-reckon between GPS fixes, pulled back to GPS
    this.v = Math.max(0, this.v + this.aFwd * dt);
    if (this.gpsV !== null) {
      const age = (now - this.gpsT) / 1000;
      const pull = 1 - Math.exp(-dt / (age < 3 ? 0.8 : 0.3));
      this.v += (this.gpsV - this.v) * pull;
    }
    if (this.v < 0.4 && Math.abs(this.aFwd) < 0.3 && (this.gpsV === null || this.gpsV < 0.5)) this.v = 0;
  }

  gpsTrend() {
    if (this.prevGpsV === null || this.gpsV === null) return 0;
    const dt = (this.gpsT - this.prevGpsT) / 1000;
    return dt > 0.2 ? (this.gpsV - this.prevGpsV) / dt : 0;
  }

  // speed m/s (null if unknown), now ms
  onGps(speed, now) {
    if (speed === null || !isFinite(speed)) return;
    this.prevGpsV = this.gpsV; this.prevGpsT = this.gpsT;
    this.gpsV = Math.max(0, speed); this.gpsT = now;
    const trend = this.gpsTrend();
    // learn forward axis while clearly accelerating (or braking) in a straight line
    if (Math.abs(trend) > 0.8 && this.hBuf.length > 10) {
      const F = Fusion;
      let m = [0, 0, 0];
      for (const s of this.hBuf) m = [m[0] + s.h[0], m[1] + s.h[1], m[2] + s.h[2]];
      const n = F.norm(m);
      if (n > 0.3 * this.hBuf.length) {
        const dir = F.scale(m, Math.sign(trend) / n);
        if (!this.fwd) this.fwd = dir;
        else {
          const f = this.fwd.map((x, i) => x * 0.8 + dir[i] * 0.2);
          this.fwd = F.scale(f, 1 / F.norm(f));
        }
      }
    }
  }

  // throttle proxy 0..1 from forward accel at this speed/gear
  load(gear) {
    const kmh = this.v * KMH_PER_MS;
    const aMax = [3.6, 2.8, 2.0, 1.5, 1.1, 0.8, 0.7][gear - 1] || 0.7;
    const cruise = kmh > 15 ? 0.18 : 0.05;            // holding speed still needs some throttle
    if (this.aFwd < -0.35) return 0;                  // lifting off / braking → overrun
    return Math.max(0, Math.min(1, cruise + this.aFwd / aMax));
  }
}

// Test-mode car: throttle slider → speed
class SimCar {
  constructor() { this.v = 0; }
  step(throttle, brake, gear, dt, power = 1) {
    const push = throttle * power * ([4.2, 3.2, 2.3, 1.7, 1.3, 1.0, 0.8][gear - 1] || 0.8);
    const drag = 0.15 + 0.0006 * this.v * this.v + (throttle < 0.02 ? 0.5 : 0) + brake * 7;
    this.v = Math.max(0, this.v + (push - drag) * dt);
    return this.v;
  }
}

if (typeof module !== 'undefined') module.exports = { Gearbox, Fusion, SimCar, SPECS, KMH_PER_MS };
