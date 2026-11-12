#!/usr/bin/env node
// Renders the README artwork from tools/page/templates into assets/ and docs/screenshots/.
//
//   node tools/page/build.js            all artwork (hero, headings, buttons, panels)
//   node tools/page/build.js shots      frame raw screenshots: tools/page/shots-raw/NN_name.jpg -> docs/screenshots/
//
// Needs Playwright with Chromium (npm i playwright && npx playwright install chromium).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const ASSETS = path.join(REPO, 'assets');
const SHOTS = path.join(REPO, 'docs', 'screenshots');

// [template, output, query]
const HEADINGS = [
  ['overview', 'تعرّف على الترا قرآن', 'Meet Ultra Quran'],
  ['whats-new', 'الجديد', "What's new"],
  ['tour', 'جولة داخل البلجن', 'A tour of the plugin'],
  ['sections', 'أقسام الموسوعة', 'The fifteen sections'],
  ['features', 'المميزات', 'Features'],
  ['compatibility', 'التوافق والمتطلبات', 'Compatibility'],
  ['install', 'التثبيت', 'Installation'],
  ['faq', 'أسئلة شائعة', 'Questions & troubleshooting'],
  ['family', 'عيلة Ultra', 'The Ultra family'],
  ['credits', 'المصادر والحقوق', 'Sources & credits'],
];
const ART = [
  ['hero.html', 'ultraquran-hero.jpg'],
  ['button.html', 'button-install.png', { ar: 'ثبّت الترا قرآن', en: 'Install Ultra Quran' }],
  ['button.html', 'button-releases.png', { ar: 'الإصدارات الرسمية', en: 'Official releases' }],
  ['mosaic.html', 'sections-map.jpg'],
  ['features.html', 'features.jpg'],
  ['steps.html', 'install-steps.jpg'],
  ['family.html', 'family-quran.png', { p: 'quran' }],
  ['family.html', 'family-stalker.png', { p: 'stalker' }],
  ['family.html', 'family-audio.png', { p: 'audio' }],
  ['divider.html', 'divider.png'],
  ['colophon.html', 'colophon.jpg'],
  ...HEADINGS.map(([slug, ar, en]) => ['heading.html', 'heading-' + slug + '.png', { ar, en }]),
];

function sizeOf(html) {
  const m = html.match(/<meta name="size" content="(\d+)x(\d+)">/);
  if (!m) throw new Error('template without <meta name="size">');
  return [+m[1], +m[2]];
}

async function render(page, template, out, query = {}, scale = 2) {
  const file = path.join(HERE, 'templates', template);
  const [w, h] = sizeOf(fs.readFileSync(file, 'utf8'));
  await page.setViewportSize({ width: w, height: h });
  const qs = new URLSearchParams(query).toString();
  await page.goto('file://' + file + (qs ? '?' + qs : ''));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete) && window.READY !== false);
  await page.waitForTimeout(150);
  const jpeg = out.endsWith('.jpg');
  await page.screenshot({ path: out, type: jpeg ? 'jpeg' : 'png', quality: jpeg ? 90 : undefined, omitBackground: !jpeg });
  console.log('  ' + path.relative(REPO, out));
}

(async () => {
  const mode = process.argv[2] || 'art';
  const browser = await chromium.launch();
  if (mode === 'art') {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    for (const [template, out, query] of ART.filter((a) => !process.argv[3] || a[1].includes(process.argv[3]))) await render(page, template, path.join(ASSETS, out), query);
  } else if (mode === 'shots') {
    // frame every raw screenshot; missing ones get a "coming soon" plate whose hash is recorded
    const page = await browser.newPage({ deviceScaleFactor: 1.5 });
    const list = fs.readFileSync(path.join(SHOTS, 'README.md'), 'utf8');
    const rows = [...list.matchAll(/\| `(\d\d_[a-z_]+\.jpg)` \| ([^<|]+)<br>([^|]+?) \|/g)];
    const raw = path.join(HERE, 'shots-raw');
    const pending = [];
    for (const [, name, en, ar] of rows) {
      const src = path.join(raw, name);
      const out = path.join(SHOTS, name);
      const query = { ar: ar.trim(), en: en.trim() };
      if (fs.existsSync(src)) query.src = 'file://' + src;
      await render(page, 'shot.html', out, query, 1);
      if (!query.src) pending.push(crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex') + '  ' + name);
    }
    fs.writeFileSync(path.join(SHOTS, 'PENDING'), pending.join('\n') + (pending.length ? '\n' : ''));
    console.log(pending.length + ' screenshot(s) still pending');
  }
  await browser.close();
})();
