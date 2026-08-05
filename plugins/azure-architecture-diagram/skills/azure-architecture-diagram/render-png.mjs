// SVG naar PNG, voor Word-documenten en wiki's die geen SVG lusten.
// Gebruik: node render-png.mjs diagram.svg diagram.png [breedte] [hoogte]
//
// Playwright hoeft niet in de huidige map te staan: dit script zoekt het in de
// cwd, in de bovenliggende mappen, en als laatste globaal.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

const [svg, png, w = '1680', h = '1320'] = process.argv.slice(2);
if (!svg || !png) {
  console.error('gebruik: node render-png.mjs <in.svg> <uit.png> [breedte] [hoogte]');
  process.exit(1);
}

function findPlaywright() {
  if (process.env.PLAYWRIGHT_ENTRY && existsSync(process.env.PLAYWRIGHT_ENTRY)) {
    return process.env.PLAYWRIGHT_ENTRY;
  }
  let dir = process.cwd();
  for (;;) {
    const p = join(dir, 'node_modules', 'playwright', 'index.js');
    if (existsSync(p)) return p;
    // Monorepo: playwright zit vaak in een subproject (portal/, apps/web/, ...)
    // en niet in de root. Eén niveau diep meekijken.
    try {
      for (const sub of readdirSync(dir, { withFileTypes: true })) {
        if (!sub.isDirectory() || sub.name === 'node_modules' || sub.name.startsWith('.')) continue;
        const q = join(dir, sub.name, 'node_modules', 'playwright', 'index.js');
        if (existsSync(q)) return q;
      }
    } catch {
      /* map niet leesbaar, ga omhoog */
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const p = join(root, 'playwright', 'index.js');
    if (existsSync(p)) return p;
  } catch {
    /* npm niet beschikbaar, val door naar de foutmelding */
  }
  return null;
}

const entry = findPlaywright();
if (!entry) {
  console.error('Playwright niet gevonden. Installeer met: npm i -D playwright');
  console.error('Of laat de PNG-stap weg: de SVG is het primaire exportformaat.');
  process.exit(1);
}

const pw = await import(pathToFileURL(entry).href);
const { chromium } = pw.default ?? pw;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
});
// De SVG in een HTML-wrapper zetten: een los SVG-document laat Chromium hangen
// op "waiting for fonts to load".
await page.setContent(`<body style="margin:0">${readFileSync(resolve(svg), 'utf8')}</body>`, {
  waitUntil: 'load',
});
await page.screenshot({
  path: resolve(png),
  clip: { x: 0, y: 0, width: Number(w), height: Number(h) },
});
await browser.close();
console.log('png:', png);
