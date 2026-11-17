// Bestanden uit het verkoopdeck van Mart (Claude Design-artifact) die de
// kick-off-presentatie nodig heeft. Paden zijn relatief aan de artifact-root.
export const MART_DECK = "https://claude.ai/artifact/ErU9wG7ZhrGkS655Nz2zrB";

const DS = "project/_ds/juict-design-system-019dd9ab-8148-72ee-85e6-20ec5e13e5de";

const TEAM = [
  "anto", "chiel", "jeroen", "kas", "lammert", "mart", "max",
  "mike", "raymon", "rob", "rutger", "tijmen", "timon",
];

export const MART_BESTANDEN = [
  // stylesheets
  "project/assets/colors_and_type.css",
  "project/deck.css",
  "project/content-studio.css",
  // scripts: alleen het slide-raamwerk (navigatie, schaling, voortgang)
  "project/present.js",
  "project/compat.json",
  // designsysteem
  `${DS}/colors_and_type.css`,
  `${DS}/_ds_manifest.json`,
  `${DS}/fonts/LibreFranklin-Regular.ttf`,
  `${DS}/fonts/Uniwars-SemiBold.otf`,
  // logo en achtergrond
  "project/assets/logo/juict-logo-diapositief.png",
  "project/assets/backgrounds/achtergrond-ruis.jpg",
  // foto's
  ...TEAM.map((naam) => `project/assets/teamfull/${naam}.jpg`),
  "project/assets/img/handshake.jpg",
  "project/assets/img/kantoor-team.jpg",
];

// Waar een bestand uit Marts deck terechtkomt naast de kick-off-pagina (een gewone
// HTML-artifact). Paden zijn relatief aan de pagina, zonder "project/". De artifact-
// service weigert paden die met "_" beginnen; de twee fonts gaan daarom naar
// assets/fonts/, waar assets/colors_and_type.css ze zoekt. null = niet publiceren.
export function publicatiePad(bronPad) {
  if (!bronPad.startsWith("project/") || bronPad === "project/compat.json") return null;
  if (bronPad.startsWith(`${DS}/`)) {
    const font = /\/fonts\/([^/]+)$/.exec(bronPad);
    return font ? `assets/fonts/${font[1]}` : null;
  }
  return bronPad.slice("project/".length);
}
