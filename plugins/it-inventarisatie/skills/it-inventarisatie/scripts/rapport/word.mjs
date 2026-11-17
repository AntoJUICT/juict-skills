#!/usr/bin/env node
// Zet rapport.json om in eenvoudige HTML die Word goed opent (koppen, alinea's, tabellen, pagina-einden).
// Daarna maakt naar-word.ps1 er een .docx van. Dezelfde inhoud als het rapport in Claude Design.
// Gebruik: node word.mjs --rapport <rapport.json> --uit <rapport.html> [--logo <pad naar svg/png>]
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateRapport } from "./schema.mjs";
import { urenTotalen } from "./bouw.mjs";
import { esc, veiligeHtml, NAVY, PINK, MUTED, BORDER, BG } from "./onderdelen.mjs";

const t = veiligeHtml;
const lijst = (v) => (Array.isArray(v) ? v : []);
const uur = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
const isTekst = (v) => typeof v === "string" && v.trim() !== "";

const CSS = `
body { font-family: Arial, sans-serif; font-size: 10.5pt; color: #1a1f36; line-height: 1.4; }
h1 { font-size: 22pt; color: ${NAVY}; margin: 0 0 12pt 0; }
h2 { font-size: 13pt; color: ${NAVY}; margin: 14pt 0 6pt 0; }
.kicker { font-size: 9pt; font-weight: bold; letter-spacing: 1pt; text-transform: uppercase; color: ${PINK}; margin: 0 0 2pt 0; }
.klein { font-size: 9pt; color: ${MUTED}; }
.blok { border: 1pt solid ${BORDER}; background: ${BG}; padding: 6pt 9pt; margin: 8pt 0; }
.besluit { border: 1pt solid #f6c3cf; background: #fff7f9; padding: 6pt 9pt; margin: 8pt 0; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt 0; }
th { text-align: left; color: ${NAVY}; border-bottom: 1.5pt solid ${NAVY}; padding: 3pt 5pt; font-size: 9.5pt; }
td { border-bottom: 0.5pt solid ${BORDER}; padding: 3pt 5pt; vertical-align: top; font-size: 9.5pt; }
.r { text-align: right; }
`;

function tabel(kolommen, rijen, { rechts = [] } = {}) {
  const kop = kolommen.map((k, i) => `<th${rechts.includes(i) ? ' class="r"' : ""}>${t(k)}</th>`).join("");
  const body = rijen.map((r) => `<tr>${r.map((c, i) => `<td${rechts.includes(i) ? ' class="r"' : ""}>${c}</td>`).join("")}</tr>`).join("\n");
  return `<table><thead><tr>${kop}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

const cel = (v) => t(v);
const vet = (v) => `<b>${t(v)}</b>`;

function sectie(kicker, titel, body) {
  // Word neemt page-break-before van een div over op elke alinea erin; daarom een los pagina-einde.
  return `<br clear="all" style="page-break-before: always">\n<p class="kicker">${t(kicker)}</p><h1>${t(titel)}</h1>\n${body}\n`;
}

function blok(b) {
  if (b.type === "h2") return `<h2>${t(b.tekst)}</h2>`;
  if (b.type === "p") return `<p>${t(b.tekst)}</p>`;
  if (b.type === "tabel") return tabel(lijst(b.kolommen), lijst(b.rijen).map((r) => r.map(cel)));
  if (b.type === "kaarten") return lijst(b.items).map((k) => `<div class="blok"><b>${t(k.titel)}</b><br>${t(k.tekst)}</div>`).join("");
  return "";
}

function voorblad(r, logo) {
  const op = r.opsteller ?? {};
  const voor = lijst(r.lezers).map((l) => `${t(l.naam)}, ${t(l.organisatie)}`).join("<br>");
  return `<div>
${logo ? `<p><img src="${esc(logo)}" alt="JUICT" width="140" height="53"></p>` : ""}
<p style="margin-top: 140pt" class="kicker">Inventarisatie, advies en stappenplan</p>
<h1 style="font-size: 30pt">IT-inventarisatie ${t(r.klant)}</h1>
<p style="margin-top: 60pt"><b>Voor</b><br>${voor}</p>
<p><b>Opgesteld door</b><br>${t(op.naam)}, JUICT<br>${t(op.mail)}, ${t(op.telefoon)}<br>${t(r.datum)}</p>
</div>`;
}

function samenvatting(r) {
  const s = r.samenvatting ?? {};
  let b = "";
  if (s.besluit) b += `<div class="besluit"><b>${t(s.besluit.label)}</b><br>${t(s.besluit.tekst)}</div>`;
  b += `<h2>Wat we zagen</h2><p>${t(s.zagen)}</p><h2>Wat we adviseren</h2><p>${t(s.adviseren)}</p>`;
  const kc = lijst(s.kerncijfers);
  if (kc.length) b += `<h2>Kerncijfers</h2>` + tabel(["Onderdeel", "Waarde", "Toelichting"], kc.map((k) => [cel(k.label), vet(k.waarde), cel(k.toelichting)]));
  const st = lijst(s.stappen);
  if (st.length) b += `<h2>De eerstvolgende stappen</h2>` + tabel(["", "Stap", "Wie"], st.map((x, i) => [String(i + 1), cel(x.stap), cel(x.wie)]));
  return sectie("Samenvatting", "Wat we zagen en wat we adviseren", b);
}

function opvalt(r) {
  return sectie("Aandachtspunten", "Wat opvalt",
    tabel(["Punt", "Wat we zien", "Wat we eraan doen"], lijst(r.opvalt).map((o) => [vet(o.punt), cel(o.zien), cel(o.doen)])));
}

function doel(d) {
  let b = isTekst(d.intro) ? `<p>${t(d.intro)}</p>` : "";
  const pr = lijst(d.principes);
  if (pr.length) b += `<h2>Uitgangspunten</h2>` + tabel(["", "Principe", "Wat het betekent"], pr.map((x, i) => [String(i + 1), vet(x.titel), cel(x.tekst)]));
  b += lijst(d.kaarten).map((k) => `<div class="blok"><b>${t(k.titel)}</b><br>${t(k.tekst)}</div>`).join("");
  return sectie("Advies", "De doelinrichting", b);
}

function stappenplan(sp) {
  const m = lijst(sp.maanden);
  const periode = (f) => {
    if (f.pm) return "doorlopend";
    const van = m[f.start], tot = m[Math.max(f.start, f.eind - 1)];
    if (van === undefined) return "";
    return van === tot || tot === undefined ? van : `${van} tot en met ${tot}`;
  };
  let b = tabel(["Fase", "Wat", "Periode"], lijst(sp.fases).map((f) => [vet(f.code), `<b>${t(f.naam)}</b><br>${t(f.omschrijving)}`, cel(periode(f))]));
  if (isTekst(sp.toelichting)) b += `<p>${t(sp.toelichting)}</p>`;
  return sectie("Stappenplan", "Zo pakken we het aan", b);
}

function uren(u) {
  let b = "";
  for (const blk of lijst(u.blokken)) {
    const fases = lijst(blk.fases);
    const rijen = fases.map((f) => [cel(f.fase), vet(f.resultaat), `<span class="klein">${t(f.rekenbasis)}</span>`, uur(f.uren)]);
    rijen.push(["", "<b>Subtotaal</b>", "", `<b>${uur(fases.reduce((s, f) => s + f.uren, 0))}</b>`]);
    b += `<h2>${t(blk.titel)} (${blk.soort === "keuze" ? "keuze, kan later" : "nodig"})</h2>` +
      tabel(["Fase", "Wat jullie daarna hebben", "Rekenbasis", "Uren"], rijen, { rechts: [3] });
  }
  const tot = urenTotalen(u);
  const heeftKeuze = lijst(u.blokken).some((x) => x.soort === "keuze");
  b += `<div class="blok">Projectmanagement, ongeveer ${uur(tot.pct)}%: ${uur(tot.pm)} uur. <b>Totaal: ${uur(tot.totaal)} uur.</b>`;
  if (heeftKeuze) b += `<br>Alleen de onderdelen die nodig zijn, met projectmanagement: ongeveer ${uur(tot.alleenNodig)} uur.`;
  const ni = lijst(u.nietInbegrepen);
  if (ni.length) b += `<br>Niet in deze uren: ${ni.map(t).join(", ")}.`;
  b += `</div>`;
  const toel = lijst(u.toelichting);
  if (toel.length) b += `<h2>Zo komen we tot deze uren</h2><p>${toel.map(t).join(" ")}</p>`;
  return sectie("Urenindicatie", "Uren per fase", b);
}

function openVragen(vragen) {
  const b = `<p>Met deze antwoorden maken we de planning definitief. Een kort antwoord per mail is genoeg.</p>` +
    vragen.map((v) => `<h2>${t(v.aan)}${isTekst(v.rol) ? ` <span class="klein">${t(v.rol)}</span>` : ""}</h2><ol>${lijst(v.vragen).map((x) => `<li>${t(x)}</li>`).join("")}</ol>`).join("");
  return sectie("Open vragen", "Wat we nog van jullie nodig hebben", b);
}

function bijlage(bij) {
  return lijst(bij.secties).map((sec, i) => {
    const jaNee = sec.kolom5 === "ja/nee";
    const opties = jaNee ? ["ja", "nee"] : lijst(sec.kolom5);
    const vakjes = opties.map((o) => `&#9744; ${t(o)}`).join("<br>");
    const rijen = lijst(sec.rijen).map((x) => [vet(x.naam), `<span class="klein">${t(x.adres)}</span>`, cel(x.licentie), cel(x.voorstel), isTekst(x.antwoord) ? vet(x.antwoord) : vakjes]);
    const intro = i === 0 && isTekst(bij.intro) ? `<p>${t(bij.intro)}</p>` : "";
    return sectie(`Bijlage, deel ${i + 1}`, sec.nogOpen ? `${sec.titel}, nog niet beantwoord` : sec.titel,
      intro + tabel(["Naam", "Adres", "Licentie", "Voorstel", jaNee ? "Nog nodig?" : "Keuze"], rijen));
  }).join("\n");
}

export function wordHtml(r, { logo } = {}) {
  const delen = [voorblad(r, logo), samenvatting(r)];
  lijst(r.stand).forEach((s) => delen.push(sectie(s.kicker, s.titel, lijst(s.blokken).map(blok).join("\n"))));
  if (lijst(r.opvalt).length) delen.push(opvalt(r));
  if (r.doel && (isTekst(r.doel.intro) || lijst(r.doel.principes).length)) delen.push(doel(r.doel));
  if (r.stappenplan && lijst(r.stappenplan.fases).length) delen.push(stappenplan(r.stappenplan));
  if (r.uren && lijst(r.uren.blokken).length) delen.push(uren(r.uren));
  if (lijst(r.openVragen).length) delen.push(openVragen(r.openVragen));
  if (lijst(r.bijlage?.secties).length) delen.push(bijlage(r.bijlage));
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>IT-inventarisatie ${esc(r.klant)}</title>
<style>${CSS}</style></head>
<body>
${delen.join("\n")}
</body></html>
`;
}

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
  const pad = optie(argv, "--rapport"), uit = optie(argv, "--uit");
  if (!pad || !uit) {
    console.error("Gebruik: node word.mjs --rapport <rapport.json> --uit <rapport.html> [--logo <pad>]");
    return 2;
  }
  const r = JSON.parse(readFileSync(pad, "utf8"));
  const fouten = validateRapport(r);
  if (fouten.length) {
    console.error(fouten.join("\n"));
    return 1;
  }
  const logo = optie(argv, "--logo");
  writeFileSync(uit, wordHtml(r, { logo: logo ? pathToFileURL(logo).href : undefined }), "utf8");
  console.log(`Geschreven: ${uit}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
