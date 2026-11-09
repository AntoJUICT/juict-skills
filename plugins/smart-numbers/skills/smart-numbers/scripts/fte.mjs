// FTE per rol (SMART Numbers items 3-9) uit de medewerkerdossiers van het intranet.
// Gebruik: node fte.mjs JJJJ-MM <dossier.json> [<dossier.json> ...]
// Een dossier is het antwoord van de intranet-MCP-tool `medewerker_ophalen`, als JSON-bestand.
// De rolverdeling per e-mailadres staat in de directie-vault: `rolverdeling` in config.json.
// De uitvoer bevat alleen tellingen, e-mailadressen, rollen en uren, nooit loon of andere persoonsgegevens.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configPad, laadConfig } from "./bereken.mjs";

export const ROLLEN = ["support_desk", "professional_services", "alignment", "centralized", "vcio", "other_technical"];
const GELDIG = new Set([...ROLLEN, "niet_technisch", "telt_niet"]);

export const rondKwart = (fte) => Math.round(fte * 4) / 4;

// Laatste dag van de maand, als UTC-tijdstempel aan het eind van die dag.
export function maandEinde(y, m) { return Date.UTC(y, m, 1) - 1; }
const datum = (s) => (s ? Date.parse(s) : null);

// Eén dossier naar een regel: wie, welke uren, telt hij mee en waarom niet.
export function leesDossier(dossier, rolverdeling, einde) {
  const p = dossier.profiel || {};
  const s = dossier.salarisregel || {};
  const email = (p.email || "").toLowerCase();
  const rol = rolverdeling[email];
  const uren = typeof p.werkweek === "number" ? p.werkweek : s.urenPerWeek;
  const r = { email, rol: rol ?? null, uren: uren ?? null, eigenaar: s.isManagementFee === true, telt: false, reden: null };
  if (typeof s.urenPerWeek === "number" && typeof p.werkweek === "number" && s.urenPerWeek !== p.werkweek) {
    r.afwijkingSalarisregel = s.urenPerWeek;
  }
  const start = datum(p.startdatum), uit = datum(p.uitDienstDatum);
  if (start !== null && start > einde) return { ...r, reden: "niet in dienst (start na de maand)" };
  if (uit !== null && uit < einde) return { ...r, reden: "niet in dienst (uit dienst voor eind van de maand)" };
  if (s.isStagevergoeding === true) return { ...r, reden: "stagiair" };
  if (rol === "telt_niet") return { ...r, reden: "telt niet (rolverdeling)" };
  if (rol === undefined) return { ...r, reden: "geen rol in rolverdeling" };
  if (!GELDIG.has(rol)) return { ...r, reden: `onbekende rol "${rol}"` };
  if (typeof uren !== "number") return { ...r, reden: "geen uren in profiel of salarisregel" };
  return { ...r, telt: true };
}

export function berekenFte(dossiers, rolverdeling, y, m) {
  const einde = maandEinde(y, m);
  const rv = Object.fromEntries(Object.entries(rolverdeling).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k.toLowerCase(), v]));
  const regels = dossiers.map((d) => leesDossier(d, rv, einde));
  const uren = Object.fromEntries(ROLLEN.map((r) => [r, 0]));
  let totaal = 0;
  for (const r of regels.filter((x) => x.telt)) {
    totaal += r.uren;
    // Een eigenaar telt alleen in een technische rol als de rolverdeling dat zo zegt.
    if (ROLLEN.includes(r.rol)) uren[r.rol] += r.uren;
  }
  const fte = Object.fromEntries(ROLLEN.map((r) => [r, rondKwart(uren[r] / 40)]));
  const signalen = {
    zonderRol: regels.filter((r) => r.reden === "geen rol in rolverdeling").map((r) => r.email),
    onbekendeRol: regels.filter((r) => r.reden?.startsWith("onbekende rol")).map((r) => r.email),
    zonderUren: regels.filter((r) => r.reden === "geen uren in profiel of salarisregel").map((r) => r.email),
    afwijkingSalarisregel: regels.filter((r) => r.afwijkingSalarisregel !== undefined).map((r) => ({ email: r.email, werkweek: r.uren, salarisregel: r.afwijkingSalarisregel })),
    // In de rolverdeling maar geen dossier opgehaald: vergeten op te halen of uit dienst.
    nietOpgehaald: Object.keys(rv).filter((e) => rv[e] !== "telt_niet" && !regels.some((r) => r.email === e)),
  };
  return { totaal: { uren: totaal, fte: rondKwart(totaal / 40) }, uren, fte, signalen, regels };
}

function main() {
  const [maand, ...bestanden] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}$/.test(maand || "") || bestanden.length === 0) {
    console.error("Gebruik: node fte.mjs JJJJ-MM <dossier.json> [<dossier.json> ...]");
    process.exit(1);
  }
  const C = laadConfig(configPad());
  if (!C.rolverdeling) throw new Error("Geen `rolverdeling` in config.json; leg die eerst vast in de directie-vault.");
  const dossiers = bestanden.map((f) => JSON.parse(readFileSync(f, "utf-8")));
  const [y, m] = maand.split("-").map(Number);
  const uit = berekenFte(dossiers, C.rolverdeling, y, m);
  // Alleen e-mail, rol, uren en reden: geen loon of andere dossiergegevens.
  uit.regels = uit.regels.map(({ email, rol, uren, eigenaar, telt, reden }) => ({ email, rol, uren, eigenaar, telt, reden }));
  console.log(JSON.stringify({ maand, ...uit }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
