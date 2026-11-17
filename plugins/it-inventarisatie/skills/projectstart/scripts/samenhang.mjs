// Samenhang tussen het dossier (presentatie, PVA) en het rapport van it-inventarisatie.
// Het rapport is leidend: het dossier moet daarbij passen.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateRapport } from "../../it-inventarisatie/scripts/rapport/schema.mjs";

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const norm = (s) => String(s ?? "").trim().toLowerCase();
const maandNaam = (jjjjmm) => MAANDEN[Number(String(jjjjmm).split("-")[1]) - 1];

export function controleerSamenhang(d, rapport) {
  const fouten = [];
  const rapportFouten = validateRapport(rapport);
  if (rapportFouten.length) return [`Rapport is niet geldig: ${rapportFouten.join("; ")}`];

  if (norm(rapport.klant) !== norm(d.klant?.autotask)) {
    fouten.push(`Klant: rapport noemt "${rapport.klant}", dossier noemt "${d.klant?.autotask}".`);
  }

  const plan = rapport.stappenplan?.fases ?? [];
  const maanden = new Set((rapport.stappenplan?.maanden ?? []).map(norm));
  const namen = new Set(plan.map((f) => norm(f.naam)));
  for (const f of d.fases ?? []) {
    if (!namen.has(norm(f.naam))) fouten.push(`Fase "${f.naam}" staat in het dossier maar niet in het stappenplan van het rapport.`);
    for (const m of [f.start, f.eind]) {
      if (!maanden.has(maandNaam(m))) fouten.push(`Fase "${f.naam}" loopt tot of vanaf ${maandNaam(m)} (${m}), maar dat valt buiten de maanden van het rapport (${[...maanden].join(", ")}).`);
    }
  }

  const keuze = (rapport.uren?.blokken ?? []).filter((b) => b.soort === "keuze");
  const beveiligingKeuze = keuze.some((b) => (b.fases ?? []).some((f) => /beveiliging/i.test(f.fase ?? "")));
  if (beveiligingKeuze) {
    for (const x of (d.extraOnderwerpen ?? []).filter((e) => e.soort === "beveiliging")) {
      if (x.optioneel !== true) fouten.push("Beveiliging staat in het rapport als keuze, maar is in het dossier niet als optioneel gemarkeerd (extraOnderwerpen.optioneel).");
    }
  }
  return fouten;
}

// --- CLI ---

const GEBRUIK = "Gebruik: samenhang.mjs --dossier <pad> --rapport <rapport.json>\n";

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export function hoofd(argv, deps = {}) {
  const lees = deps.lees ?? ((pad) => readFileSync(pad, "utf8"));
  const dossier = optie(argv, "--dossier");
  const rapport = optie(argv, "--rapport");
  if (!dossier || !rapport) return { code: 1, uitvoer: GEBRUIK };
  try {
    const fouten = controleerSamenhang(JSON.parse(lees(dossier)), JSON.parse(lees(rapport)));
    return fouten.length
      ? { code: 1, uitvoer: fouten.join("\n") + "\n" }
      : { code: 0, uitvoer: "Dossier en rapport passen bij elkaar.\n" };
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
