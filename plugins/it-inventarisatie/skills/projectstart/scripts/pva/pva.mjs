#!/usr/bin/env node
// Mini PVA uit het dossier, in de stijl en opbouw van de kick-off-presentatie.
// Maakt Word-vriendelijke HTML; naar-pva.ps1 maakt er via Word-COM een .docx (en PDF) van, met voorblad,
// inhoudsopgave en paginanummers.
//
// Harde regels (review technisch leider):
// 1. Financiële afspraken staan apart, met de bron per regel. Een financiële afspraak met `controleren: true`
//    (bijvoorbeeld alleen in een mail genoemd) is geen feit: die gaat naar Open punten.
// 2. Een feit staat alleen als bevestigd met een bron (`doelBron`, `hardeDatum.bron`, `besluiten[].bron`).
//    Zonder bron: "uitgangspunt, nog te bevestigen" en een regel in Open punten.
// 3. Planning met start en eind per fase en een datum per besluit en aanleverpunt. Een onbekende datum is
//    "nog te plannen" en staat ook in Open punten.
// 4. Geen instructieteksten uit een template en geen lege tabellen (controleerPva).
//
// Gebruik: node pva.mjs --dossier <pad> --uit <html> [--versie N] [--datum jjjj-mm-dd] [--logo <svg>] [--voorblad <png>]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { valideerDossier } from "../dossier.mjs";
import { datumTekst, maandTekst, SUPPORT_MAIL, SUPPORT_PORTAAL, NOODNUMMER } from "../presentatie/slides.mjs";
import { findSecretText } from "../../../it-inventarisatie/scripts/geheimen.mjs";

export const LOGO = fileURLToPath(new URL("../../../it-inventarisatie/assets/juict-logo-dia.svg", import.meta.url));
export const VOORBLAD = fileURLToPath(new URL("../../assets/pva-voorblad.png", import.meta.url));
export const MARKER_INHOUD = "[[INHOUDSOPGAVE]]";

const NAVY = "#002345";
const PINK = "#FF3862";
const GRIJS = "#5d6577";
const LIJN = "#d5dae3";
const OPEN = "nog te bepalen";
const PLANNEN = "nog te plannen";
const BEVESTIGEN = "Uitgangspunt, nog te bevestigen.";
const GEBRUIK = "Gebruik: node pva.mjs --dossier <pad> --uit <html> [--versie N] [--datum jjjj-mm-dd] [--logo <svg>] [--voorblad <png>]\n";

// --- Hulpjes ---

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isTekst = (v) => typeof v === "string" && v.trim() !== "";
const zin = (s) => { const t = String(s).trim(); return /[.!?:]$/.test(t) ? t : `${t}.`; };
const datum = (s) => (isTekst(s) ? datumTekst(s) : PLANNEN);
const isBesloten = (b) => isTekst(b.besluit);
const projectleider = (d) => d.team.find((t) => /projectleider|projectmanager/i.test(t.rol)) ?? null;
const plNaam = (d) => projectleider(d)?.naam ?? "Projectleider";
const klein = (s) => `<span class="klein">${esc(s)}</span>`;
const bronRegel = (bron) => (isTekst(bron) ? `<p class="klein">Bron: ${esc(bron)}</p>` : `<p class="klein">${BEVESTIGEN}</p>`);
const lijst = (items) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

// Een tabel met een navy kop. Zonder rijen geen tabel: een lege tabel komt nooit in het PVA.
function tabel(kolommen, rijen, { breedtes = [] } = {}) {
  if (!rijen.length) return "";
  const kop = kolommen.map((k, i) => `<th${breedtes[i] ? ` width="${breedtes[i]}%"` : ""}>${esc(k)}</th>`).join("");
  const body = rijen.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<table><thead><tr>${kop}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

// --- Open punten ---

export function openPunten(d) {
  const pl = plNaam(d);
  const p = [];
  const punt = (wat, waarom, wie) => p.push({ wat, waarom, wie: wie ?? pl });
  if (!projectleider(d)) punt("Projectleider", "Er staat nog geen projectleider in het team.", "JUICT");
  if (!isTekst(d.doelBron)) punt("Doel van het project", "Uitgangspunt zonder bron. Bevestigen met een mail of het verslag van de kick-off.");
  if (!isTekst(d.hardeDatum.bron)) punt(`Harde datum ${datumTekst(d.hardeDatum.datum)}`, "Uitgangspunt zonder bron. Bevestigen met een mail of het verslag van de kick-off.");
  if (!d.scope.inbegrepen.length) punt("Scope", "Nog niet vastgelegd wat binnen het project valt.");
  for (const b of d.besluiten) {
    if (isBesloten(b)) {
      if (!isTekst(b.bron)) punt(`Besluit: ${b.vraag}`, "Genomen, maar zonder bron. Leg vast waar het besluit staat (mail met datum of kick-off).");
    } else {
      punt(`Besluit: ${b.vraag}`, `Nog niet genomen${b.uiterlijk ? "" : ", datum nog te plannen"}. Zonder besluit geldt: ${zin(b.alsNiet)}`, b.beslisser ?? `${OPEN} (beslisser)`);
    }
  }
  for (const a of d.aanleveren) {
    const mist = [!a.wie && `wie het aanlevert is ${OPEN}`, !a.datum && `datum ${PLANNEN}`].filter(Boolean);
    if (mist.length) punt(`Aanleveren: ${a.wat}`, `${zin(mist.join(", ")).replace(/^./, (c) => c.toUpperCase())}`, a.wie ?? d.overleg.aanspreekpunt);
  }
  for (const f of d.fases) if (!isTekst(f.eind)) punt(`Fase ${f.code} ${f.naam}`, `Einde van de fase ${PLANNEN}.`);
  if (d.migratieplan !== undefined && !isTekst(d.migratieplan?.datum)) punt("Migratieplan", `Datum ${PLANNEN}.`);
  for (const a of d.afspraken.filter((x) => x.financieel === true && x.controleren === true)) {
    punt(zin(a.tekst), `Staat alleen in ${a.bron}. Controleren tegen de offerte; tot dan geen afspraak.`);
  }
  for (const e of d.externePartijen ?? []) if (!isTekst(e.aangestuurdDoor)) punt(`Aansturing ${e.naam}`, `Wie deze partij aanstuurt is ${OPEN}.`);
  if (!isTekst(d.gebruikersimpact)) punt("Impact voor gebruikers", `Nog niet vastgelegd.`);
  if (!isTekst(d.overgangBeheer)) punt("Overgang van het beheer", `Nog niet vastgelegd.`);
  if (d.overleg.kanaal === null) punt("Overlegkanaal", `Kanaal is ${OPEN}.`);
  if (d.overleg.volgende === null) punt("Volgend overleg", `Datum ${PLANNEN}.`);
  if (d.vervolgOfferte === null) punt("Vervolgofferte", `Of en wanneer er een vervolgofferte komt is ${OPEN}.`);
  if (!d.contacten.some((c) => c.beslisser)) punt("Opdrachtgever voor de goedkeuring", "Er is nog geen beslisser bij de klant bekend.");
  return p;
}

// --- Hoofdstukken ---

function eersteStap(d) {
  const hd = d.hardeDatum;
  const naam = isTekst(d.projectNaam) ? ` "${esc(d.projectNaam)}"` : "";
  return `<p>Dit plan van aanpak legt vast hoe JUICT en ${esc(d.klant.weergave)} het project${naam} uitvoeren: wat we opleveren, wie wat doet en wanneer.</p>
<h2>Doel</h2>
<p>${esc(zin(d.doel))}</p>
${bronRegel(d.doelBron)}
<h2>Harde datum</h2>
${tabel(["Datum", "Wat er dan klaar is", "Wat dan nog niet klaar is"], [[`<b>${esc(datumTekst(hd.datum))}</b>`, esc(zin(hd.watKlaar)), esc(zin(hd.watNiet))]], { breedtes: [20, 40, 40] })}
${bronRegel(hd.bron)}`;
}

function samenwerken(d) {
  const fasesIn = (nr) => d.fases.filter((f) => f.route === nr).map((f) => `${f.code} ${f.naam}`);
  const inProject = (nr) => (fasesIn(nr).length ? esc(fasesIn(nr).join(", ")) : "Geen fase in dit project.");
  const route = tabel(["Stap", "Wat", "In dit project"], [
    ["<b>01</b>", "Nulmeting en scan: IT en de grootste kansen in kaart", inProject("01")],
    ["<b>02</b>", "Fundament bouwen: netwerk, cloud, werkplek en beveiliging op orde", inProject("02")],
    ["<b>03 tot 05</b>", "Beheer en support, data en intelligentie, doorontwikkelen", "Later, valt niet onder dit project."],
  ], { breedtes: [14, 50, 36] });
  const binnen = d.scope.inbegrepen.map(zin);
  const buiten = d.scope.buiten.map(zin);
  return `<p>We volgen dezelfde route als in de verkooppresentatie. Dit project gaat over stap 01 en 02.</p>
${route}
${binnen.length ? `<h2>Binnen de scope</h2>\n${lijst(binnen)}` : ""}
${buiten.length ? `<h2>Buiten de scope</h2>\n${lijst(buiten)}` : ""}`;
}

function vastTeam(d) {
  const team = tabel(["Naam", "Rol"], d.team.map((t) => [`<b>${esc(t.naam)}</b>`, esc(t.rol)]), { breedtes: [40, 60] });
  const rolIn = (c) => [c.aanspreekpunt && "dagelijks aanspreekpunt", c.beslisser && "beslisser"].filter(Boolean).join(", ");
  const contacten = tabel(["Naam", "Functie", "Organisatie", "In dit project"],
    d.contacten.map((c) => [`<b>${esc(c.naam)}</b>`, esc(c.rol), esc(c.organisatie), esc(rolIn(c))]), { breedtes: [25, 25, 25, 25] });
  const partijen = tabel(["Partij", "Rol", "Aangestuurd door"],
    (d.externePartijen ?? []).map((e) => [`<b>${esc(e.naam)}</b>`, esc(e.rol), isTekst(e.aangestuurdDoor) ? esc(e.aangestuurdDoor) : OPEN]), { breedtes: [30, 40, 30] });
  return [team && `<h2>JUICT</h2>\n${team}`, contacten && `<h2>Contactpersonen</h2>\n${contacten}`, partijen && `<h2>Externe partijen</h2>\n${partijen}`]
    .filter(Boolean).join("\n");
}

const maand = (s) => (isTekst(s) ? maandTekst(s) : PLANNEN);

function planning(d) {
  const fases = tabel(["Fase", "Wat", "Stap", "Start", "Eind"],
    d.fases.map((f) => [`<b>${esc(f.code)}</b>`, esc(f.naam), esc(f.route), esc(maand(f.start)), esc(maand(f.eind))]), { breedtes: [10, 42, 10, 19, 19] });
  const rijen = [
    ...d.besluiten.map((b) => ({ iso: b.uiterlijk, wat: `Besluit: ${b.vraag}`, wanneer: isTekst(b.uiterlijk) ? datumTekst(b.uiterlijk) : (isBesloten(b) ? "besloten" : PLANNEN), wie: b.beslisser ?? OPEN })),
    ...d.aanleveren.map((a) => ({ iso: a.datum, wat: `Aanleveren: ${a.wat}`, wanneer: datum(a.datum), wie: a.wie ?? OPEN })),
    ...(d.migratieplan !== undefined ? [{ iso: d.migratieplan?.datum, wat: "Migratieplan klaar", wanneer: datum(d.migratieplan?.datum), wie: plNaam(d) }] : []),
    { iso: d.hardeDatum.datum, wat: `Oplevering: ${d.hardeDatum.watKlaar}`, wanneer: datumTekst(d.hardeDatum.datum), wie: plNaam(d) },
  ];
  const sleutel = (r) => (/^\d{4}-\d{2}-\d{2}$/.test(r.iso ?? "") ? r.iso : "9999");
  const gesorteerd = rijen.map((r, i) => ({ ...r, i })).sort((a, b) => sleutel(a).localeCompare(sleutel(b)) || a.i - b.i);
  const mijlpalen = tabel(["Wat", "Uiterlijk", "Wie"], gesorteerd.map((r) => [esc(r.wat), esc(r.wanneer), esc(r.wie)]), { breedtes: [56, 22, 22] });
  return `<h2>Fases</h2>\n${fases}\n<h2>Besluiten, aanleveren en mijlpalen</h2>\n${mijlpalen}`;
}

function fase0(d) {
  const uitkomst = (b) => (isBesloten(b)
    ? `<b>${esc(zin(b.besluit))}</b><br>${klein(isTekst(b.bron) ? `Bron: ${b.bron}` : "Bron nog vastleggen.")}`
    : `Nog open. Zonder besluit geldt: ${esc(zin(b.alsNiet))}`);
  const rijen = d.besluiten.map((b) => [esc(b.vraag), esc(b.beslisser ?? OPEN),
    esc(isTekst(b.uiterlijk) ? datumTekst(b.uiterlijk) : (isBesloten(b) ? "besloten" : PLANNEN)), uitkomst(b)]);
  return `<p>Deze besluiten bepalen het tempo van het project.</p>\n${tabel(["Besluit", "Beslisser", "Uiterlijk", "Uitkomst"], rijen, { breedtes: [32, 18, 15, 35] })}`;
}

function aandeel(d) {
  const rijen = d.aanleveren.map((a) => [esc(a.wat), esc(a.wie ?? OPEN), esc(datum(a.datum)), esc(a.tijd ?? "niet opgegeven")]);
  return `<p>Dit hebben we van jullie nodig om volgens planning te werken.</p>\n${tabel(["Wat", "Wie", "Uiterlijk", "Tijdsinzet"], rijen, { breedtes: [46, 20, 18, 16] })}`;
}

function veilig(d) {
  const b = d.extraOnderwerpen.filter((x) => x.soort === "beveiliging");
  const alle = (veld) => b.flatMap((x) => x[veld]).map(zin);
  const delen = [["Al geregeld", alle("geregeld")], ["Dit controleren we", alle("controleren")], ["Komt later", alle("later")]]
    .filter(([, items]) => items.length).map(([kop, items]) => `<h2>${kop}</h2>\n${lijst(items)}`);
  if (!delen.length) return "";
  const intro = b.some((x) => x.optioneel === true)
    ? "Beveiliging valt binnen dit project. In het rapport staat het als keuze; wat jullie kiezen, nemen we op in de planning."
    : "Beveiliging valt binnen dit project.";
  return `<p>${intro}</p>\n${delen.join("\n")}`;
}

function opDeHoogte(d) {
  const o = d.overleg;
  const rijen = [
    ["Overleg", esc(zin(o.ritme))],
    ["Dagelijks aanspreekpunt", esc(o.aanspreekpunt)],
    ["Escalatie", esc(o.escalatie)],
    ["Kanaal", esc(isTekst(o.kanaal) ? o.kanaal : OPEN)],
    ["Volgend overleg", esc(datum(o.volgende))],
    ...(isTekst(o.verzoekenControle) ? [["Verzoeken", esc(zin(o.verzoekenControle))]] : []),
    ["Support", esc(`${SUPPORT_MAIL} en ${SUPPORT_PORTAAL}`)],
    ["Noodnummer", esc(`${NOODNUMMER}, alleen bij urgente storingen (daar kunnen extra kosten aan zitten).`)],
  ].map(([k, v]) => [`<b>${esc(k)}</b>`, v]);
  return tabel(["Onderwerp", "Afspraak"], rijen, { breedtes: [30, 70] });
}

function impact(d) {
  const partijen = (d.externePartijen ?? []).map((e) => `${e.naam} (${e.rol})`);
  if (!isTekst(d.gebruikersimpact) && !isTekst(d.overgangBeheer) && !partijen.length) return "";
  const rijen = [
    ["Impact voor gebruikers", esc(isTekst(d.gebruikersimpact) ? zin(d.gebruikersimpact) : OPEN)],
    ["Overgang van het beheer", esc(isTekst(d.overgangBeheer) ? zin(d.overgangBeheer) : OPEN)],
    ...(partijen.length ? [["Andere systemen en partijen", esc(zin(partijen.join("; ")))]] : []),
  ].map(([k, v]) => [`<b>${esc(k)}</b>`, v]);
  return tabel(["Onderwerp", "Wat we weten"], rijen, { breedtes: [30, 70] });
}

function afspraken(d) {
  const algemeen = d.afspraken.filter((a) => a.financieel !== true);
  const financieel = d.afspraken.filter((a) => a.financieel === true && a.controleren !== true);
  const alg = tabel(["Afspraak", "Met wie", "Bron"],
    algemeen.map((a) => [esc(zin(a.tekst)), a.intern ? "Intern" : "Met de klant", klein(a.bron)]), { breedtes: [60, 15, 25] });
  const fin = tabel(["Afspraak", "Bron"], financieel.map((a) => [esc(zin(a.tekst)), klein(a.bron)]), { breedtes: [70, 30] });
  if (!alg && !fin) return "";
  return [alg,
    fin && `<h2>Financiële afspraken</h2>\n<p>Alleen wat letterlijk in een bron staat. De offerte is leidend; wat alleen in een mail staat, staat bij Open punten.</p>\n${fin}`,
  ].filter(Boolean).join("\n");
}

function uitvoering(d) {
  const vragen = tabel(["Vraag", "Aan", "Bron"], d.technischeVragen.map((v) => [esc(v.vraag), esc(v.aan), klein(v.bron)]), { breedtes: [60, 20, 20] });
  return [
    vragen && `<h2>Technische vragen</h2>\n${vragen}`,
    isTekst(d.vervolgOfferte) && `<h2>Vervolg</h2>\n<p>${esc(zin(d.vervolgOfferte))}</p>`,
    `<h2>Documentatie</h2>\n<p>De technische documentatie van de nieuwe situatie staat in IT Glue.</p>`,
  ].filter(Boolean).join("\n");
}

function openPuntenHoofdstuk(d) {
  const p = openPunten(d);
  return tabel(["Wat", "Waarom open", "Wie"], p.map((x) => [esc(x.wat), esc(x.waarom), esc(x.wie)]), { breedtes: [34, 46, 20] });
}

function goedkeuring(d) {
  const beslissers = d.contacten.filter((c) => c.beslisser);
  const pl = projectleider(d);
  const leeg = "&nbsp;";
  const rijen = [
    ...(beslissers.length ? beslissers.map((c) => ["Opdrachtgever", esc(c.naam), esc(c.rol)]) : [["Opdrachtgever", OPEN, ""]]),
    ["Projectleider", esc(pl?.naam ?? OPEN), esc(pl ? `${pl.rol}, JUICT` : "")],
  ].map((r) => [`<b>${r[0]}</b>`, r[1], r[2], leeg, `<p class="handtekening">${leeg}</p>`]);
  return `<p>Met hun handtekening gaan opdrachtgever en projectleider akkoord met dit plan van aanpak.</p>
${tabel(["Rol", "Naam", "Functie", "Datum", "Handtekening"], rijen, { breedtes: [16, 22, 22, 14, 26] })}`;
}

// Volgorde volgt de kick-off. Een hoofdstuk zonder inhoud valt weg.
export const HOOFDSTUKKEN = [
  ["De eerste stap", "Aanleiding en doel", eersteStap],
  ["Zo werken we samen", "Route en scope", samenwerken],
  ["Vast team", "Team en contactpersonen", vastTeam],
  ["De route in maanden", "Planning", planning],
  ["Fase 0", "Besluiten", (d) => (d.besluiten.length ? fase0(d) : "")],
  ["Jullie aandeel", "Wat jullie aanleveren", (d) => (d.aanleveren.length ? aandeel(d) : "")],
  ["Veilig vanaf dag één", "Informatiebeveiliging", veilig],
  ["Altijd op de hoogte", "Overleg en communicatie", opDeHoogte],
  ["Impact en overgang", "Impact en overgang", impact],
  ["Wat we afspreken", "Afspraken", afspraken],
  ["Uitvoering", "Technische uitvoering en afronding", uitvoering],
  ["Nog te regelen", "Open punten", openPuntenHoofdstuk],
  ["Akkoord", "Goedkeuring", goedkeuring],
];

// --- Document ---

// Word neemt page-break-before van een div over op elke alinea erin; daarom een los pagina-einde.
const PAGINA = `<br clear="all" style="page-break-before: always">`;

const CSS = `
body { font-family: Arial, sans-serif; font-size: 10.5pt; color: #1a1f36; line-height: 1.35; }
p { margin: 0 0 6pt 0; }
h1 { font-family: Arial, sans-serif; font-size: 20pt; color: ${NAVY}; margin: 0 0 10pt 0; }
h2 { font-family: Arial, sans-serif; font-size: 13pt; color: ${NAVY}; margin: 14pt 0 5pt 0; }
.kicker { font-size: 9pt; font-weight: bold; letter-spacing: 1pt; text-transform: uppercase; color: ${PINK}; margin: 0 0 2pt 0; }
.klein { font-size: 8.5pt; color: ${GRIJS}; }
.wit { color: #ffffff; }
.voorblad-titel { font-size: 32pt; font-weight: bold; color: #ffffff; margin: 26pt 0 4pt 0; }
.voorblad-klant { font-size: 18pt; color: #ffffff; margin: 0; }
.voorblad-gegevens { color: ${NAVY}; margin: 0 0 3pt 0; }
.inhoud-titel { font-size: 20pt; font-weight: bold; color: ${NAVY}; margin: 0 0 10pt 0; }
.handtekening { margin: 0; line-height: 40pt; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt 0; }
th { text-align: left; background: ${NAVY}; color: #ffffff; padding: 4pt 5pt; font-size: 9.5pt; font-weight: bold; }
td { border-bottom: 0.5pt solid ${LIJN}; padding: 4pt 5pt; vertical-align: top; font-size: 9.5pt; }
ul { margin: 0 0 6pt 0; }
`;

function voorblad(d, { datum: dat, versie, logo, voorblad: band }) {
  const pl = projectleider(d);
  const project = isTekst(d.projectNaam) ? `${d.projectNaam}, Autotask-project ${d.projectId}` : `Autotask-project ${d.projectId}`;
  return `${band ? `<p style="margin:0"><img src="${esc(band)}" alt="voorblad" width="794" height="448"></p>` : ""}
${logo ? `<p style="margin:0"><img src="${esc(logo)}" alt="JUICT" width="160" height="61"></p>` : ""}
<p class="voorblad-titel">Plan van aanpak</p>
<p class="voorblad-klant">${esc(d.klant.weergave)}</p>
<p class="voorblad-gegevens" style="margin-top: 150pt"><b>${esc(project)}</b></p>
<p class="voorblad-gegevens">Datum: ${esc(datumTekst(dat))}</p>
<p class="voorblad-gegevens">Versie ${esc(versie)}</p>
<p class="voorblad-gegevens">Opgesteld door ${esc(pl ? `${pl.naam}, JUICT` : "JUICT")}</p>`;
}

const vandaag = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

export function pvaHtml(d, { datum: dat = vandaag(), versie = 1, logo, voorblad: band } = {}) {
  const fouten = valideerDossier(d);
  if (fouten.length) throw new Error(`Dossier ongeldig:\n${fouten.join("\n")}`);
  let n = 0;
  const hoofdstukken = HOOFDSTUKKEN.map(([kicker, titel, maak]) => {
    const body = maak(d);
    if (!isTekst(body)) return "";
    n++;
    return `${PAGINA}\n<p class="kicker">${esc(kicker)}</p>\n<h1>${n} ${esc(titel)}</h1>\n${body}\n`;
  }).filter(Boolean);
  const html = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>Mini PVA ${esc(d.klant.weergave)}</title>
<style>${CSS}</style></head>
<body>
${voorblad(d, { datum: dat, versie, logo, voorblad: band })}
${PAGINA}
<p class="kicker">Inhoud</p>
<p class="inhoud-titel">Inhoudsopgave</p>
<p>${MARKER_INHOUD}</p>
${hoofdstukken.join("\n")}
</body></html>
`;
  const problemen = controleerPva(html);
  if (problemen.length) throw new Error(`PVA voldoet niet aan de regels:\n${problemen.join("\n")}`);
  return html;
}

// --- Controle op de uitvoer ---

const tekstVan = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// Zinnen uit een template of instructie ("Voer een impactanalyse uit", "Beschrijf hoe", "Maak een planning").
const INSTRUCTIE = [/\bVoer\b[^.]{0,80}\buit\b/i, /\bBeschrijf\b/i, /\bMaak een\b/i, /\bVul hier\b/i, /\bLorem ipsum\b/i];

export function controleerPva(html) {
  const f = [];
  const tekst = tekstVan(html);
  for (const r of INSTRUCTIE) { const m = tekst.match(r); if (m) f.push(`instructietekst: "${m[0]}"`); }
  for (const t of html.match(/<table\b[\s\S]*?<\/table>/g) ?? []) {
    const body = t.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    if (!/<td\b/.test(body)) f.push("tabel zonder rijen");
  }
  if (/—/.test(tekst)) f.push("em-dash");
  if (/\bBC\b|\bM365\b/.test(tekst)) f.push("verboden afkorting (BC of M365)");
  if (/\braming\b/i.test(tekst)) f.push('"raming" in plaats van "offerte"');
  if (/\bn\.?t\.?b\.?(?=\s|$)/i.test(tekst)) f.push('"n.t.b." in plaats van "nog te plannen"');
  if (/\{\{|\}\}/.test(tekst)) f.push("plaatshouder");
  if (findSecretText(tekst).length) f.push("tekst die op een wachtwoord lijkt");
  return f;
}

// --- CLI ---

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export function main(argv) {
  const pad = optie(argv, "--dossier");
  const uit = optie(argv, "--uit");
  const versie = optie(argv, "--versie") ?? "1";
  const dat = optie(argv, "--datum");
  if (!pad || !uit || !/^[1-9]\d*$/.test(versie) || (dat !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dat))) {
    process.stderr.write(GEBRUIK);
    return 1;
  }
  let d;
  try {
    d = JSON.parse(readFileSync(pad, "utf8"));
  } catch (e) {
    process.stderr.write(`Mislukt: ${e.message}\n`);
    return 2;
  }
  let html;
  try {
    html = pvaHtml(d, {
      datum: dat, versie: Number(versie),
      logo: pathToFileURL(optie(argv, "--logo") ?? LOGO).href,
      voorblad: pathToFileURL(optie(argv, "--voorblad") ?? VOORBLAD).href,
    });
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 1;
  }
  try {
    writeFileSync(uit, html, "utf8");
  } catch (e) {
    process.stderr.write(`Mislukt: ${e.message}\n`);
    return 2;
  }
  process.stdout.write(`Mini PVA (HTML): ${uit}\nMaak de .docx met naar-pva.ps1 -Bron <html> -Doel <docx> [-Pdf <pdf>].\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
