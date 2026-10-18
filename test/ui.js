// Headless UI test: start in sim mode, push gas, check rpm/gear/speed and audio state; screenshots.
const { chromium, webkit, devices } = require('playwright');
(async () => {
  for (const [name, bt] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await bt.launch({ args: name === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
    const page = await browser.newPage({ ...devices['iPhone 13'], hasTouch: false, isMobile: false });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await page.goto('http://127.0.0.1:8765/index.html');
    await page.click('#start');
    await page.waitForTimeout(500);
    const box = await page.locator('#gas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1);
    await page.mouse.down();
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(500);
      samples.push(await page.evaluate(() => `${kmh.textContent}km/h g${gear.textContent} ${rpm.textContent}rpm`));
      if (i === 8) await page.screenshot({ path: `test/shot_${name}.png` });
    }
    await page.mouse.up();
    await page.waitForTimeout(1500);
    samples.push('lift: ' + await page.evaluate(() => `${kmh.textContent}km/h g${gear.textContent} ${rpm.textContent}rpm`));
    const st = await page.evaluate(() => ({ ctx: ctx && ctx.state, node: !!node, status: document.getElementById('status').textContent }));
    console.log(name, JSON.stringify(st), '\n ', samples.join(' | '), '\n  errors:', errs.length ? errs : 'none');
    await browser.close();
  }
})();
