#!/usr/bin/env node
// Het dossier: de enige bron waaruit presentatie, PVA en notities worden gemaakt.
// De stand staat als bijlage `projectstart-dossier-v<N>.json` op het Autotask-project.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { haalCredentials, maakAt, normaliseerTitel } from "../../it-inventarisatie/scripts/autotask-project.mjs";
import { scrubSecrets, findSecretText, isSecretKey } from "../../it-inventarisatie/scripts/geheimen.mjs";

const GEBRUIK = [
  "Gebruik:",
  "  dossier.mjs controleer <pad>",
  "  dossier.mjs laad --project <id> --uit <pad>",
  "  dossier.mjs bewaar --project <id> --dossier <pad> [--toepassen]",
  "  dossier.mjs nieuw --dossier <pad> --bronnen <bronnen.json>",
  "Zonder --toepassen schrijft bewaar niets naar Autotask; je krijgt alleen een voorvertoning.",
  "",
].join("\n");

const BESTAND = /^projectstart-dossier-v(\d+)\.json$/;
const naamVoorVersie = (n) => `projectstart-dossier-v${n}.json`;
const eerste = (antwoord) => antwoord?.item ?? antwoord?.items?.[0] ?? null;

// --- Validatie ---

const isTekst = (v) => typeof v === "string" && v.trim() !== "";
const isTekstOfNull = (v) => v === null || isTekst(v);
const isLijst = (v) => Array.isArray(v);
const JJJJ_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

function controleerVorm(d, f) {
  const eis = (pad, ok, tekst) => { if (!ok) f.push(`${pad}: ${tekst}`); };
  const rij = (pad, lijst, regels) => {
    if (!isLijst(lijst)) return f.push(`${pad}: lijst verplicht`);
    lijst.forEach((r, i) => {
      if (!r || typeof r !== "object") return f.push(`${pad}[${i}]: object verplicht`);
      for (const [veld, ok, tekst] of regels) eis(`${pad}[${i}].${veld}`, ok(r[veld]), tekst);
    });
  };
  const t = (veld) => [veld, isTekst, "verplicht"];
  const tn = (veld) => [veld, isTekstOfNull, "tekst of null verplicht"];
  const b = (veld) => [veld, (v) => typeof v === "boolean", "true of false verplicht"];

  eis("schema", d.schema === 1, "moet 1 zijn");
  eis("projectId", Number.isInteger(d.projectId), "geheel getal verplicht");
  eis("companyId", Number.isInteger(d.companyId), "geheel getal verplicht");
  eis("klant.autotask", isTekst(d.klant?.autotask), "verplicht");
  eis("klant.weergave", isTekst(d.klant?.weergave), "verplicht");
  rij("contacten", d.contacten, [t("naam"), t("rol"), t("organisatie"), b("beslisser"), b("aanspreekpunt"), ["mail", (v) => v === undefined || v === null || (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)), "geldig e-mailadres of null verplicht"]]);
  rij("team", d.team, [t("naam"), t("rol")]);
  eis("doel", isTekst(d.doel), "verplicht");
  eis("hardeDatum.datum", isTekst(d.hardeDatum?.datum), "verplicht");
  eis("hardeDatum.watKlaar", isTekst(d.hardeDatum?.watKlaar), "verplicht");
  eis("hardeDatum.watNiet", isTekst(d.hardeDatum?.watNiet), "verplicht");
  eis("scope.inbegrepen", isLijst(d.scope?.inbegrepen), "lijst verplicht");
  eis("scope.buiten", isLijst(d.scope?.buiten), "lijst verplicht");
  if (!isLijst(d.fases) || d.fases.length < 1) f.push("fases: minimaal 1 fase verplicht");
  else {
    rij("fases", d.fases, [
      t("code"), t("naam"),
      ["route", (v) => v === "01" || v === "02", 'moet "01" of "02" zijn'],
      ["start", (v) => typeof v === "string" && JJJJ_MM.test(v), "formaat jjjj-mm verplicht"],
      ["eind", (v) => typeof v === "string" && JJJJ_MM.test(v), "formaat jjjj-mm verplicht"],
      // Uren uit de offerte voor deze fase (optioneel). Alleen als ze er staan, telt de som van de taken.
      ["uren", (v) => v === undefined || v === null || isUren(v), "getal vanaf 0 of null verplicht"],
    ]);
    d.fases.forEach((fase, i) => {
      if (JJJJ_MM.test(fase?.start ?? "") && JJJJ_MM.test(fase?.eind ?? "") && fase.start > fase.eind) {
        f.push(`fases[${i}]: start (${fase.start}) ligt na eind (${fase.eind})`);
      }
    });
  }
  const optTn = (veld) => [veld, (v) => v === undefined || isTekstOfNull(v), "tekst of null verplicht"];
  rij("besluiten", d.besluiten, [t("vraag"), tn("beslisser"), tn("uiterlijk"), t("alsNiet"), optTn("besluit"), optTn("bron")]);
  rij("aanleveren", d.aanleveren, [t("wat"), tn("wie"), tn("datum"), tn("tijd")]);
  const optB = (veld) => [veld, (v) => v === undefined || typeof v === "boolean", "true of false verplicht"];
  rij("afspraken", d.afspraken, [t("tekst"), b("intern"), t("bron"), optB("financieel"), optB("controleren")]);
  if (isLijst(d.afspraken)) d.afspraken.forEach((a, i) => {
    if (a?.controleren === true && a?.financieel !== true) f.push(`afspraken[${i}].controleren: alleen voor een financiële afspraak (financieel: true)`);
  });
  rij("technischeVragen", d.technischeVragen, [t("vraag"), t("aan"), t("bron")]);
  rij("extraOnderwerpen", d.extraOnderwerpen, [
    ["soort", (v) => v === "beveiliging", 'moet "beveiliging" zijn'],
    ["geregeld", isLijst, "lijst verplicht"], ["controleren", isLijst, "lijst verplicht"], ["later", isLijst, "lijst verplicht"],
    ["optioneel", (v) => v === undefined || typeof v === "boolean", "true of false verplicht"],
  ]);
  if (d.taken !== undefined) controleerTaken(d, f, rij);
  if (d.meerwerk !== undefined) rij("meerwerk", d.meerwerk, [t("wat"), t("bron")]);
  eis("overleg.ritme", isTekst(d.overleg?.ritme), "verplicht");
  eis("overleg.aanspreekpunt", isTekst(d.overleg?.aanspreekpunt), "verplicht");
  eis("overleg.escalatie", isTekst(d.overleg?.escalatie), "verplicht");
  // Optioneel voor de kick-off: afwezig of null betekent "nog open" en blijft zichtbaar open.
  const optioneel = (pad, waarde, ok, tekst) => { if (waarde !== undefined) eis(pad, ok(waarde), tekst); };
  optioneel("kickoffDatum", d.kickoffDatum, isTekstOfNull, "tekst of null verplicht");
  optioneel("vervolgOfferte", d.vervolgOfferte, isTekstOfNull, "tekst of null verplicht");
  optioneel("projectNaam", d.projectNaam, isTekstOfNull, "tekst of null verplicht");
  // Bron van een bevestigd feit (mail met datum, "kick-off <datum>"). Zonder bron is het een uitgangspunt.
  optioneel("doelBron", d.doelBron, isTekstOfNull, "tekst of null verplicht");
  optioneel("hardeDatum.bron", d.hardeDatum?.bron, isTekstOfNull, "tekst of null verplicht");
  if (d.migratieplan !== undefined) {
    const mp = d.migratieplan;
    if (!mp || typeof mp !== "object" || Array.isArray(mp)) f.push("migratieplan: object met datum verplicht");
    else eis("migratieplan.datum", isTekstOfNull(mp.datum), "tekst of null verplicht");
  }
  if (d.externePartijen !== undefined) rij("externePartijen", d.externePartijen, [t("naam"), t("rol"), tn("aangestuurdDoor")]);
  optioneel("overleg.volgende", d.overleg?.volgende, isTekstOfNull, "tekst of null verplicht");
  optioneel("overleg.verzoekenControle", d.overleg?.verzoekenControle, isTekstOfNull, "tekst of null verplicht");
  optioneel("overleg.kanaal", d.overleg?.kanaal, isTekstOfNull, "tekst of null verplicht");
  optioneel("gebruikersimpact", d.gebruikersimpact, isTekstOfNull, "tekst of null verplicht");
  optioneel("overgangBeheer", d.overgangBeheer, isTekstOfNull, "tekst of null verplicht");
  eis("artifacts.presentatie", isTekstOfNull(d.artifacts?.presentatie), "url of null verplicht");
  eis("artifacts.rapport", isTekstOfNull(d.artifacts?.rapport), "url of null verplicht");
  eis("verwerkt.bijlagen", isLijst(d.verwerkt?.bijlagen), "lijst verplicht");
  eis("verwerkt.notities", isLijst(d.verwerkt?.notities), "lijst verplicht");
  eis("versie", Number.isInteger(d.versie) && d.versie >= 1, "geheel getal verplicht");
}

const isUren = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

// Technische taken voor de engineers: elk met een bron, uren alleen uit de offerte en per fase nooit meer dan daar staat.
function controleerTaken(d, f, rij) {
  const codes = new Set((isLijst(d.fases) ? d.fases : []).map((x) => x?.code));
  rij("taken", d.taken, [
    ["titel", isTekst, "verplicht"], ["fase", isTekst, "verplicht (titel van de fase in Autotask)"],
    ["omschrijving", isTekst, "verplicht"], ["bron", isTekst, "verplicht (offerte of mail met datum)"],
    ["uren", (v) => v === null || isUren(v), "getal vanaf 0 of null verplicht"],
    ["resultaat", (v) => v === undefined || isTekstOfNull(v), "tekst of null verplicht"],
    ["projectFase", (v) => v === undefined || v === null || codes.has(v), "moet een code uit fases zijn"],
  ]);
  if (!isLijst(d.taken)) return;
  const gezien = new Map();
  d.taken.forEach((t, i) => {
    if (!isTekst(t?.titel)) return;
    const sleutel = normaliseerTitel(t.titel);
    if (gezien.has(sleutel)) f.push(`taken[${i}].titel: dubbel, zelfde titel als taken[${gezien.get(sleutel)}]`);
    else gezien.set(sleutel, i);
  });
  for (const fase of isLijst(d.fases) ? d.fases : []) {
    if (!isUren(fase?.uren)) continue;
    const som = d.taken.filter((t) => t?.projectFase === fase.code && isUren(t.uren)).reduce((s, t) => s + t.uren, 0);
    if (som > fase.uren + 1e-9) f.push(`taken: de uren voor fase ${fase.code} (${som}) zijn meer dan in de offerte (${fase.uren})`);
  }
}

// Alle tekstvelden met hun pad, bv. "afspraken[0].tekst".
function tekstvelden(waarde, pad = "", uit = []) {
  if (typeof waarde === "string") uit.push([pad, waarde]);
  else if (Array.isArray(waarde)) waarde.forEach((v, i) => tekstvelden(v, `${pad}[${i}]`, uit));
  else if (waarde && typeof waarde === "object") {
    for (const [k, v] of Object.entries(waarde)) tekstvelden(v, pad ? `${pad}.${k}` : k, uit);
  }
  return uit;
}

function geheimeSleutels(waarde, pad = "", uit = []) {
  if (Array.isArray(waarde)) waarde.forEach((v, i) => geheimeSleutels(v, `${pad}[${i}]`, uit));
  else if (waarde && typeof waarde === "object") {
    for (const [k, v] of Object.entries(waarde)) {
      const p = pad ? `${pad}.${k}` : k;
      if (isSecretKey(k)) uit.push(`${p}: geheime sleutelnaam niet toegestaan`);
      else geheimeSleutels(v, p, uit);
    }
  }
  return uit;
}

const INTERN_TEKST = /^afspraken\[(\d+)\]\.tekst$/;

// Een bedrag: €, euro, euro's, EUR of een prijs als "500,-". Gedeeld met het vangnet van de uitvraag-mail.
export const isBedrag = (tekst) => /€|\beur(o|o's)?\b|\bEUR\b/i.test(tekst) || /\d+,-/.test(tekst);

export function valideerDossier(d) {
  const f = [];
  if (!d || typeof d !== "object") return ["dossier: object verplicht"];
  controleerVorm(d, f);
  for (const [pad, tekst] of tekstvelden(d)) {
    if (/—/.test(tekst)) f.push(`${pad}: em-dash niet toegestaan`);
    if (/\bBC\b|\bM365\b/.test(tekst)) f.push(`${pad}: verboden afkorting (BC of M365)`);
    if (/\bMFA\b/.test(tekst) && !/multifactor/i.test(tekst)) f.push(`${pad}: MFA zonder dat het voluit staat`);
    const m = INTERN_TEKST.exec(pad);
    const intern = m && d.afspraken?.[Number(m[1])]?.intern === true;
    if (!intern && isBedrag(tekst)) f.push(`${pad}: bedrag in klantgerichte tekst`);
  }
  f.push(...geheimeSleutels(d));
  for (const pad of findSecretText(d)) f.push(`${pad}: lijkt een geheim te bevatten`);
  return f;
}

// --- Bronnen ---

// De eigen uitvoer van de skill (dossierbijlagen, Mini PVA, Word-rapport, notities "Projectstart: ...") is geen bron.
const PVA_BESTAND = /^(Mini PVA|IT-inventarisatie) .* v\d+\.docx$/;
const isEigenBijlage = (b) => [b.titel, String(b.bestand ?? "").split("/").pop().replace(/^\d+-/, "")]
  .some((naam) => BESTAND.test(String(naam ?? "")) || PVA_BESTAND.test(String(naam ?? "")));
const isEigenNotitie = (n) => /^Projectstart:/.test(String(n.titel ?? "").trim());

export function nieuweBronnen(d, manifest) {
  const bijlagen = new Set(d.verwerkt?.bijlagen ?? []);
  const notities = new Set(d.verwerkt?.notities ?? []);
  return {
    bijlagen: (manifest.bijlagen ?? []).filter((b) => !bijlagen.has(b.id) && !isEigenBijlage(b)),
    notities: (manifest.notities ?? []).filter((n) => !notities.has(n.id) && !isEigenNotitie(n)),
  };
}

// --- Stand in Autotask ---

const basisnaam = (p) => String(p ?? "").split(/[\\/]/).pop();

export async function laadStand(at, projectId) {
  const lijst = (await at.get(`Projects/${projectId}/Attachments`)).items ?? [];
  let beste = null;
  for (const rij of lijst) {
    const m = BESTAND.exec(basisnaam(rij.fullPath)) ?? BESTAND.exec(basisnaam(rij.title));
    if (m && (!beste || Number(m[1]) > beste.versie)) beste = { versie: Number(m[1]), id: rij.id };
  }
  if (!beste) return null;
  const volledig = eerste(await at.getProjectAttachment(projectId, beste.id));
  if (!volledig?.data) throw new Error(`Dossierbijlage ${beste.id} bevat geen inhoud.`);
  const dossier = JSON.parse(Buffer.from(volledig.data, "base64").toString("utf8"));
  return { dossier, versie: beste.versie };
}

function canoniek(waarde) {
  if (Array.isArray(waarde)) return waarde.map(canoniek);
  if (waarde && typeof waarde === "object") {
    return Object.fromEntries(Object.keys(waarde).sort().map((k) => [k, canoniek(waarde[k])]));
  }
  return waarde;
}
const zonderVersie = (d) => JSON.stringify(canoniek((({ versie, ...rest }) => rest)(d)));

export async function bewaarStand(at, projectId, dossier, { toepassen = false } = {}) {
  const fouten = valideerDossier(dossier);
  if (fouten.length) throw new Error(`Dossier is niet geldig:\n${fouten.join("\n")}`);
  const schoon = scrubSecrets(dossier); // tweede vangnet vlak voor het uploaden
  const stand = await laadStand(at, projectId);
  if (stand && zonderVersie(stand.dossier) === zonderVersie(schoon)) {
    return { voorvertoning: `Geen wijziging ten opzichte van ${naamVoorVersie(stand.versie)}; er wordt niets geschreven.` };
  }
  const nieuw = (stand?.versie ?? 0) + 1;
  const naam = naamVoorVersie(nieuw);
  const voorvertoning = `Voorvertoning: bijlage ${naam} op project ${projectId}${stand ? ` (inhoud anders dan v${stand.versie})` : " (eerste stand)"}.`;
  if (!toepassen) return { voorvertoning: `${voorvertoning}\nEr is niets geschreven; draai opnieuw met --toepassen na akkoord.` };
  const data = Buffer.from(JSON.stringify({ ...schoon, versie: nieuw }, null, 2) + "\n", "utf8").toString("base64");
  await at.postProjectAttachment(projectId, {
    parentID: Number(projectId), attachmentType: "FILE_ATTACHMENT",
    publish: 2, // intern projectteam; bevestigen in de proefrun
    title: naam, fullPath: naam, data,
  });
  return { voorvertoning, bijlage: naam };
}

// --- CLI ---

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export async function hoofd(argv, deps = {}) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "controleer" && rest[0]) {
      const fouten = valideerDossier(JSON.parse(readFileSync(rest[0], "utf8")));
      return fouten.length
        ? { code: 1, uitvoer: fouten.join("\n") + "\n" }
        : { code: 0, uitvoer: "Dossier is geldig.\n" };
    }
    if (cmd === "nieuw" && optie(rest, "--dossier") && optie(rest, "--bronnen")) {
      const lees = (p) => JSON.parse(readFileSync(p, "utf8"));
      const n = nieuweBronnen(lees(optie(rest, "--dossier")), lees(optie(rest, "--bronnen")));
      // Alleen id, titel en bestand: de inhoud blijft op schijf.
      const uit = {
        aantal: n.bijlagen.length + n.notities.length,
        bijlagen: n.bijlagen.map(({ id, titel, bestand, datum }) => ({ id, titel, bestand, datum })),
        notities: n.notities.map(({ id, titel, datum }) => ({ id, titel, datum })),
      };
      return { code: 0, uitvoer: JSON.stringify(uit, null, 2) + "\n" };
    }
    const project = optie(rest, "--project");
    if ((cmd === "laad" || cmd === "bewaar") && project && /^\d+$/.test(project)) {
      const at = deps.at ?? maakAt({ fetch: deps.fetch, creds: haalCredentials() });
      if (cmd === "laad") {
        const uit = optie(rest, "--uit");
        if (!uit) return { code: 1, uitvoer: GEBRUIK };
        const stand = await laadStand(at, Number(project));
        if (!stand) return { code: 0, uitvoer: `Nog geen dossier op project ${project}.\n` };
        mkdirSync(dirname(uit), { recursive: true });
        writeFileSync(uit, JSON.stringify(stand.dossier, null, 2) + "\n", "utf8");
        return { code: 0, uitvoer: `Dossier v${stand.versie} opgeslagen in ${uit}.\n` };
      }
      const pad = optie(rest, "--dossier");
      if (!pad) return { code: 1, uitvoer: GEBRUIK };
      const r = await bewaarStand(at, Number(project), JSON.parse(readFileSync(pad, "utf8")), { toepassen: rest.includes("--toepassen") });
      return { code: 0, uitvoer: r.voorvertoning + (r.bijlage ? `\nGeplaatst: ${r.bijlage}` : "") + "\n" };
    }
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
  return { code: 1, uitvoer: GEBRUIK };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
