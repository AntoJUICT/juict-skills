import { test } from "node:test";
import assert from "node:assert/strict";
import { berekenKosten, postVan } from "./kosten.mjs";

// Verzonnen rekeningen en bedragen, niets van JUICT.
const INDELING = {
  EMP: ["4000"],
  PCOGS: ["7006"],
  MTCOGS: ["7001"],
  ORRCOGS: ["7003"],
  MISC: ["7050"],
  NIET: ["4090"],
  OTH: ["7000"],
  licentieVanMtcogsNaarOrrcogs: true,
  ownersCompensation: { perEigenaar: 1000, eigenaren: 3 },
};
const gb = (rekeningen) => ({ maanden: [{ maand: "2026-10", rekeningen }] });
const rek = (code, bedrag) => ({ code, omschrijving: `Rekening ${code}`, bedrag });

test("postVan: lijst uit de config, omzet apart, rest OTH", () => {
  assert.equal(postVan("4000", INDELING), "EMP");
  assert.equal(postVan("8300", INDELING), "OMZET");
  assert.equal(postVan("4600", INDELING), "OTH");
});

test("posten, normatieve eigenaren en uitgesloten rekeningen", () => {
  const u = berekenKosten(gb([rek("4000", 500), rek("4090", 900), rek("7006", 200), rek("4600", 50), rek("8300", -2000)]), INDELING);
  assert.deepEqual(u.posten, { EMP: 500, OC: 3000, PCOGS: 200, MTCOGS: 0, ORRCOGS: 0, OTH: 50 });
  assert.equal(u.maand, "2026-10");
});

test("het licentiedeel schuift van MRR Tools COGS naar ORR COGS", () => {
  const u = berekenKosten(gb([rek("7001", 1000), rek("7003", 300)]), INDELING, 400);
  assert.equal(u.posten.MTCOGS, 600);
  assert.equal(u.posten.ORRCOGS, 700);
  assert.equal(u.signalen.licentieGroterDanMtcogs, false);
  assert.equal(berekenKosten(gb([rek("7001", 100)]), INDELING, 400).signalen.licentieGroterDanMtcogs, true);
});

test("een creditrekening in MISC wordt opbrengst, geen kosten", () => {
  const u = berekenKosten(gb([rek("7050", -250)]), INDELING);
  assert.equal(u.miscOpbrengst, 250);
  assert.equal(u.posten.OTH, 0);
});

test("een niet-ingedeelde inkooprekening valt in OTH en wordt gemeld", () => {
  const u = berekenKosten(gb([rek("7999", 80), rek("7000", 10)]), INDELING);
  assert.equal(u.posten.OTH, 90);
  assert.deepEqual(u.signalen.beoordelen.map((r) => r.code), ["7999"]);
});

test("weigert meer of minder dan één maand", () => {
  assert.throws(() => berekenKosten({ maanden: [] }, INDELING));
});
