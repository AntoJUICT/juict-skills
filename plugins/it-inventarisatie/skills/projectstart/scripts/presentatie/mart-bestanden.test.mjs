import { test } from "node:test";
import assert from "node:assert/strict";
import { MART_DECK, MART_BESTANDEN, publicatiePad } from "./mart-bestanden.mjs";

test("deck-url en verplichte bestanden", () => {
  assert.equal(MART_DECK, "https://claude.ai/artifact/ErU9wG7ZhrGkS655Nz2zrB");
  for (const eind of ["project/deck.css", "project/present.js",
    "fonts/LibreFranklin-Regular.ttf", "fonts/Uniwars-SemiBold.otf",
    "project/assets/teamfull/mike.jpg"]) {
    assert.ok(MART_BESTANDEN.some((p) => p.endsWith(eind)), eind);
  }
});

test("geen klantlogo's of uploads, geen dubbelen", () => {
  assert.ok(!MART_BESTANDEN.some((p) => p.includes("assets/logos/") || p.includes("uploads/")));
  assert.equal(new Set(MART_BESTANDEN).size, MART_BESTANDEN.length);
});

test("publicatiePad: relatief aan de pagina, nooit _ of project/", () => {
  const DS = "project/_ds/juict-design-system-019dd9ab-8148-72ee-85e6-20ec5e13e5de";
  assert.equal(publicatiePad("project/deck.css"), "deck.css");
  assert.equal(publicatiePad("project/assets/img/kantoor-team.jpg"), "assets/img/kantoor-team.jpg");
  assert.equal(publicatiePad(`${DS}/fonts/LibreFranklin-Regular.ttf`), "assets/fonts/LibreFranklin-Regular.ttf");
  assert.equal(publicatiePad(`${DS}/fonts/Uniwars-SemiBold.otf`), "assets/fonts/Uniwars-SemiBold.otf");
  assert.equal(publicatiePad("project/compat.json"), null);
  assert.equal(publicatiePad(`${DS}/colors_and_type.css`), null);
  assert.equal(publicatiePad(`${DS}/_ds_manifest.json`), null);
  const gepubliceerd = MART_BESTANDEN.map(publicatiePad).filter(Boolean);
  for (const p of gepubliceerd) {
    assert.ok(!p.startsWith("_") && !p.startsWith("project/") && !p.split("/").some((d) => d.startsWith("_")), p);
  }
  assert.equal(new Set(gepubliceerd).size, gepubliceerd.length);
  assert.equal(gepubliceerd.length, MART_BESTANDEN.length - 3);
});
