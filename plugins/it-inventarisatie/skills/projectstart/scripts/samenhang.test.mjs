import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { controleerSamenhang } from "./samenhang.mjs";

const lees = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const rapport = () => lees("../../it-inventarisatie/voorbeeld/rapport.voorbeeld.json");
// Dossier dat bij het voorbeeldrapport past: zelfde klant en fasenamen, maanden december tot maart.
const dossier = () => {
  const d = lees("../voorbeeld/dossier.voorbeeld.json");
  d.fases = [
    { code: "F1", naam: "Accounts en licenties opschonen", route: "01", start: "2026-12", eind: "2027-01" },
    { code: "F2", naam: "beveiliging ", route: "02", start: "2027-01", eind: "2027-03" },
  ];
  return d;
};
const metBeveiligingKeuze = (r) => {
  const blok = r.uren.blokken.find((b) => b.fases.some((f) => f.fase === "Beveiliging"));
  const fase = blok.fases.find((f) => f.fase === "Beveiliging");
  blok.fases = blok.fases.filter((f) => f !== fase);
  r.uren.blokken.push({ titel: "Naar keuze", soort: "keuze", fases: [fase] });
  return r;
};

test("consistent dossier en rapport geven geen fouten", () => {
  assert.deepEqual(controleerSamenhang(dossier(), rapport()), []);
});

test("andere klant → fout", () => {
  const d = dossier();
  d.klant.autotask = "Andere Klant B.V.";
  assert.equal(controleerSamenhang(d, rapport()).length, 1);
});

test("planning in rapport en dossier verschillen → fout", () => {
  const d = dossier();
  d.fases[0].naam = "Onbekende fase";
  d.fases[1].eind = "2027-08";
  const f = controleerSamenhang(d, rapport());
  assert.equal(f.length, 2);
  assert.match(f[0], /Onbekende fase/);
  assert.match(f[1], /augustus/);
});

test("beveiliging keuze in rapport maar niet optioneel in dossier → fout", () => {
  const d = dossier();
  const f = controleerSamenhang(d, metBeveiligingKeuze(rapport()));
  assert.equal(f.length, 1);
  assert.match(f[0], /optioneel/);
  d.extraOnderwerpen[0].optioneel = true;
  assert.deepEqual(controleerSamenhang(d, metBeveiligingKeuze(rapport())), []);
});

test("hoofd: exit 0 als het past, exit 1 met de afwijkingen, exit 1 zonder opties", async () => {
  const { hoofd } = await import("./samenhang.mjs");
  const bestanden = { d: JSON.stringify(dossier()), r: JSON.stringify(rapport()) };
  const lees = (pad) => bestanden[pad];
  const goed = hoofd(["--dossier", "d", "--rapport", "r"], { lees });
  assert.equal(goed.code, 0);
  assert.match(goed.uitvoer, /passen bij elkaar/);
  const anders = dossier();
  anders.klant.autotask = "Andere Klant B.V.";
  bestanden.d = JSON.stringify(anders);
  const fout = hoofd(["--dossier", "d", "--rapport", "r"], { lees });
  assert.equal(fout.code, 1);
  assert.match(fout.uitvoer, /Klant: rapport noemt/);
  assert.equal(hoofd([], { lees }).code, 1);
});
