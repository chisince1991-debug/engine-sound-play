# 引擎聲（自己玩版）

Phone web page that synthesises a combustion-engine sound from the phone's own sensors (accelerometer for throttle, GPS for speed), for playing through the car over Bluetooth.

- `index.html` — UI, sensors, test mode (on-screen pedals)
- `drivetrain.js` — auto gearbox, sensor fusion, test-mode car model (pure, node-testable)
- `worklet.js` — AudioWorklet engine synthesis (V12 / I4 / V6 / V8 / boxer)
- `test/render.js <engine>` offline-renders an rpm sweep to WAV; `test/drive.js` runs a synthetic drive; `test/ui.js` drives the page in headless Chromium/WebKit.

Do not use the phone while driving. Engine sounds are synthesised, not recordings.
