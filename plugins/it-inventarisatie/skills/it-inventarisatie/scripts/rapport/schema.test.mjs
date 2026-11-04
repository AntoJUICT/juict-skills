import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateRapport } from "./schema.mjs";

const voorbeeld = () => JSON.parse(readFileSync(new URL("../../voorbeeld/rapport.voorbeeld.json", import.meta.url), "utf8"));

test("het voorbeeldrapport is geldig", () => {
  assert.deepEqual(validateRapport(voorbeeld()), []);
});

test("voorbeeld gebruikt alle bloktypes en de uren kloppen", () => {
  const r = voorbeeld();
  assert.ok(r.stand.length >= 2);
  const types = new Set(r.stand.flatMap((p) => p.blokken.map((b) => b.type)));
  for (const t of ["h2", "p", "tabel", "kaarten"]) assert.ok(types.has(t), t);
  const som = (soort) => r.uren.blokken.filter((b) => b.soort === soort).flatMap((b) => b.fases).reduce((s, f) => s + f.uren, 0);
  assert.equal(som("nodig"), 105);
  assert.equal(som("keuze"), 26);
  assert.equal(r.uren.projectmanagementPct, 10);
});

test("uren.blokken zonder nodig-blok geeft een fout", () => {
  const r = voorbeeld();
  r.uren.blokken = r.uren.blokken.filter((b) => b.soort !== "nodig");
  assert.ok(validateRapport(r).some((f) => f.includes("nodig")));
});

test("uren.toelichting met twee zinnen geeft een fout", () => {
  const r = voorbeeld();
  r.uren.toelichting = ["Een.", "Twee."];
  assert.ok(validateRapport(r).some((f) => f.includes("uren.toelichting")));
});

test("zonder klant: klant ontbreekt", () => {
  const r = voorbeeld();
  delete r.klant;
  assert.ok(validateRapport(r).includes("klant ontbreekt"));
});

test("em-dash en {{ geven een fout met het pad", () => {
  const r = voorbeeld();
  r.samenvatting.zagen = "Dit — dat";
  r.doel.intro = "Kijk {{ naam }}";
  const f = validateRapport(r);
  assert.ok(f.some((x) => x.includes("samenvatting.zagen")));
  assert.ok(f.some((x) => x.includes("doel.intro")));
});

test("vrije-tekstgeheim geeft een fout", () => {
  const r = voorbeeld();
  r.opvalt[0].zien = "Switch wachtwoord: x";
  assert.ok(validateRapport(r).some((x) => x.includes("opvalt.0.zien")));
});

test("bedragen zijn niet toegestaan", () => {
  const r = voorbeeld();
  r.stappenplan.toelichting = "Kosten € 100";
  assert.ok(validateRapport(r).some((x) => x.includes("geen bedragen")));
  const r2 = voorbeeld();
  r2.stappenplan.toelichting = "Kosten 100 EUR";
  assert.ok(validateRapport(r2).some((x) => x.includes("geen bedragen")));
});

test("b en br zijn toegestaan, andere tags niet", () => {
  const r = voorbeeld();
  r.samenvatting.zagen = "Een <b>vet</b> woord<br>en regel.";
  assert.deepEqual(validateRapport(r), []);
  r.samenvatting.zagen = "Een <script>x</script>";
  assert.ok(validateRapport(r).some((x) => x.includes("samenvatting.zagen")));
});

test("fase met start na eind geeft een fout", () => {
  const r = voorbeeld();
  r.stappenplan.fases[0].start = 3;
  r.stappenplan.fases[0].eind = 2;
  assert.ok(validateRapport(r).some((x) => x.includes("stappenplan.fases.0")));
});

test("fase buiten de maanden geeft een fout", () => {
  const r = voorbeeld();
  r.stappenplan.fases[0].eind = 99;
  assert.ok(validateRapport(r).some((x) => x.includes("stappenplan.fases.0")));
});

test("ongeldig blok en niet-object", () => {
  const r = voorbeeld();
  r.stand[0].blokken.push({ type: "plaatje" });
  assert.ok(validateRapport(r).some((x) => x.includes("stand.0.blokken")));
  assert.ok(validateRapport(null).length > 0);
});
