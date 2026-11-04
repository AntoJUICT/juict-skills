#!/usr/bin/env node
// Bouwt de artboards van het rapport voor Claude Design uit rapport.json.
// Gebruik: node bouw.mjs --rapport <pad> --uit <map> --logo-pos <url> --logo-dia <url>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateRapport } from "./schema.mjs";
import {
  W, H, NAVY, PINK, MUTED, BG, GRAD, ROOT_STYLE_PAGINA, ROOT_STYLE_VOORBLAD,
  esc, veiligeHtml, html, doc, pagina, h2, p, tabel, kaart, label, raster, vakjes, tijdlijn,
} from "./onderdelen.mjs";

const t = veiligeHtml;
const som = (fases) => fases.reduce((s, f) => s + f.uren, 0);
const uur = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
const lijst = (v) => (Array.isArray(v) ? v : []);

function voorblad(r, logoDia) {
  const voor = lijst(r.lezers).map((l) => `${t(l.naam)}, ${t(l.organisatie)}`).join("<br>");
  const op = r.opsteller ?? {};
  return `<div style="position: absolute; inset: 0; background: ${GRAD}"></div>
<div style="position: absolute; left: 64px; top: 64px"><img src="${esc(logoDia)}" alt="JUICT" style="height: 46px; width: auto"></div>
<div style="position: absolute; left: 64px; right: 64px; top: 380px; display: flex; flex-direction: column; gap: 20px; color: #ffffff">
<div style="font-size: 14px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase">Inventarisatie, advies en stappenplan</div>
<h1 style="margin: 0; font-size: 52px; line-height: 1.08; font-weight: 700; text-wrap: balance">IT-inventarisatie ${t(r.klant)}</h1>
</div>
<div style="position: absolute; left: 64px; right: 64px; bottom: 64px; display: flex; justify-content: space-between; align-items: flex-end; color: #ffffff; font-size: 14px; line-height: 1.6">
<div><b>Voor</b><br>${voor}</div>
<div style="text-align: right"><b>Opgesteld door</b><br>${t(op.naam)}, JUICT<br>${t(op.mail)}, ${t(op.telefoon)}<br>${t(r.datum)}</div>
</div>`;
}

function samenvatting(r) {
  const s = r.samenvatting ?? {};
  let body = "";
  if (s.besluit) {
    body += kaart(`<div style="display: flex; gap: 10px; align-items: center">${label(s.besluit.label, "besluit")}</div>` + p(s.besluit.tekst), { bg: "#fff7f9", rand: "#f6c3cf" });
  }
  body += h2("Wat we zagen") + p(s.zagen) + h2("Wat we adviseren") + p(s.adviseren);
  const kc = lijst(s.kerncijfers);
  if (kc.length) {
    body += raster(Math.min(kc.length, 4), kc.map((k) => kaart(
      `<div style="font-size: 12px; color: ${MUTED}">${t(k.label)}</div>` +
      `<div style="font-size: 22px; line-height: 1.15; font-weight: 700; color: ${NAVY}">${t(k.waarde)}</div>` +
      `<div style="font-size: 12px; color: ${MUTED}; line-height: 1.4">${t(k.toelichting)}</div>`, { extra: "; gap: 2px" })));
  }
  const st = lijst(s.stappen);
  if (st.length) {
    body += h2("De eerstvolgende stappen") +
      tabel(["", "Stap", "Wie"], st.map((x, i) => [String(i + 1), x.stap, x.wie]), { breedtes: ["26px", "auto", "150px"] });
  }
  return { naam: "Samenvatting", titel: "Samenvatting", kicker: "Samenvatting", h1: "Wat we zagen en wat we adviseren", body };
}

function blok(b) {
  if (b.type === "h2") return h2(b.tekst);
  if (b.type === "p") return p(b.tekst);
  if (b.type === "tabel") return tabel(b.kolommen, b.rijen, { breedtes: b.breedtes });
  if (b.type === "kaarten") {
    return raster(Math.min(b.items.length, 3), b.items.map((k) =>
      kaart(`<div style="font-weight: 700; color: ${NAVY}">${t(k.titel)}</div><div style="font-size: 13px">${t(k.tekst)}</div>`)));
  }
  return "";
}

function opvalt(r) {
  const rijen = lijst(r.opvalt).map((o) => [html(`<b>${t(o.punt)}</b>`), o.zien, o.doen]);
  const body = tabel(["Punt", "Wat we zien", "Wat we eraan doen"], rijen, { breedtes: ["170px", "auto", "220px"] });
  return { naam: "Wat-opvalt", titel: "Wat opvalt", kicker: "Aandachtspunten", h1: "Wat opvalt", body };
}

function doelinrichting(d) {
  let body = p(d.intro);
  const pr = lijst(d.principes);
  if (pr.length) {
    body += h2("Uitgangspunten") +
      tabel(["", "Principe", "Wat het betekent"], pr.map((x, i) => [String(i + 1), html(`<b>${t(x.titel)}</b>`), x.tekst]), { breedtes: ["26px", "200px", "auto"] });
  }
  const ka = lijst(d.kaarten);
  if (ka.length) {
    body += raster(Math.min(ka.length, 3), ka.map((k) =>
      kaart(`<div style="font-weight: 700; color: ${NAVY}">${t(k.titel)}</div><div style="font-size: 13px">${t(k.tekst)}</div>`)));
  }
  return { naam: "Doelinrichting", titel: "Doelinrichting", kicker: "Advies", h1: "De doelinrichting", body };
}

function stappenplan(sp) {
  let body = tijdlijn(lijst(sp.maanden), lijst(sp.fases));
  if (sp.toelichting) body += p(sp.toelichting);
  return { naam: "Stappenplan", titel: "Stappenplan", kicker: "Stappenplan", h1: "Zo pakken we het aan", body };
}

export function urenTotalen(u) {
  const blokken = lijst(u.blokken);
  const pct = typeof u.projectmanagementPct === "number" ? u.projectmanagementPct : 0;
  const projectUren = som(blokken.flatMap((b) => lijst(b.fases)));
  const nodig = som(blokken.filter((b) => b.soort === "nodig").flatMap((b) => lijst(b.fases)));
  const pm = Math.round((projectUren * pct) / 100);
  return { pct, projectUren, pm, totaal: projectUren + pm, alleenNodig: nodig + Math.round((nodig * pct) / 100) };
}

function uren(u) {
  const blokken = lijst(u.blokken);
  const kol = ["Fase", "Wat jullie daarna hebben", "Rekenbasis", "Uren"];
  const opties = { breedtes: ["150px", "200px", "auto", "50px"], fs: 12, uitlijning: ["left", "left", "left", "right"], vast: true };
  let body = "";
  for (const b of blokken) {
    const fases = lijst(b.fases);
    const rijen = fases.map((f) => [f.fase, html(`<b>${t(f.resultaat)}</b>`), html(`<span style="color: ${MUTED}">${t(f.rekenbasis)}</span>`), uur(f.uren)]);
    rijen.push(["", html("<b>Subtotaal</b>"), "", html(`<b>${uur(som(fases))}</b>`)]);
    body += h2(`${b.titel} (${b.soort === "keuze" ? "keuze, kan later" : "nodig"})`) + tabel(kol, rijen, opties);
  }
  const tot = urenTotalen(u);
  const heeftKeuze = blokken.some((b) => b.soort === "keuze");
  const ni = lijst(u.nietInbegrepen);
  let regel = heeftKeuze ? `Alleen de onderdelen die nodig zijn, met projectmanagement: ongeveer ${uur(tot.alleenNodig)} uur.` : "";
  if (ni.length) regel += `${regel ? " " : ""}Niet in deze uren: ${ni.map(t).join(", ")}.`;
  body += kaart(
    `<div style="display: flex; justify-content: space-between; gap: 16px; font-size: 13px"><div>Projectmanagement, ongeveer ${uur(tot.pct)}%: ${uur(tot.pm)} uur</div><div><b>Totaal: ${uur(tot.totaal)} uur</b></div></div>` +
    (regel ? `<div style="font-size: 13px">${regel}</div>` : ""), { bg: BG });
  const toel = lijst(u.toelichting);
  if (toel.length) {
    body += kaart(`<div style="font-weight: 700; color: ${NAVY}">Zo komen we tot deze uren</div><div style="font-size: 13px">${toel.map(t).join(" ")}</div>`);
  }
  return { naam: "Uren", titel: "Uren", kicker: "Urenindicatie", h1: "Uren per fase", body };
}

function openVragen(vragen) {
  const kaartVoor = (v) => {
    const li = lijst(v.vragen).map((x, i) => `<div style="display: flex; gap: 10px; font-size: 13px; line-height: 1.5"><div style="width: 18px; flex-shrink: 0; color: ${PINK}; font-weight: 700">${i + 1}</div><div>${t(x)}</div></div>`).join("");
    return kaart(`<div style="display: flex; align-items: baseline; gap: 10px"><div style="font-size: 16px; font-weight: 700; color: ${NAVY}">${t(v.aan)}</div><div style="font-size: 12px; color: ${MUTED}">${t(v.rol)}</div></div>` + li);
  };
  const body = p("Met deze antwoorden maken we de planning definitief. Een kort antwoord per mail is genoeg.") + vragen.map(kaartVoor).join("");
  return { naam: "Open-vragen", titel: "Open vragen", kicker: "Open vragen", h1: "Wat we nog van jullie nodig hebben", body };
}

function bijlageSectie(sec, i, intro) {
  const jaNee = sec.kolom5 === "ja/nee";
  const opties = jaNee ? ["ja", "nee"] : lijst(sec.kolom5);
  const rijen = lijst(sec.rijen).map((x) => [
    x.naam,
    html(`<span style="color: ${MUTED}; overflow-wrap: anywhere">${t(x.adres)}</span>`),
    x.licentie,
    x.voorstel,
    html(vakjes(opties)),
  ]);
  const body = (i === 0 && intro ? p(intro, "; font-size: 13px") : "") +
    tabel(["Naam", "Adres", "Licentie", "Voorstel", jaNee ? "Nog nodig?" : "Keuze"], rijen,
      { breedtes: ["118px", "150px", "100px", "160px", "auto"], fs: 12, vast: true });
  return { naam: `Bijlage-${i + 1}`, titel: `Bijlage ${sec.titel}`, kicker: `Bijlage, deel ${i + 1}`, h1: sec.titel, body };
}

export function bouwPaginas(r, { logoPos, logoDia }) {
  const delen = [samenvatting(r)];
  lijst(r.stand).forEach((s, i) => delen.push({ naam: `Stand-${i + 1}`, titel: s.titel, kicker: s.kicker, h1: s.titel, body: lijst(s.blokken).map(blok).join("") }));
  if (lijst(r.opvalt).length) delen.push(opvalt(r));
  if (r.doel && (r.doel.intro || lijst(r.doel.principes).length)) delen.push(doelinrichting(r.doel));
  if (r.stappenplan && lijst(r.stappenplan.fases).length) delen.push(stappenplan(r.stappenplan));
  if (r.uren && lijst(r.uren.blokken).length) delen.push(uren(r.uren));
  if (lijst(r.openVragen).length) delen.push(openVragen(r.openVragen));
  const secties = lijst(r.bijlage?.secties);
  secties.forEach((sec, i) => delen.push(bijlageSectie(sec, i, r.bijlage.intro)));

  const opties = { logo: logoPos, lopendeTitel: `IT-inventarisatie ${r.klant}`, datum: r.datum };
  const paginas = [{ bestand: "Main.dc.html", titel: "Voorblad", html: doc("Voorblad", voorblad(r, logoDia), ROOT_STYLE_VOORBLAD) }];
  delen.forEach((d, i) => {
    const nr = i + 2;
    paginas.push({
      bestand: `${String(nr).padStart(2, "0")}-${d.naam}.dc.html`,
      titel: d.titel,
      html: doc(d.titel, pagina(nr, d.kicker, d.h1, d.body, opties), ROOT_STYLE_PAGINA),
    });
  });
  return paginas;
}

export function canvasJson(paginas, nu = new Date(), titel = "IT-inventarisatie") {
  const boards = {};
  paginas.forEach((pg, i) => {
    const rij = Math.floor(i / 4), kolom = i % 4;
    boards[pg.bestand] = { x: kolom * (W + 80), y: rij * (H + 120), w: W, h: H, title: `${i + 1}. ${pg.titel}`, paper: "a4" };
  });
  return {
    v: 3,
    createdOnFiles: { v: 1, at: nu.toISOString().replace(/\.\d{3}Z$/, "Z") },
    title: titel,
    launch: { view: "canvas" },
    pages: [],
    boards,
    order: paginas.map((pg) => pg.bestand),
    notes: {},
    designSystems: [],
  };
}

// Schrijft de pagina's en canvas.json naar <root>/project. Geeft de geschreven paden terug.
export function schrijf(paginas, root, { titel, nu } = {}) {
  const map = join(root, "project");
  mkdirSync(map, { recursive: true });
  const paden = [];
  for (const pg of paginas) {
    const pad = join(map, pg.bestand);
    writeFileSync(pad, pg.html, "utf8");
    paden.push(pad);
  }
  const pad = join(map, "canvas.json");
  writeFileSync(pad, JSON.stringify(canvasJson(paginas, nu, titel), null, 1), "utf8");
  paden.push(pad);
  return paden;
}

function leesArgs(argv) {
  const args = {};
  const bekend = new Set(["--rapport", "--uit", "--logo-pos", "--logo-dia"]);
  for (let i = 0; i < argv.length; i++) {
    if (!bekend.has(argv[i])) throw new Error(`onbekend argument: ${argv[i]}`);
    const waarde = argv[i + 1];
    if (waarde === undefined || waarde.startsWith("--")) throw new Error(`${argv[i]} mist een waarde`);
    args[argv[i].slice(2)] = waarde;
    i++;
  }
  const ontbreekt = [...bekend].filter((k) => !args[k.slice(2)]);
  if (ontbreekt.length) throw new Error(`verplicht: ${ontbreekt.join(", ")}`);
  for (const k of ["logo-pos", "logo-dia"]) {
    if (!/^(\/_blob\/|https?:\/\/)/.test(args[k])) {
      throw new Error(`--${k} moet een /_blob/-url of http(s)-url zijn, kreeg ${args[k]}. Git Bash zet /_blob/... om naar een Windows-pad; draai dan met MSYS_NO_PATHCONV=1.`);
    }
  }
  return args;
}

function main(argv) {
  let args;
  try {
    args = leesArgs(argv);
  } catch (e) {
    console.error(`${e.message}\nGebruik: node bouw.mjs --rapport <pad> --uit <map> --logo-pos <url> --logo-dia <url>`);
    return 1;
  }
  let rapport;
  try {
    rapport = JSON.parse(readFileSync(args.rapport, "utf8"));
  } catch (e) {
    console.error(`Kan ${args.rapport} niet lezen: ${e.message}`);
    return 1;
  }
  const fouten = validateRapport(rapport);
  if (fouten.length) {
    console.error(`Het rapport is niet geldig, er is niets geschreven:\n${fouten.map((f) => `- ${f}`).join("\n")}`);
    return 1;
  }
  const paginas = bouwPaginas(rapport, { logoPos: args["logo-pos"], logoDia: args["logo-dia"] });
  const paden = schrijf(paginas, args.uit, { titel: `IT-inventarisatie ${rapport.klant}` });
  console.log(paden.join("\n"));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
