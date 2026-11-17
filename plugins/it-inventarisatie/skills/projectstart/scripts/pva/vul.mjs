#!/usr/bin/env node
// Mini PVA uit het dossier (spec 5.4). Vult assets/mini-pva-template.docx: elke plaatshouder
// staat als enige tekst in een eigen alinea of tabelcel en wordt per alinea vervangen, zodat
// alinea-opmaak, bladwijzers (inhoudsopgave) en de handtekeningregel (w:pict) blijven staan.
//
// Plaatshouders: {{naam}} per veld uit pvaUitDossier(d).velden. Genummerde velden
// (doelstelling_1, scope_1, buiten_1, ...) zijn lijsten: ontbrekende nummers verdwijnen uit het
// document, extra nummers krijgen een kopie van de laatste alinea. De planningstabel heeft
// {{planning_<n>_onderdeel}}, {{planning_<n>_deadline}} en {{planning_<n>_wie}} voor n = 1..25.
//
// Regel: niets verzinnen. Wat niet in het dossier staat, wordt "nog te bepalen".
// Het PVA is intern: bedragen uit interne afspraken mogen erin.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { leesZip, schrijfZip } from "../zip.mjs";
import { valideerDossier } from "../dossier.mjs";
import { datumTekst, maandTekst } from "../presentatie/slides.mjs";

export const TEMPLATE = fileURLToPath(new URL("../../assets/mini-pva-template.docx", import.meta.url));
const OPEN = "nog te bepalen";
const GEBRUIK = "Gebruik: vul.mjs --dossier <pad> --uit <docx>\n";

// --- XML ---

const ALINEA = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const RIJ = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
const TABEL = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const OBJECT_RUN = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:(?:pict|drawing)\b[\s\S]*?<\/w:r>/g;

// Stuurtekens behalve tab, nieuwe regel en return zijn in XML 1.0 verboden; Word weigert dan het bestand.
export const xmlEsc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tekstVan = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
const sleutel = (naam) => `{{${String(naam).replace(/^\{\{|\}\}$/g, "")}}}`;

function eersteRunRPr(p) {
  const zonderPPr = p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "");
  const run = [...zonderPPr.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map((m) => m[0]).find((r) => /<w:t[ >]/.test(r));
  return run?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
}

// Vet toevoegen op de plek die het schema voorschrijft (na rStyle en rFonts).
function vet(rPr) {
  const kaal = zonderVet(rPr) || "<w:rPr></w:rPr>";
  return kaal.replace(/^<w:rPr>((?:<w:rStyle\b[^>]*\/>)?(?:<w:rFonts\b[^>]*\/>)?)/, "<w:rPr>$1<w:b/><w:bCs/>");
}
const zonderVet = (rPr) => rPr.replace(/<w:b(?:Cs)?(?: [^>]*)?\/>/g, "");

function runs(inhoud, rPr) {
  const run = (r, t) => `<w:r>${r}<w:t xml:space="preserve">${xmlEsc(String(t).replace(/\s+/g, " "))}</w:t></w:r>`;
  if (typeof inhoud === "string") return run(rPr, inhoud);
  if (!inhoud || typeof inhoud.label !== "string" || typeof inhoud.rest !== "string") {
    throw new Error("Inhoud moet tekst of { label, rest } zijn.");
  }
  return run(vet(rPr), `${inhoud.label} `) + run(zonderVet(rPr), inhoud.rest);
}

// Nieuwe alinea met dezelfde w:pPr, bladwijzers en object-runs (handtekeningregel), en één tekst.
function bouwAlinea(p, inhoud, { metObjecten = true } = {}) {
  let open = p.match(/^<w:p\b[^>]*>/)[0];
  const leeg = open.endsWith("/>");
  if (leeg) open = open.replace(/\s*\/>$/, ">");
  const pPr = leeg ? "" : (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "");
  const bmS = (p.match(/<w:bookmarkStart\b[^>]*\/>/g) ?? []).join("");
  const bmE = (p.match(/<w:bookmarkEnd\b[^>]*\/>/g) ?? []).join("");
  const objecten = metObjecten ? (p.match(OBJECT_RUN) ?? []).join("") : "";
  const regel = objecten ? "<w:r><w:br/></w:r>" : "";
  return open + pPr + bmS + runs(inhoud, eersteRunRPr(p)) + regel + objecten + bmE + "</w:p>";
}

export function vervangAlinea(xml, plaatshouder, inhoud) {
  const s = sleutel(plaatshouder);
  let gevonden = 0;
  const uit = xml.replace(ALINEA, (p) => {
    if (!tekstVan(p).includes(s)) return p;
    gevonden++;
    return bouwAlinea(p, inhoud);
  });
  if (!gevonden) throw new Error(`Plaatshouder ${s} niet gevonden in het template.`);
  return uit;
}

// --- Planning ---

export function vulPlanning(xml, rijen) {
  const tabel = (xml.match(TABEL) ?? []).find((t) => tekstVan(t).includes("{{planning_1_onderdeel}}"));
  if (!tabel) throw new Error("Planningstabel met {{planning_1_onderdeel}} niet gevonden in het template.");
  const plekken = (tabel.match(RIJ) ?? []).filter((r) => /\{\{planning_\d+_/.test(tekstVan(r))).length;
  if (rijen.length > plekken) {
    throw new Error(`Maximaal ${plekken} planningsrijen in het PVA, het dossier levert er ${rijen.length}.`);
  }
  rijen.forEach((r, i) => {
    if (!Array.isArray(r) || r.length !== 3) throw new Error(`Planningsrij ${i + 1} moet [onderdeel, deadline, verantwoordelijke] zijn.`);
  });
  const nieuw = tabel.replace(RIJ, (rij) => {
    const n = Number(tekstVan(rij).match(/\{\{planning_(\d+)_/)?.[1]);
    if (!n) return rij;
    if (n > rijen.length) return "";
    const [onderdeel, deadline, wie] = rijen[n - 1].map((c) => (typeof c === "string" && c.trim() ? c : OPEN));
    let r = vervangAlinea(rij, `planning_${n}_onderdeel`, onderdeel);
    r = vervangAlinea(r, `planning_${n}_deadline`, deadline);
    return vervangAlinea(r, `planning_${n}_wie`, wie);
  });
  return xml.replace(tabel, () => nieuw);
}

// --- Lijsten (genummerde plaatshouders) ---

const GENUMMERD = /^(.+)_(\d+)$/;
const plaatshouders = (xml) => {
  const namen = [];
  for (const p of xml.match(ALINEA) ?? []) for (const m of tekstVan(p).matchAll(/\{\{([^{}]+)\}\}/g)) namen.push(m[1]);
  return namen;
};
const alineaMet = (xml, naam) => (xml.match(ALINEA) ?? []).find((p) => tekstVan(p).includes(sleutel(naam)));

function pasLijstenAan(xml, velden) {
  const groepen = new Map();
  const voegToe = (naam, waar) => {
    const m = GENUMMERD.exec(naam);
    if (!m) return;
    if (!groepen.has(m[1])) groepen.set(m[1], { template: new Set(), velden: new Set() });
    groepen.get(m[1])[waar].add(Number(m[2]));
  };
  plaatshouders(xml).forEach((n) => voegToe(n, "template"));
  Object.keys(velden).forEach((n) => voegToe(n, "velden"));
  for (const [prefix, { template, velden: gewenst }] of groepen) {
    if (!template.size) continue;
    let laatste = Math.max(...template);
    for (const n of [...gewenst].sort((a, b) => a - b)) {
      if (template.has(n)) continue;
      const vorige = alineaMet(xml, `${prefix}_${laatste}`);
      const kopie = bouwAlinea(vorige.replace(/\s+w14:(?:paraId|textId)="[^"]*"/g, "").replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g, ""), `{{${prefix}_${n}}}`, { metObjecten: false });
      const i = xml.indexOf(vorige) + vorige.length;
      xml = xml.slice(0, i) + kopie + xml.slice(i);
      laatste = n;
    }
    for (const n of template) {
      if (gewenst.has(n)) continue;
      const p = alineaMet(xml, `${prefix}_${n}`);
      if (/<w:bookmarkStart|<w:pict|<w:drawing/.test(p)) throw new Error(`Alinea {{${prefix}_${n}}} heeft een bladwijzer of object en mag niet weg.`);
      xml = xml.replace(p, "");
    }
  }
  return xml;
}

// --- Inhoud uit het dossier ---

const L = (label, rest) => ({ label, rest });
const datum = (s) => (s ? datumTekst(s) : OPEN);
const zin = (s) => { const t = String(s).trim(); return /[.!?:]$/.test(t) ? t : `${t}.`; };
const zonderPunt = (s) => String(s).trim().replace(/\.$/, "");
const periode = (f) => (f.start === f.eind ? maandTekst(f.start) : `${maandTekst(f.start)} tot en met ${maandTekst(f.eind)}`);
const persoon = (p) => `${p.naam} (${p.rol})`;
const lijstOfOpen = (items) => (items.length ? items : [OPEN]);
const genummerd = (prefix, items) => Object.fromEntries(items.map((v, i) => [`${prefix}_${i + 1}`, v]));

function planningUitDossier(d) {
  const rijen = [
    ...d.besluiten.map((b) => [`Besluit: ${b.vraag}`, datum(b.uiterlijk), b.beslisser ? `Klant (${b.beslisser})` : "Klant / PM"]),
    ...d.aanleveren.map((a) => [`Aanleveren: ${a.wat}`, datum(a.datum), a.wie ? `Klant (${a.wie})` : "Klant"]),
    ...d.fases.map((f) => [`${f.code} ${f.naam} (${periode(f)})`, maandTekst(f.eind), "Techniek"]),
  ];
  if (d.migratieplan !== undefined) rijen.push(["Migratieplan opleveren", datum(d.migratieplan?.datum), "PM"]);
  rijen.push([`Oplevering: ${zonderPunt(d.hardeDatum.watKlaar)}`, datum(d.hardeDatum.datum), "PM"]);
  return rijen;
}

export function pvaUitDossier(d) {
  const naam = d.klant.weergave;
  const hd = d.hardeDatum;
  const pl = d.team.find((t) => /projectleider|projectmanager/i.test(t.rol));
  const beveiliging = d.extraOnderwerpen.find((o) => o.soort === "beveiliging");
  const partijen = d.externePartijen ?? [];
  const aantalFases = d.fases.length === 1 ? "1 fase" : `${d.fases.length} fases`;

  const doelstellingen = [
    zin(d.doel),
    L(`Uiterlijk ${datum(hd.datum)}:`, zin(hd.watKlaar)),
    ...d.fases.map((f) => `${f.code} ${f.naam} afgerond in ${maandTekst(f.eind)}.`),
    ...(d.migratieplan !== undefined ? [L("Migratieplan:", `klaar op ${datum(d.migratieplan?.datum)}.`)] : []),
  ];
  const buiten = [...d.scope.buiten.map(zin), L(`Niet in de oplevering van ${datum(hd.datum)}:`, zin(hd.watNiet))];

  const beveiligingTekst = beveiliging && [
    beveiliging.geregeld.length ? `geregeld: ${beveiliging.geregeld.join("; ")}.` : "",
    beveiliging.controleren.length ? `Te controleren: ${beveiliging.controleren.join("; ")}.` : "",
    beveiliging.later.length ? `Later: ${beveiliging.later.join("; ")}.` : "",
  ].filter(Boolean).join(" ");

  const afspraak = (a) => `${zonderPunt(a.tekst)} (${a.bron}).`;
  const klantAfspraken = d.afspraken.filter((a) => !a.intern);
  const interneAfspraken = d.afspraken.filter((a) => a.intern);
  const beslissers = d.contacten.filter((c) => c.beslisser);

  const velden = {
    klant: naam,
    inleiding: [
      `Dit Mini PVA beschrijft de aanpak van het project voor ${naam}${d.klant.autotask !== naam ? ` (in Autotask: ${d.klant.autotask})` : ""}.`,
      zin(d.doel),
      `Uiterlijk ${datum(hd.datum)} is dit klaar: ${zin(hd.watKlaar)}`,
      "Het document is de leidraad voor het interne team en legt de stappen, verantwoordelijkheden en randvoorwaarden vast.",
    ].join(" "),
    doelstellingen_intro: `Het project voor ${naam} heeft de volgende doelstellingen:`,
    ...genummerd("doelstelling", doelstellingen),
    scope_intro: `Het project voor ${naam} omvat de volgende activiteiten:`,
    ...genummerd("scope", lijstOfOpen(d.scope.inbegrepen.map(zin))),
    ...genummerd("buiten", buiten),
    impact_implicaties: `Het project loopt in ${aantalFases} tot de harde datum van ${datum(hd.datum)}. ${zin(hd.watNiet)}`,
    impact_systemen: partijen.length ? `${partijen.map((p) => `${p.naam} (${p.rol})`).join("; ")}.` : OPEN,
    impact_downtime: OPEN,
    impact_herstel: OPEN,
    voorbereidingen_intro: `Voor een goede uitvoering van het project voor ${naam} zijn de volgende voorbereidingen nodig:`,
    voorbereiding_aanleveren: L("Aanleveren door de klant:", d.aanleveren.length
      ? `${d.aanleveren.map((a) => `${zonderPunt(a.wat)} (${a.wie ?? `wie: ${OPEN}`}, ${a.datum ? datumTekst(a.datum) : `datum: ${OPEN}`}${a.tijd ? `, tijdsinzet ${a.tijd}` : ""})`).join("; ")}.`
      : OPEN),
    voorbereiding_technisch: L("Technische vragen:", d.technischeVragen.length
      ? d.technischeVragen.map((v) => `${v.vraag} (aan ${v.aan}, bron: ${v.bron})`).join(" ")
      : OPEN),
    voorbereiding_beveiliging: L("Informatiebeveiliging:", beveiligingTekst || OPEN),
    communicatie_intro: `Voor een goede uitvoering van het project voor ${naam} is duidelijke communicatie nodig. Hieronder staat de interne en externe communicatie.`,
    communicatie_intern: L("Contactpersonen:", [
      `aanspreekpunt bij ${naam} is ${d.overleg.aanspreekpunt}, escalatie via ${d.overleg.escalatie}.`,
      d.contacten.length ? `Contacten: ${d.contacten.map((c) => `${c.naam} (${c.rol}, ${c.organisatie}${c.beslisser ? ", beslisser" : ""})`).join("; ")}.` : "",
      `Team JUICT: ${d.team.length ? d.team.map(persoon).join(", ") : OPEN}.`,
    ].filter(Boolean).join(" ")),
    communicatie_extern: L("Overleg:", [
      zin(d.overleg.ritme),
      `Volgend overleg: ${datum(d.overleg.volgende)}.`,
      d.overleg.verzoekenControle ? zin(d.overleg.verzoekenControle) : "",
      partijen.length ? `Externe partijen: ${partijen.map((p) => `${p.naam} (${p.rol}, aangestuurd door ${p.aangestuurdDoor ?? OPEN})`).join("; ")}.` : "",
    ].filter(Boolean).join(" ")),
    uitvoering_stappen: L("Uitvoerende stappen:", [
      `${pl ? persoon(pl) : `projectleider ${OPEN}`} bewaakt planning, scope en budget.`,
      `Team: ${d.team.length ? d.team.map(persoon).join(", ") : OPEN}.`,
      `Fases: ${d.fases.map((f) => `${f.code} ${f.naam} (${periode(f)})`).join("; ")}.`,
    ].join(" ")),
    uitvoering_testen: L(`Opleveren op ${datum(hd.datum)}:`, zin(hd.watKlaar)),
    afronding_evaluatie: L("Evaluatie en vervolg:", d.vervolgOfferte ? zin(d.vervolgOfferte) : OPEN),
    afronding_documentatie: L("Documentatie:", "technische documentatie komt in IT Glue."),
    goedkeuring: [
      `Klantzijde: ${beslissers.length ? beslissers.map((c) => `${c.naam} (${c.rol})`).join(", ") : OPEN}.`,
      `Intern: ${pl ? persoon(pl) : OPEN}.`,
      klantAfspraken.length ? `Afspraken: ${klantAfspraken.map(afspraak).join(" ")}` : "",
      interneAfspraken.length ? `Interne afspraken: ${interneAfspraken.map(afspraak).join(" ")}` : "",
    ].filter(Boolean).join(" "),
  };
  return { velden, planning: planningUitDossier(d) };
}

// --- Document ---

export function vulPva(templateBuf, d) {
  const fouten = valideerDossier(d);
  if (fouten.length) throw new Error(`Dossier ongeldig:\n${fouten.join("\n")}`);
  const { velden, planning } = pvaUitDossier(d);
  const zip = leesZip(templateBuf);
  let xml = zip.get("word/document.xml").toString("utf8");
  xml = vulPlanning(xml, planning);
  xml = pasLijstenAan(xml, velden);
  for (const [naam, inhoud] of Object.entries(velden)) xml = vervangAlinea(xml, naam, inhoud);
  const over = plaatshouders(xml);
  if (over.length || /\{\{/.test(xml)) throw new Error(`Niet ingevulde plaatshouders: ${over.join(", ") || "{{ in de XML"}`);
  zip.set("word/document.xml", Buffer.from(xml, "utf8"));
  const core = zip.get("docProps/core.xml")?.toString("utf8");
  if (core) {
    const titel = `<dc:title>${xmlEsc(`Mini PVA ${d.klant.weergave}`)}</dc:title>`;
    zip.set("docProps/core.xml", Buffer.from(core.replace(/<dc:title\/>|<dc:title>[^<]*<\/dc:title>/, titel), "utf8"));
  }
  return schrijfZip(zip);
}

// --- CLI ---

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export async function hoofd(argv) {
  const pad = optie(argv, "--dossier");
  const uit = optie(argv, "--uit");
  if (!pad || !uit) return { code: 1, uitvoer: GEBRUIK };
  try {
    const d = JSON.parse(readFileSync(pad, "utf8"));
    writeFileSync(uit, vulPva(readFileSync(TEMPLATE), d));
    return { code: 0, uitvoer: `Mini PVA: ${uit}\nWerk de inhoudsopgave bij met afronden.ps1 -Bron <docx> -Doel <docx> [-Pdf <pdf>].\n` };
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
