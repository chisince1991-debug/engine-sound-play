// Synthetic drive: phone mounted tilted; accelerate 0→80 km/h, cruise, coast, brake. GPS 1 Hz.
const { Gearbox, Fusion, KMH_PER_MS } = require('../drivetrain.js');
const fu = new Fusion(), gb = new Gearbox();
// device frame: gravity mostly -y and some -z (phone tilted back); forward = device -z rotated
const g = [0, 9.81 * Math.cos(0.5), 9.81 * Math.sin(0.5)];
const fwdDev = [0, -Math.sin(0.5), Math.cos(0.5)]; // perpendicular to g
let v = 0, t = 0; const dt = 1 / 60; let lastGps = -1; const log = [];
const aProfile = (t) => t < 12 ? 2.0 : t < 20 ? 0 : t < 26 ? -0.6 : t < 30 ? -3 : 0;
while (t < 32) {
  const a = v <= 0 && aProfile(t) < 0 ? 0 : aProfile(t);
  v = Math.max(0, v + a * dt);
  const noise = () => (Math.random() - 0.5) * 0.6;
  const acc = g.map((x, i) => x + fwdDev[i] * a + noise());
  const now = t * 1000;
  const lin = fwdDev.map((x) => x * a + noise());
  fu.onMotion(acc, process.argv[2] === 'nogyro' ? null : lin, dt, now);
  if (Math.floor(t) !== lastGps) { lastGps = Math.floor(t); fu.onGps(v + (Math.random() - 0.5) * 0.3, now + 0); }
  const st = gb.update(fu.v * KMH_PER_MS, fu.load(gb.gear), now);
  if (Math.abs(t * 2 - Math.round(t * 2)) < dt) log.push(`${t.toFixed(1)}s true ${(v*3.6).toFixed(0)} fused ${(fu.v*3.6).toFixed(0)} km/h a=${fu.aFwd.toFixed(2)} load=${fu.load(gb.gear).toFixed(2)} g${st.gear} ${st.rpm.toFixed(0)}rpm axis=${fu.fwd ? 'learned' : '-'}`);
  t += dt;
}
console.log(log.join('\n'));
