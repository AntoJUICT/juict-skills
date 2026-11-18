#!/usr/bin/env node
// Alleen voor beheerders: zet het Easywork-draaiboek (xlsx, tabblad "Easywork Basic") om naar
// assets/easywork-draaiboek.json. Draai dit opnieuw als het sjabloon of het draaiboek verandert.
// De repo heeft geen npm-dependencies: geef het pad naar een lokale jszip-installatie mee met --jszip.
// De kolom "Verbeteradvies" (interne reviewnotities) gaat nooit mee.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const GEBRUIK = [
  "Gebruik (alleen beheerders):",
  "  draaiboek-naar-json.mjs --xlsx <Easywork_Draaiboek.xlsx> --jszip <pad naar de map jszip> --uit <json> [--datum jjjj-mm-dd]",
  "",
].join("\n");

export const TABBLAD = "Easywork Basic";

// Het projectsjabloon Easywork Basic in Autotask: fases en taaktitels zoals Autotask ze schrijft. Pas dit aan als
// het sjabloon verandert. Een fase of taak uit het draaiboek die hier niet in staat, stopt de conversie.
export const SJABLOON_FASES = [
  "Initiatie- en overdracht fase", "Projectmanagement", "Voorbereidings- en planningsfase", "Realisatie- en uitvoeringsfase",
  "Opleveringsfase", "After sales en administratiefase", "NACALC (Werkzaamheden buiten scope)",
];
export const SJABLOON_TITELS = [
  "Administratieve opstart project", "Projectafstemming met verkoop", "Project opstart", "Diverse projectwerkzaamheden",
  "Tussentijds voortgangsgesprek", "Project afsluitingsgesprek", "Maken Plan van Aanpak", "Aanschaf benodigde hardware en/of software",
  "Huidige documentatie ontvangen", "Licentie plan maken", "Setup Microsoft 365", "Setup standaard applicaties", "Setup Intune",
  "RBAC Opmaken", "Initiële datamigratie", "Mailmigratie Microsoft 365", "Setup netwerk", "Setup telefonie",
  "Distribueren welkomsbrief", "Definitieve datamigratie", "ICT oplevering op locatie", "Telefonie oplevering op locatie",
  "Controle licenties en back-up", "Nazorg project oplevering", "IT Glue updaten", "Administratieve oplevering", "After sales",
  "NACALC (Werkzaamheden buiten scope)", "Ondersteuning bedrijfsapplicaties",
];

// Kolomkoppen (begin van de tekst). "Verbeteradvies" staat er bewust niet in.
const KOLOMMEN = { wbs: "WBS", niveau: "Niveau", omschrijving: "Omschrijving", rol: "Rol", wachtOp: "Wacht op", toelichting: "Toelichting" };

const ontsnap = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&");
const tekstVan = (xml) => ontsnap([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

export function gedeeldeTeksten(xml) {
  return [...String(xml ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => tekstVan(m[1]));
}

const kolomIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// Rijen als lijsten van tekst (lege cel = ""), in de volgorde van het werkblad.
export function leesRijen(sheetXml, gedeeld) {
  const rijen = [];
  for (const r of String(sheetXml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rij = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attr)?.[1];
      const type = /\bt="([^"]+)"/.exec(attr)?.[1];
      const inhoud = c[2] ?? "";
      let waarde = "";
      if (type === "s") waarde = gedeeld[Number(/<v>([\s\S]*?)<\/v>/.exec(inhoud)?.[1])] ?? "";
      else if (type === "inlineStr") waarde = tekstVan(inhoud);
      else waarde = ontsnap(/<v>([\s\S]*?)<\/v>/.exec(inhoud)?.[1] ?? "");
      rij[ref ? kolomIndex(ref) : rij.length] = waarde;
    }
    rijen.push(Array.from(rij, (v) => (v ?? "").trim()));
  }
  return rijen;
}

const normaal = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");

// Schrijfregels van JUICT: geen em-dash en geen afkortingen voor Microsoft 365 en Business Central.
export function schoon(tekst) {
  return String(tekst ?? "")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\bM365\b/g, "Microsoft 365")
    .replace(/\bBC\b/g, "Business Central")
    .replace(/[ \t]+/g, " ")
    .trim();
}
const LEEG = /^[–—-]?$/; // een streepje betekent: niets
const ofNull = (s) => (LEEG.test(String(s ?? "").trim()) ? null : schoon(s));
const zonderTeken = (s) => String(s).replace(/^\s*[•–—\-*]\s*/, "");

// Zet de rijen om. Een fase is een rij "FASE n ..." zonder niveau; daaronder Taak, Sub-punt en Kindpunt.
export function draaiboekUitRijen(rijen, { bron, datum } = {}) {
  const kopIndex = rijen.findIndex((r) => r.includes(KOLOMMEN.wbs) && r.includes(KOLOMMEN.omschrijving));
  if (kopIndex < 0) throw new Error(`Kopregel met "${KOLOMMEN.wbs}" en "${KOLOMMEN.omschrijving}" niet gevonden.`);
  const kop = rijen[kopIndex];
  const k = Object.fromEntries(Object.entries(KOLOMMEN).map(([sleutel, naam]) => [sleutel, kop.findIndex((c) => normaal(c).startsWith(normaal(naam)))]));
  for (const [sleutel, i] of Object.entries(k)) if (i < 0) throw new Error(`Kolom "${KOLOMMEN[sleutel]}" ontbreekt.`);
  const cel = (r, sleutel) => String(r[k[sleutel]] ?? "").trim();

  const taken = [];
  let fase = null;
  let taak = null;
  let punt = null;
  for (const r of rijen.slice(kopIndex + 1)) {
    const wbs = cel(r, "wbs");
    const niveau = normaal(cel(r, "niveau"));
    const omschrijving = cel(r, "omschrijving");
    // Een faserij is een samengevoegde cel: de tekst staat in de eerste kolom.
    const eerste = r.find((c) => String(c ?? "").trim()) ?? "";
    if (!niveau && /^fase\s*\d+/i.test(eerste)) {
      // "FASE 4, REALISATIE- EN UITVOERINGSFASE (8 taken)": de schrijfwijze van de fase komt uit het sjabloon.
      const kaal = eerste.replace(/^fase\s*\d+\s*[–—:-]?\s*/i, "").replace(/\(\s*\d+\s*taken\s*\)\s*$/i, "");
      fase = SJABLOON_FASES.find((f) => normaal(f) === normaal(kaal));
      if (!fase) throw new Error(`Fase "${eerste}" staat niet in het sjabloon Easywork Basic (SJABLOON_FASES).`);
      taak = null;
      punt = null;
      continue;
    }
    if (!omschrijving) continue;
    if (niveau === "taak") {
      if (!fase) throw new Error(`Taak "${omschrijving}" staat niet onder een fase.`);
      const titel = schoon(zonderTeken(omschrijving));
      const sjabloon = SJABLOON_TITELS.find((t) => normaal(t) === normaal(titel));
      if (!sjabloon) throw new Error(`Taak "${titel}" staat niet in het sjabloon Easywork Basic (SJABLOON_TITELS).`);
      taak = {
        wbs, fase, titel, ...(sjabloon !== titel ? { autotaskTitel: sjabloon } : {}),
        rol: ofNull(cel(r, "rol")), wachtOp: ofNull(cel(r, "wachtOp")), toelichting: ofNull(cel(r, "toelichting")), punten: [],
      };
      taken.push(taak);
      punt = null;
    } else if (niveau === "sub-punt" || niveau === "subpunt") {
      if (!taak) throw new Error(`Sub-punt "${omschrijving}" staat niet onder een taak.`);
      punt = { tekst: schoon(zonderTeken(omschrijving)), rol: ofNull(cel(r, "rol")), toelichting: ofNull(cel(r, "toelichting")), kinderen: [] };
      taak.punten.push(punt);
    } else if (niveau === "kindpunt") {
      if (!punt) throw new Error(`Kindpunt "${omschrijving}" staat niet onder een sub-punt.`);
      punt.kinderen.push({ tekst: schoon(zonderTeken(omschrijving)), rol: ofNull(cel(r, "rol")), toelichting: ofNull(cel(r, "toelichting")) });
    }
  }
  const ontbreekt = SJABLOON_TITELS.filter((t) => !taken.some((x) => (x.autotaskTitel ?? x.titel) === t));
  if (ontbreekt.length) throw new Error(`Sjabloontaken niet in het draaiboek: ${ontbreekt.join("; ")}.`);
  return { bron: bron ?? `Easywork_Draaiboek.xlsx, tabblad ${TABBLAD}`, sjabloon: "Easywork Basic", datum: datum ?? null, taken };
}

export async function leesXlsx(buffer, JSZip) {
  const zip = await JSZip.loadAsync(buffer);
  const lees = (pad) => zip.file(pad)?.async("string");
  const werkboek = await lees("xl/workbook.xml");
  const rels = await lees("xl/_rels/workbook.xml.rels");
  const blad = [...werkboek.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((s) => ontsnap(/name="([^"]*)"/.exec(s)?.[1] ?? "") === TABBLAD);
  if (!blad) throw new Error(`Tabblad "${TABBLAD}" niet gevonden.`);
  const rid = /r:id="([^"]+)"/.exec(blad)[1];
  const rel = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(rels)?.[0];
  const pad = "xl/" + /Target="([^"]+)"/.exec(rel)[1].replace(/^\/?xl\//, "");
  const rijen = leesRijen(await lees(pad), gedeeldeTeksten(await lees("xl/sharedStrings.xml")));
  // Versie van het draaiboek: de laatste wijzigingsdatum uit de documenteigenschappen.
  const datum = /<dcterms:modified[^>]*>(\d{4}-\d{2}-\d{2})/.exec((await lees("docProps/core.xml")) ?? "")?.[1] ?? null;
  return { rijen, datum };
}

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export async function hoofd(argv) {
  const xlsx = optie(argv, "--xlsx");
  const jszip = optie(argv, "--jszip");
  const uit = optie(argv, "--uit");
  if (!xlsx || !jszip || !uit) return { code: 1, uitvoer: GEBRUIK };
  try {
    // --jszip is de map van het pakket zelf (…/node_modules/jszip).
    const JSZip = createRequire(pathToFileURL(jszip.replace(/[\\/]+$/, "") + "/").href)("./");
    const { rijen, datum } = await leesXlsx(readFileSync(xlsx), JSZip);
    const draaiboek = draaiboekUitRijen(rijen, { datum: optie(argv, "--datum") ?? datum });
    writeFileSync(uit, JSON.stringify(draaiboek, null, 2) + "\n", "utf8");
    const punten = draaiboek.taken.reduce((n, t) => n + t.punten.length, 0);
    return { code: 0, uitvoer: `${draaiboek.taken.length} taken en ${punten} sub-punten naar ${uit}.\n` };
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
