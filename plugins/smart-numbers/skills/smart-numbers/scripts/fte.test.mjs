import { test } from "node:test";
import assert from "node:assert/strict";
import { berekenFte, rondKwart, ROLLEN } from "./fte.mjs";

// Verzonnen medewerkers, niemand van JUICT.
const dossier = (email, werkweek, extra = {}) => ({
  profiel: { email, werkweek, startdatum: "2024-01-01T00:00:00.000Z", uitDienstDatum: null, ...(extra.profiel || {}) },
  salarisregel: { urenPerWeek: werkweek, isManagementFee: false, isStagevergoeding: false, ...(extra.salarisregel || {}) },
});

const ROLVERDELING = {
  _toelichting: "test",
  "a@voorbeeld.nl": "support_desk",
  "b@voorbeeld.nl": "support_desk",
  "c@voorbeeld.nl": "professional_services",
  "eigenaar@voorbeeld.nl": "niet_technisch",
  "kantoor@voorbeeld.nl": "niet_technisch",
  "schoonmaak@voorbeeld.nl": "telt_niet",
  "stage@voorbeeld.nl": "other_technical",
};

test("afronden op het dichtstbijzijnde kwart", () => {
  assert.equal(rondKwart(2.1), 2);
  assert.equal(rondKwart(2.13), 2.25);
  assert.equal(rondKwart(10.9), 11);
  assert.equal(rondKwart(0.1), 0);
});

test("uren per rol, totaal inclusief niet-technisch en eigenaren", () => {
  const d = [
    dossier("a@voorbeeld.nl", 40),
    dossier("b@voorbeeld.nl", 36),
    dossier("c@voorbeeld.nl", 40),
    dossier("eigenaar@voorbeeld.nl", 40, { salarisregel: { isManagementFee: true } }),
    dossier("kantoor@voorbeeld.nl", 32),
  ];
  const u = berekenFte(d, ROLVERDELING, 2026, 10);
  assert.equal(u.uren.support_desk, 76);
  assert.equal(u.fte.support_desk, 2);
  assert.equal(u.fte.professional_services, 1);
  assert.equal(u.totaal.uren, 188);
  assert.equal(u.totaal.fte, 4.75);
  for (const r of ROLLEN) assert.ok(r in u.fte, `rol ${r} ontbreekt in de uitvoer`);
  assert.equal(u.fte.vcio, 0);
});

test("stagiairs en telt_niet tellen niet mee", () => {
  const d = [
    dossier("a@voorbeeld.nl", 40),
    dossier("stage@voorbeeld.nl", 40, { salarisregel: { isStagevergoeding: true } }),
    dossier("schoonmaak@voorbeeld.nl", 8),
  ];
  const u = berekenFte(d, ROLVERDELING, 2026, 10);
  assert.equal(u.totaal.uren, 40);
  assert.equal(u.fte.other_technical, 0);
  assert.equal(u.regels.find((r) => r.email === "stage@voorbeeld.nl").reden, "stagiair");
});

test("werkweek uit het profiel wint en een afwijkende salarisregel wordt gemeld", () => {
  const d = [dossier("kantoor@voorbeeld.nl", 32, { salarisregel: { urenPerWeek: 40 } })];
  const u = berekenFte(d, ROLVERDELING, 2026, 10);
  assert.equal(u.totaal.uren, 32);
  assert.deepEqual(u.signalen.afwijkingSalarisregel, [{ email: "kantoor@voorbeeld.nl", werkweek: 32, salarisregel: 40 }]);
});

test("in dienst op de laatste dag van de maand", () => {
  const d = [
    dossier("a@voorbeeld.nl", 40, { profiel: { startdatum: "2026-11-01T00:00:00.000Z" } }),
    dossier("b@voorbeeld.nl", 40, { profiel: { uitDienstDatum: "2026-10-15T00:00:00.000Z" } }),
    dossier("c@voorbeeld.nl", 40, { profiel: { startdatum: "2026-10-31T00:00:00.000Z" } }),
  ];
  const u = berekenFte(d, ROLVERDELING, 2026, 10);
  assert.equal(u.totaal.uren, 40);
  assert.equal(u.uren.professional_services, 40);
});

test("signalen: zonder rol en niet opgehaald", () => {
  const d = [dossier("nieuw@voorbeeld.nl", 40), dossier("a@voorbeeld.nl", 40)];
  const u = berekenFte(d, ROLVERDELING, 2026, 10);
  assert.deepEqual(u.signalen.zonderRol, ["nieuw@voorbeeld.nl"]);
  assert.ok(u.signalen.nietOpgehaald.includes("b@voorbeeld.nl"));
  assert.ok(!u.signalen.nietOpgehaald.includes("schoonmaak@voorbeeld.nl"));
  assert.equal(u.totaal.uren, 40);
});
