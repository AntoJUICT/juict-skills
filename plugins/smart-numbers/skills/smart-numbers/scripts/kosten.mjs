// Kosten (SMART Numbers items 32-37) uit de W&V per grootboekrekening van het intranet.
// Gebruik: node kosten.mjs <grootboek.json> [<bereken.json>]
// - grootboek.json: het antwoord van de intranet-MCP-tool `exact_grootboek` voor één maand.
// - bereken.json: de uitvoer van `bereken.mjs JJJJ-MM --json`, voor het licentiedeel dat van
//   MRR Tools COGS naar ORR COGS schuift (zelfde bedrag als de omzetverschuiving).
// De indeling per rekening staat in de directie-vault: `kosten` in config.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configPad, laadConfig } from "./bereken.mjs";

export const POSTEN = ["EMP", "OC", "PCOGS", "MTCOGS", "ORRCOGS", "OTH"];
const LIJSTEN = ["EMP", "PCOGS", "MTCOGS", "ORRCOGS", "MISC", "NIET"];
const r2 = (n) => Math.round(n * 100) / 100;

/** Rekeningcode naar post: een lijst uit de config, omzet (8xxx) apart, anders OTH. */
export function postVan(code, indeling) {
  for (const p of LIJSTEN) if ((indeling[p] || []).includes(code)) return p;
  if (/^8/.test(code)) return "OMZET";
  return "OTH";
}

export function berekenKosten(grootboek, indeling, licentieNaarOrr = 0) {
  if (!grootboek?.maanden || grootboek.maanden.length !== 1) {
    throw new Error("Geef het grootboek van precies één maand (exact_grootboek met alleen van).");
  }
  const { maand, rekeningen } = grootboek.maanden[0];
  const posten = Object.fromEntries(POSTEN.map((p) => [p, 0]));
  const perPost = {};
  let miscOpbrengst = 0;
  const signalen = { beoordelen: [], licentieGroterDanMtcogs: false };
  for (const r of rekeningen) {
    const post = postVan(r.code, indeling);
    (perPost[post] ||= []).push({ code: r.code, omschrijving: r.omschrijving, bedrag: r.bedrag });
    if (post === "OMZET" || post === "NIET") continue;
    if (post === "MISC") { miscOpbrengst -= r.bedrag; continue; } // credit (negatief) = opbrengst
    posten[post] += r.bedrag;
    // Een inkooprekening (7xxx) die nergens is ingedeeld valt in OTH; laat hem beoordelen.
    if (post === "OTH" && /^7/.test(r.code) && !(indeling.OTH || []).includes(r.code)) {
      signalen.beoordelen.push({ code: r.code, omschrijving: r.omschrijving, bedrag: r.bedrag });
    }
  }
  if (indeling.licentieVanMtcogsNaarOrrcogs && licentieNaarOrr) {
    if (licentieNaarOrr > posten.MTCOGS) signalen.licentieGroterDanMtcogs = true;
    posten.MTCOGS -= licentieNaarOrr;
    posten.ORRCOGS += licentieNaarOrr;
  }
  const oc = indeling.ownersCompensation || {};
  posten.OC = (oc.perEigenaar || 0) * (oc.eigenaren || 0);
  return {
    maand,
    posten: Object.fromEntries(POSTEN.map((p) => [p, r2(posten[p])])),
    miscOpbrengst: r2(miscOpbrengst),
    licentieNaarOrr: r2(licentieNaarOrr || 0),
    signalen,
    perPost,
  };
}

function main() {
  const [gbPad, berekenPad] = process.argv.slice(2);
  if (!gbPad) {
    console.error("Gebruik: node kosten.mjs <grootboek.json> [<bereken.json>]");
    process.exit(1);
  }
  const C = laadConfig(configPad());
  if (!C.kosten) throw new Error("Geen `kosten` in config.json; leg de indeling eerst vast in de directie-vault.");
  const gb = JSON.parse(readFileSync(gbPad, "utf-8"));
  const licentie = berekenPad ? JSON.parse(readFileSync(berekenPad, "utf-8")).revenue?.licentieVerschuivingNaarORR ?? 0 : 0;
  if (C.kosten.licentieVanMtcogsNaarOrrcogs && !berekenPad) {
    console.error("Let op: zonder bereken.json schuift er geen licentiedeel naar ORR COGS.");
  }
  console.log(JSON.stringify(berekenKosten(gb, C.kosten, licentie), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
