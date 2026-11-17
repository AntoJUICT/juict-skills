import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

test("van-dossier: werkbestandUitDossier en CLI", async () => {
  const { werkbestandUitDossier } = await import("./werkbestand.mjs");
  const { spawnSync } = await import("node:child_process");
  const { writeFile } = await import("node:fs/promises");
  const d = {
    projectId: 9001, companyId: 8001,
    klant: { autotask: "Voorbeeld Techniek B.V.", weergave: "Voorbeeld Techniek" },
    aanleveren: [{ wat: "Lijst met gebruikers", wie: "Joost Bakker" }, { wat: "Gedeelde mailboxen", wie: null }],
    technischeVragen: [{ vraag: "Welke versie draait de planningssoftware?", aan: "Femke Jansen", bron: "Intake" }],
    extraOnderwerpen: [{ soort: "beveiliging", geregeld: ["Tweede inlogstap voor beheerders"], controleren: ["Alle gebruikers"], later: [] }],
    artifacts: { presentatie: null, rapport: "https://example.test/rapport" },
  };
  const w = werkbestandUitDossier(d);
  assert.equal(w.klant, "Voorbeeld Techniek B.V.");
  assert.equal(w.slug, "voorbeeld-techniek-bv");
  assert.equal(w.stap, "bronnen");
  assert.equal(w.offerte.scope.beveiliging, true);
  assert.equal(w.offerte.scope.m365, null);
  assert.equal(w.offerte.scope.server, null);
  assert.match(w.antwoorden.beveiliging.bekend, /Tweede inlogstap/);
  assert.match(w.antwoorden.applicaties.bekend, /planningssoftware/);
  assert.deepEqual(w.openVragen.map((v) => v.aan), ["Joost Bakker", "nog te bepalen", "Femke Jansen"]);
  assert.deepEqual(w.autotask, { companyId: 8001, projectId: 9001, toegepast: false });
  assert.equal(w.rapport.artifactUrl, "https://example.test/rapport");
  d.extraOnderwerpen[0].optioneel = true;
  assert.equal(werkbestandUitDossier(d).offerte.scope.beveiliging, null);

  const root = await mkdtemp(join(tmpdir(), "inv-"));
  try {
    const pad = join(root, "dossier.json");
    await writeFile(pad, JSON.stringify(d));
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("./werkbestand.mjs", import.meta.url)), "van-dossier", pad], { env: { ...process.env, IT_INVENTARISATIE_ROOT: root }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.trim().endsWith("inventarisatie.json"));
    assert.equal(laad("voorbeeld-techniek-bv", root).stap, "bronnen");
    const again = spawnSync(process.execPath, [fileURLToPath(new URL("./werkbestand.mjs", import.meta.url)), "van-dossier", pad], { env: { ...process.env, IT_INVENTARISATIE_ROOT: root }, encoding: "utf8" });
    assert.equal(again.status, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
