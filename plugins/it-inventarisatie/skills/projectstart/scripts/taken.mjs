#!/usr/bin/env node
// Technische taken uit het dossier naar plan.json, zodat autotask-schrijf.mjs ze op het project zet.
// Alleen technische taken (projectmanagement, administratie en sales zet de projectleider zelf klaar).
// Elke taak komt uit de offerte of een mail (bron); uren alleen uit de offerte. Schrijft nooit naar Autotask.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { valideerDossier } from "./dossier.mjs";

export const MAX_OMSCHRIJVING = 8000; // Task.description, zone 19

const GEBRUIK = [
  "Gebruik:",
  "  taken.mjs --dossier <pad> [--plan <pad>]",
  "Zonder --plan alleen tonen. Met --plan komen de taken in dat plan (bestaande taken in het plan worden vervangen)",
  "voor autotask-schrijf.mjs. Er wordt niets in Autotask geschreven.",
  "",
].join("\n");

// Omschrijving van de taak in Autotask: wat er moet gebeuren, wat er daarna is en waar het vandaan komt.
export function taakOmschrijving(t) {
  const staart = [
    ...(typeof t.resultaat === "string" && t.resultaat.trim() ? [`Resultaat: ${t.resultaat.trim()}`] : []),
    `Bron: ${String(t.bron).trim()}`,
  ].join("\n");
  const ruimte = MAX_OMSCHRIJVING - staart.length - 2;
  let tekst = String(t.omschrijving).trim();
  if (tekst.length > ruimte) tekst = tekst.slice(0, ruimte - 4).trimEnd() + " ...";
  return `${tekst}\n\n${staart}`;
}

export function takenVoorPlan(d) {
  const fouten = valideerDossier(d);
  if (fouten.length) throw new Error(`Dossier is niet geldig:\n${fouten.join("\n")}`);
  return (d.taken ?? []).map((t) => ({ titel: t.titel.trim(), fase: t.fase.trim(), uren: t.uren, omschrijving: taakOmschrijving(t) }));
}

// Het dossier is de bron: de taken in het plan worden in zijn geheel vervangen.
export function voegTakenToe(plan, taken) {
  return { ...plan, notities: plan.notities ?? [], bijlagen: plan.bijlagen ?? [], taken };
}

export const urenTekst = (u) => (u === null || u === undefined ? "uren nog te bepalen" : `${String(u).replace(".", ",")} uur`);

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export function hoofd(argv, deps = {}) {
  const lees = deps.lees ?? ((pad) => readFileSync(pad, "utf8"));
  const bestaat = deps.bestaat ?? existsSync;
  const schrijf = deps.schrijf ?? ((pad, tekst) => writeFileSync(pad, tekst, "utf8"));
  const dossierPad = optie(argv, "--dossier");
  if (!dossierPad) return { code: 1, uitvoer: GEBRUIK };
  let taken;
  try {
    taken = takenVoorPlan(JSON.parse(lees(dossierPad)));
  } catch (e) {
    return { code: /niet geldig/.test(e.message) ? 1 : 2, uitvoer: `${e.message}\n` };
  }
  const regels = [`${taken.length} technische taken uit het dossier:`];
  for (const t of taken) regels.push(`- ${t.titel} (${t.fase}, ${urenTekst(t.uren)})`);
  const planPad = optie(argv, "--plan");
  if (!planPad) {
    regels.push("", ...taken.flatMap((t) => [`${t.titel}:`, t.omschrijving, ""]));
    return { code: 0, uitvoer: regels.join("\n").trimEnd() + "\n" };
  }
  try {
    const plan = voegTakenToe(bestaat(planPad) ? JSON.parse(lees(planPad)) : {}, taken);
    schrijf(planPad, JSON.stringify(plan, null, 2) + "\n");
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
  regels.push("", `Toegevoegd aan ${planPad}. Zet ze op het project met autotask-schrijf.mjs (eerst de voorvertoning).`);
  return { code: 0, uitvoer: regels.join("\n") + "\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
