import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bouwRegels, configPad, laadConfig, periode, normaliseer, mutaties, deelGeboektIn, isReactief, som } from "./bereken.mjs";

// Nepconfig: verzonnen codes en prijzen, niets van JUICT.
const NEP = {
  mrrCodes: { "100": "Werkplek", "101": "Beheer" },
  easyworkCode: 100,
  addonCode: 200,
  addonMrrServices: { "21": "Beveiliging" },
  orrCodes: { "300": "Licentie", "301": "Verbruik" },
  productCodes: { "400": "Hardware" },
  dienstOnderProductcode: ["^Installatie"],
  overigCode: 500,
  overigRegels: [{ patroon: "partnerfee", categorie: "MISC" }, { patroon: "Auto", categorie: "EXCL" }],
  licentieVerschuiving: { _toelichting: "x", "11": 10 },
  seatServicesUitgesloten: { "13": "Lite", "14": "Hold" },
  alleenLitePatroon: "Lite",
  psWorkTypes: [900],
  machineBronnen: [8],
  goToMarket: { verkoop: 60.4, licentieInkoop: 10 },
};
const R = bouwRegels(NEP);
const regel = (o) => ({ quantity: 1, extendedPrice: 0, itemName: "", ...o });

test("periode leest de factuurperiode uit de regelomschrijving", () => {
  assert.deepEqual(periode({ lineItemFullDescription: "Werkplek: 01-10-2026 - 31-10-2026" }), [Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1)]);
  assert.equal(periode({ lineItemFullDescription: "geen periode" }), null);
});

test("een kwartaalfactuur telt voor een derde in elke maand van het kwartaal", () => {
  const items = [regel({ companyID: 1, billingCodeID: 101, extendedPrice: 300, lineItemFullDescription: "01-10-2026 - 31-12-2026" })];
  const okt = normaliseer(items, 2026, 10, R), nov = normaliseer(items, 2026, 11, R), sep = normaliseer(items, 2026, 9, R);
  assert.ok(Math.abs(okt.mrr[1] - 300 * 31 / 92) < 0.01);
  assert.ok(Math.abs(nov.mrr[1] - 300 * 30 / 92) < 0.01);
  assert.equal(sep.mrr[1], undefined);
});

test("licentie-inkoop schuift per seat van MRR naar ORR, totaal blijft gelijk", () => {
  const items = [regel({ companyID: 1, billingCodeID: 100, serviceID: 11, quantity: 5, extendedPrice: 250, lineItemFullDescription: "01-10-2026 - 31-10-2026" })];
  const n = normaliseer(items, 2026, 10, R);
  const verwacht = 10 * 5 * (31 / 30.44);
  assert.ok(Math.abs(n.shift - verwacht) < 0.01);
  assert.ok(Math.abs(som(n.mrr) + som(n.orr) - 250) < 0.01);
  assert.equal(n.seats, 5);
});

test("Lite en seat hold tellen niet als seat, en Lite-only maakt geen beheerde klant", () => {
  const p = "01-10-2026 - 31-10-2026";
  const items = [
    regel({ companyID: 1, billingCodeID: 100, serviceID: 13, quantity: 3, extendedPrice: 90, itemName: "Werkplek Lite", lineItemFullDescription: p }),
    regel({ companyID: 2, billingCodeID: 100, serviceID: 14, quantity: 2, extendedPrice: 40, itemName: "Hold", lineItemFullDescription: p }),
    regel({ companyID: 2, billingCodeID: 101, serviceID: 0, quantity: 1, extendedPrice: 20, itemName: "Beheer", lineItemFullDescription: p }),
  ];
  const n = normaliseer(items, 2026, 10, R);
  assert.equal(n.seats, 0);
  assert.equal(n.beheerd.has(1), false);
  assert.equal(n.beheerd.has(2), true);
});

test("add-ons: alleen de aangewezen services zijn MRR, de rest ORR", () => {
  const p = "01-10-2026 - 31-10-2026";
  const items = [
    regel({ companyID: 1, billingCodeID: 200, serviceID: 21, extendedPrice: 9, lineItemFullDescription: p }),
    regel({ companyID: 1, billingCodeID: 200, serviceID: 22, extendedPrice: 13, lineItemFullDescription: p }),
  ];
  const n = normaliseer(items, 2026, 10, R);
  assert.equal(n.mrr[1], 9);
  assert.equal(n.orr[1], 13);
});

test("regels zonder periode tellen alleen als ORR-verbruik in de boekmaand", () => {
  const items = [
    regel({ companyID: 1, billingCodeID: 301, extendedPrice: 50, itemDate: "2026-10-05T00:00:00Z" }),
    regel({ companyID: 1, billingCodeID: 101, extendedPrice: 70, itemDate: "2026-10-05T00:00:00Z" }),
  ];
  const n = normaliseer(items, 2026, 10, R);
  assert.equal(som(n.orr), 50);
  assert.equal(som(n.mrr), 0);
});

test("mutaties: groei, daling, nieuw en verloren sluiten aan op het verschil", () => {
  const was = { 1: 100, 2: 50, 3: 30 }, nu = { 1: 120, 2: 40, 4: 25 };
  const m = mutaties(was, nu);
  assert.equal(m.groei, 20);
  assert.equal(m.daling, 10);
  assert.equal(m.nieuwBedrag, 25);
  assert.equal(m.verlorenBedrag, 30);
  assert.equal(som(was) + m.groei - m.daling + m.nieuwBedrag - m.verlorenBedrag, som(nu));
});

test("geboekte omzet: uren NRR, diensten onder productcode NRR, overig per regel, onbekend gemeld", () => {
  const items = [
    regel({ billingItemType: 1, billingCodeID: 1, extendedPrice: 100 }),
    regel({ billingItemType: 3, billingCodeID: 400, itemName: "Laptop", extendedPrice: 800 }),
    regel({ billingItemType: 3, billingCodeID: 400, itemName: "Installatie - notebook", extendedPrice: 85 }),
    regel({ billingItemType: 3, billingCodeID: 500, itemName: "Declaratie partnerfee", extendedPrice: 1000 }),
    regel({ billingItemType: 3, billingCodeID: 500, itemName: "Auto verkocht", extendedPrice: 5000 }),
    regel({ billingItemType: 3, billingCodeID: 500, itemName: "Iets nieuws", extendedPrice: 40 }),
    regel({ billingItemType: 6, billingCodeID: 777, itemName: "Nieuwe dienst", extendedPrice: 12 }),
    regel({ billingItemType: 6, billingCodeID: 101, extendedPrice: 999 }),
  ];
  const { t, beoordelen, onbekend } = deelGeboektIn(items, R);
  assert.equal(t.NRR, 100 + 85 + 40 + 12);
  assert.equal(t.SALES, 800);
  assert.equal(t.MISC, 1000);
  assert.equal(t.EXCL, 5000);
  assert.equal(beoordelen.length, 1);
  assert.equal(onbekend.length, 1);
});

test("reactief: changes, alerts, machinebronnen, PS, intern en niet-managed klanten vallen af", () => {
  const msa = new Set([1]);
  const basis = { companyID: 1, ticketType: 2, source: 2, billingCodeID: 1 };
  assert.equal(isReactief(basis, msa, R), true);
  assert.equal(isReactief({ ...basis, ticketType: 4 }, msa, R), false);
  assert.equal(isReactief({ ...basis, ticketType: 5 }, msa, R), false);
  assert.equal(isReactief({ ...basis, source: 8 }, msa, R), false);
  assert.equal(isReactief({ ...basis, billingCodeID: 900 }, msa, R), false);
  assert.equal(isReactief({ ...basis, companyID: 0 }, msa, R), false);
  assert.equal(isReactief({ ...basis, companyID: 2 }, msa, R), false);
});

test("config: zonder bestand een duidelijke fout, met SMART_NUMBERS_CONFIG het opgegeven pad", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-"));
  const pad = join(dir, "config.json");
  assert.throws(() => laadConfig(pad), /directie-vault/);
  writeFileSync(pad, JSON.stringify(NEP));
  assert.equal(configPad({ SMART_NUMBERS_CONFIG: pad }), pad);
  assert.equal(laadConfig(pad).easyworkCode, 100);
  assert.match(configPad({ USERPROFILE: "C:\\Users\\x" }), /vault-juict-directie[\\/]financien[\\/]smart-numbers[\\/]config\.json$/);
});

test("go-to-market seat price wordt op hele euro's afgerond", () => {
  assert.equal(Math.round(R.goToMarket.verkoop - R.goToMarket.licentieInkoop), 50);
});
