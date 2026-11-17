// Meet met een headless browser of de inhoud van elke pagina boven de footer past,
// en splitst te lange tabellen over vervolgpagina's.
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

// Chrome gaat voor Edge: een beheerde Edge (met SSO-beleid) blijft headless hangen zonder uitvoer.
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

// Afstand die de inhoud minstens boven de footer moet eindigen.
export const MARGE = 12;

// IT_INVENTARISATIE_BROWSER wint als die naar een bestaand bestand wijst.
export function browserPad() {
  const env = process.env.IT_INVENTARISATIE_BROWSER;
  if (env && existsSync(env)) return env;
  for (const b of BROWSERS) if (existsSync(b)) return b;
  return null;
}

// Schrijft na het laden (en na de fonts) "content=<px> footer=<px> tabel=<px>" in <pre id="RESULT">.
// tabel is de hoogte van de laatste tabel in de inhoud, 0 als er geen is.
const MEETSCRIPT = `<script>
window.addEventListener('load', () => setTimeout(() => {
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    const i = document.querySelector('[data-rol="inhoud"]');
    const v = document.querySelector('[data-rol="voet"]');
    let r = 'geen';
    if (i && v) {
      const ts = i.querySelectorAll('table');
      const t = ts.length ? Math.round(ts[ts.length - 1].getBoundingClientRect().height) : 0;
      r = 'content=' + Math.round(i.getBoundingClientRect().bottom) + ' footer=' + Math.round(v.getBoundingClientRect().top) + ' tabel=' + t;
    }
    document.getElementById('RESULT').textContent = r;
  });
}, 800));
</script>`;

export function meetHtml(paginaHtml) {
  const begin = paginaHtml.indexOf("<x-dc>");
  const eind = paginaHtml.lastIndexOf("</x-dc>");
  if (begin < 0 || eind < begin) throw new Error("pagina heeft geen <x-dc>-blok");
  const inner = paginaHtml.slice(begin + "<x-dc>".length, eind)
    .replace(/<\/?helmet>/g, "")
    .replace(/src="\/_blob[^"]*"/g, 'src=""');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${inner}<pre id="RESULT"></pre>${MEETSCRIPT}</body></html>`;
}

function draai(browser, args) {
  return new Promise((resolve, reject) => {
    execFile(browser, args, { encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (fout, stdout) => {
      if (fout && !stdout) reject(fout);
      else resolve(stdout);
    });
  });
}

// paginas: [{ bestand, html }]. Geeft per pagina { bestand, inhoud, footer, tabel, over }.
// Pagina's zonder inhoud of footer (het voorblad) krijgen inhoud en footer null en over false.
export async function meet(paginas, browser, { tegelijk = 4 } = {}) {
  if (!browser) throw new Error("geen browser gevonden om te meten");
  const map = mkdtempSync(join(tmpdir(), "it-inv-meet-"));
  try {
    const uitkomst = new Array(paginas.length);
    let volgende = 0;
    const werker = async () => {
      while (volgende < paginas.length) {
        const n = volgende++;
        const { bestand, html } = paginas[n];
        const pad = join(map, `${n}.html`);
        writeFileSync(pad, meetHtml(html), "utf8");
        const dom = await draai(browser, [
          "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
          `--user-data-dir=${join(map, `profiel-${n}`)}`,
          "--window-size=794,1123", "--virtual-time-budget=4000", "--dump-dom", pathToFileURL(pad).href,
        ]);
        const res = dom.match(/<pre id="RESULT">([^<]*)<\/pre>/);
        if (!res || !res[1]) throw new Error(`meting van ${bestand} gaf geen resultaat; probeer een andere browser via IT_INVENTARISATIE_BROWSER`);
        const m = res[1].match(/content=(-?\d+) footer=(-?\d+) tabel=(\d+)/);
        uitkomst[n] = m
          ? { bestand, inhoud: Number(m[1]), footer: Number(m[2]), tabel: Number(m[3]), over: Number(m[1]) > Number(m[2]) - MARGE }
          : { bestand, inhoud: null, footer: null, tabel: 0, over: false };
      }
    };
    await Promise.all(Array.from({ length: Math.min(tegelijk, paginas.length) }, werker));
    return uitkomst;
  } finally {
    // Browser-hulpprocessen houden soms nog even bestanden in het profiel vast.
    try {
      rmSync(map, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      // een achtergebleven tijdelijke map is geen reden om de meting te laten mislukken
    }
  }
}

// Verplaatst de laatste aantalRijen rijen van de laatste tabel, plus alle blokken erna, naar een vervolg.
// Geeft null als er geen tabel is. De invoer blijft ongewijzigd.
export function splitsTabel(blokken, aantalRijen) {
  let idx = -1;
  blokken.forEach((b, i) => { if (b && b.type === "tabel") idx = i; });
  if (idx < 0) return null;
  const tab = blokken[idx];
  const grens = tab.rijen.length - aantalRijen;
  return {
    hier: [...blokken.slice(0, idx), { ...tab, rijen: tab.rijen.slice(0, grens) }],
    vervolg: [{ ...tab, rijen: tab.rijen.slice(grens) }, ...blokken.slice(idx + 1)],
  };
}
