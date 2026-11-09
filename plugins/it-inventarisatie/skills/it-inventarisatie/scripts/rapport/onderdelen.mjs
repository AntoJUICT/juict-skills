// Bouwstenen voor de artboards van het rapport (A4, 794 x 1123 px) in Claude Design.
// Tekst uit het rapport gaat door veiligeHtml(): alles wordt ge-escaped, alleen <b> en <br> blijven staan.
// Functies die "html" aannemen (kaart, raster, pagina-body) krijgen al opgebouwde HTML uit deze module.

export const W = 794;
export const H = 1123;
export const NAVY = "#002345";
export const PINK = "#ff3862";
export const TEXT = "#1a1f36";
export const MUTED = "#5d6577";
export const BORDER = "#d5dae3";
export const BG = "#f4f6fb";
export const GRAD = "linear-gradient(25deg, #002345 25%, #b33259 50%, #ff3862 75%)";
const FONT = "'Libre Franklin', Arial, sans-serif";

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Escape alles en zet daarna alleen kale <b>, </b> en <br> (ook <br/> en <br />) terug.
export function veiligeHtml(s) {
  return esc(s).replace(/&lt;(\/?)b&gt;/gi, "<$1b>").replace(/&lt;br\s*\/?&gt;/gi, "<br>");
}

// Markeert een string als al opgebouwde HTML, zodat tabel(), h2() en p() hem niet escapen.
class Html { constructor(s) { this.s = s; } toString() { return this.s; } }
export const html = (s) => new Html(s);
const inhoud = (x) => (x instanceof Html ? x.s : veiligeHtml(x));

const HELMET = `<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;600;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;background:#ffffff}
a{color:${NAVY}}a:hover{color:${PINK}}
</style>
</helmet>`;

export const ROOT_STYLE_PAGINA =
  `width: ${W}px; height: ${H}px; box-sizing: border-box; position: relative; overflow: hidden; ` +
  `background: #ffffff; font-family: ${FONT}; color: ${TEXT}; ` +
  `padding: 40px 64px 40px 64px; display: flex; flex-direction: column; gap: 0px`;

export const ROOT_STYLE_VOORBLAD =
  `width: ${W}px; height: ${H}px; box-sizing: border-box; position: relative; overflow: hidden; font-family: ${FONT}`;

export function doc(titel, inner, rootStyle) {
  const props = JSON.stringify({ $preview: { width: W, height: H } });
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>${esc(titel)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
${HELMET}
<div style="${rootStyle}">
${inner}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='${props}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
}

// Een inhoudspagina met header (logo + lopende titel), kicker, h1, body en footer.
// opties: { logo, lopendeTitel, datum }
export function pagina(nr, kicker, titel, body, { logo, lopendeTitel, datum }) {
  const kop = `<div style="display: flex; align-items: center; justify-content: space-between; height: 28px; padding-bottom: 14px; border-bottom: 1px solid ${BORDER}">
<img src="${esc(logo)}" alt="JUICT" style="height: 24px; width: auto">
<div style="font-size: 12px; color: ${MUTED}">${esc(lopendeTitel)}</div>
</div>`;
  const t = `<div style="margin-top: 24px; display: flex; flex-direction: column; gap: 4px">
<div style="font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${PINK}">${inhoud(kicker)}</div>
<h1 style="margin: 0; font-size: 30px; line-height: 1.15; font-weight: 700; color: ${NAVY}; text-wrap: balance">${inhoud(titel)}</h1>
</div>`;
  const voet = `<div data-rol="voet" style="position: absolute; left: 64px; right: 64px; bottom: 32px; display: flex; justify-content: space-between; font-size: 12px; color: ${MUTED}; border-top: 1px solid ${BORDER}; padding-top: 10px">
<div>JUICT, ${esc(datum)}</div>
<div>${nr}</div>
</div>`;
  const romp = `<div data-rol="inhoud" style="margin-top: 16px; display: flex; flex-direction: column; gap: 11px; font-size: 13.5px; line-height: 1.5">${body}</div>`;
  return kop + t + romp + voet;
}

export function h2(t) {
  return `<h2 style="margin: 6px 0 0 0; font-size: 17px; line-height: 1.3; font-weight: 700; color: ${NAVY}">${inhoud(t)}</h2>`;
}

export function p(t, extra = "") {
  return `<p style="margin: 0; text-wrap: pretty${extra}">${inhoud(t)}</p>`;
}

// kolommen: string[]; rijen: (string | html())[][]
// opties: breedtes (css-breedtes per kolom), fs (lettergrootte), uitlijning (per kolom), vast (table-layout: fixed)
export function tabel(kolommen, rijen, { breedtes, fs = 13, uitlijning, vast = false } = {}) {
  const al = (i) => (uitlijning ? uitlijning[i] : "left");
  const th = kolommen
    .map((k, i) => `<th style="text-align: ${al(i)}; padding: 5px 8px; font-weight: 700; color: ${NAVY}; border-bottom: 2px solid ${NAVY}${breedtes ? `; width: ${breedtes[i]}` : ""}">${inhoud(k)}</th>`)
    .join("");
  const trs = rijen
    .map((r) => `<tr>${r.map((c, i) => `<td style="text-align: ${al(i)}; padding: 4px 8px; border-bottom: 1px solid ${BORDER}; vertical-align: top">${inhoud(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table style="width: 100%;${vast ? " table-layout: fixed;" : ""} border-collapse: collapse; font-size: ${fs}px; line-height: 1.45"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// inner is HTML.
export function kaart(inner, { bg = "#ffffff", rand = BORDER, extra = "" } = {}) {
  return `<div style="border: 1px solid ${rand}; background: ${bg}; border-radius: 15px; padding: 12px 16px; display: flex; flex-direction: column; gap: 6px${extra}">${inner}</div>`;
}

const LABELS = {
  besluit: "background: #ffe1e8; color: #9b1235",
  voorlopig: "background: #fff1d6; color: #7a4b00",
  info: `background: #e6f0fa; color: ${NAVY}`,
  ok: "background: #e3f4e6; color: #1d5e2a",
};

export function label(tekst, soort = "info") {
  return `<span style="display: inline-block; ${LABELS[soort] ?? LABELS.info}; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 50px; white-space: nowrap">${inhoud(tekst)}</span>`;
}

// items zijn HTML.
export function raster(n, items, gap = 12) {
  return `<div style="display: grid; grid-template-columns: repeat(${n}, minmax(0, 1fr)); gap: ${gap}px">${items.join("")}</div>`;
}

// Lege aankruisvakjes met een label erachter, bijvoorbeeld ["ja", "nee"].
export function vakjes(opties) {
  const vak = (o) =>
    `<span style="display: inline-flex; align-items: center; gap: 4px; margin-right: 8px; white-space: nowrap"><span style="display: inline-block; width: 11px; height: 11px; border: 1.5px solid ${MUTED}; border-radius: 3px"></span>${inhoud(o)}</span>`;
  return `<span style="color: ${MUTED}">${opties.map(vak).join("")}</span>`;
}

// maanden: string[]; fases: { code, naam, omschrijving, start, eind, pm? }[]
// start en eind zijn indexen in maanden (eind exclusief). Een pm-fase loopt over de hele periode.
export function tijdlijn(maanden, fases) {
  const LBL = 250;
  const n = maanden.length;
  const kolommen = `grid-template-columns: ${LBL}px repeat(${n}, minmax(0, 1fr))`;
  const kop = `<div style="display: grid; ${kolommen}; gap: 0px; font-size: 12px; font-weight: 700; color: ${NAVY}; border-bottom: 2px solid ${NAVY}; padding-bottom: 6px"><div>Fase</div>${maanden.map((m) => `<div style="text-align: center">${inhoud(m)}</div>`).join("")}</div>`;
  const rijen = fases
    .map((f) => {
      const balk = f.pm
        ? `<div style="grid-column: 2 / ${n + 2}; display: flex; align-items: center; justify-content: center; border: 2px dashed ${MUTED}; border-radius: 50px; height: 22px; box-sizing: border-box; font-size: 12px; color: ${MUTED}">loopt door het hele project</div>`
        : `<div style="grid-column: ${f.start + 2} / ${f.eind + 2}; background: ${NAVY}; border-radius: 50px; height: 22px"></div>`;
      return `<div style="display: grid; ${kolommen}; align-items: center; padding: 5px 0; border-bottom: 1px solid ${BORDER}">` +
        `<div style="grid-column: 1; display: flex; flex-direction: column; gap: 2px; padding-right: 12px"><div style="font-size: 13px; font-weight: 700; color: ${NAVY}">${inhoud(f.code)}. ${inhoud(f.naam)}</div><div style="font-size: 12px; color: ${MUTED}; line-height: 1.4">${inhoud(f.omschrijving)}</div></div>${balk}</div>`;
    })
    .join("");
  return `<div style="display: flex; flex-direction: column">${kop}${rijen}</div>`;
}
