#!/usr/bin/env node
// Bouwt de kick-off-presentatie uit het dossier: één HTML-pagina op Marts deck-raamwerk
// (deck.css, present.js, assets) plus de files-map voor de publish-call. De pagina is de
// file_path van een gewone HTML-artifact; Marts bestanden worden ernaast gekopieerd.
// Gebruik: node bouw.mjs --dossier <pad> --uit <map> [--datum jjjj-mm-dd]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { esc } from "../../../it-inventarisatie/scripts/rapport/onderdelen.mjs";
import { valideerDossier } from "../dossier.mjs";
import { MART_DECK, MART_BESTANDEN, publicatiePad } from "./mart-bestanden.mjs";
import { slides, KICKOFF_CSS } from "./slides.mjs";

const GEBRUIK = "Gebruik: bouw.mjs --dossier <pad> --uit <map> [--datum jjjj-mm-dd]\n";

// Tekens die niet in een bestandsnaam mogen, worden een spatie.
const bestandsnaam = (s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

const CHROME = `<div id="chrome">
  <div id="progress"><div id="progressFill"></div></div>
  <div id="counter"></div>
  <button class="nav-btn" id="fsBtn" title="Volledig scherm (F)" aria-label="Volledig scherm">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
  </button>
  <button class="nav-btn" id="navPrev" title="Vorige (←)" aria-label="Vorige">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M15 18l-6-6 6-6"/></svg>
  </button>
  <button class="nav-btn" id="navNext" title="Volgende (→)" aria-label="Volgende">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M9 18l6-6-6-6"/></svg>
  </button>
</div>`;

export function presentatieHtml(d, opties = {}) {
  const titel = `Kick-off ${d.klant.weergave}`;
  const lijst = slides(d, opties);
  const secties = lijst.map((s, i) => {
    const nr = String(i + 1).padStart(2, "0");
    const klasse = s.markId === "s-next" ? "slide dark s8c" : "slide dark";
    return `<section class="${klasse}" id="${s.markId}" data-kick="${s.id}" data-screen-label="${nr} · ${esc(s.eyebrow)}"${s.markId === "s-next" ? " data-reveal-all" : ""}>\n${s.html}\n</section>`;
  }).join("\n\n");
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<link rel="stylesheet" href="assets/colors_and_type.css">
<link rel="stylesheet" href="deck.css">
<link rel="stylesheet" href="content-studio.css">
<style>${KICKOFF_CSS}</style>
</head>
<body>
<div id="stage">
<div id="canvas">

${secties}

</div>
</div>
${CHROME}
<script src="present.js"></script>
</body>
</html>
`;
}

export function bouwPresentatie(d, uitMap, opties = {}) {
  const fouten = valideerDossier(d);
  if (fouten.length) throw new Error(`Dossier is niet geldig:\n${fouten.join("\n")}`);
  const naam = `${bestandsnaam(`Kick-off ${d.klant.weergave}`)}.html`;
  const map = resolve(uitMap);
  mkdirSync(map, { recursive: true });
  const bestand = join(map, naam);
  writeFileSync(bestand, presentatieHtml(d, opties), "utf8");

  // De pagina zelf is de file_path van de publish; files bevat alleen de server-side
  // kopieën uit Marts deck, op paden relatief aan de pagina.
  const files = {};
  for (const bron of MART_BESTANDEN) {
    const doel = publicatiePad(bron);
    if (doel) files[doel] = { artifact: MART_DECK, path: bron };
  }
  return { bestand, files };
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
    const { bestand, files } = bouwPresentatie(d, uit, { datum: optie(argv, "--datum") });
    const filesPad = join(resolve(uit), "files.json");
    writeFileSync(filesPad, JSON.stringify(files, null, 2) + "\n", "utf8");
    return { code: 0, uitvoer: `Presentatie: ${bestand}\nFiles-map: ${filesPad}\n` };
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
