import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, werkmap, laad, bewaar, nieuw } from "./werkbestand.mjs";

test("slugify", () => {
  assert.equal(slugify("Voorbeeld Techniek B.V."), "voorbeeld-techniek-bv");
  assert.equal(slugify("Bedrijf 2019 B.V."), "bedrijf-2019-bv");
  assert.equal(slugify("  Café & Zn. "), "cafe-zn");
});

test("werkmap gebruikt de opgegeven root", () => {
  assert.equal(werkmap("abc", "/tmp/x"), join("/tmp/x", "abc"));
});

test("bewaar en laad: round-trip, stript geheimen, ontbrekend is null", async () => {
  const root = await mkdtemp(join(tmpdir(), "inv-"));
  try {
    assert.equal(laad("bestaat-niet", root), null);
    const w = nieuw("Voorbeeld Techniek B.V.");
    assert.equal(w.schema, 1);
    assert.equal(w.slug, "voorbeeld-techniek-bv");
    assert.equal(w.stap, "offerte");
    w.antwoorden = { netwerk: { adminPassword: "x", model: "Voorbeeld-router" } };
    const pad = bewaar(w.slug, w, root);
    assert.ok(pad.endsWith("inventarisatie.json"));
    const tekst = await readFile(pad, "utf8");
    assert.ok(tekst.endsWith("}\n"));
    assert.ok(!tekst.includes("adminPassword"));
    const terug = laad(w.slug, root);
    assert.deepEqual(terug.antwoorden, { netwerk: { model: "Voorbeeld-router" } });
    assert.equal(terug.klant, w.klant);
    assert.ok(terug.bijgewerkt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nieuw: scope is per onderdeel null (onbekend), niet false", () => {
  const w = nieuw("Voorbeeld Techniek B.V.");
  const scope = w.offerte.scope;
  assert.deepEqual(Object.keys(scope).sort(), ["applicaties", "beveiliging", "m365", "netwerk", "printers", "server", "telefonie", "werkplekken"]);
  for (const [k, v] of Object.entries(scope)) assert.equal(v, null, k);
});
