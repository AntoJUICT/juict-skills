import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taakOmschrijving, takenVoorPlan, voegTakenToe, hoofd, MAX_OMSCHRIJVING } from "./taken.mjs";

const vers = () => JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
const TAAK = { titel: "Testwerkplek inrichten", fase: "Realisatie- en uitvoeringsfase", uren: 4, omschrijving: "Een werkplek inrichten.", resultaat: "Een werkende testwerkplek.", bron: "Offerte 2026-11-02" };

test("omschrijving: tekst, dan Resultaat en Bron", () => {
  assert.equal(taakOmschrijving(TAAK), "Een werkplek inrichten.\n\nResultaat: Een werkende testwerkplek.\nBron: Offerte 2026-11-02");
});

test("omschrijving: zonder resultaat alleen de bron", () => {
  assert.equal(taakOmschrijving({ ...TAAK, resultaat: null }), "Een werkplek inrichten.\n\nBron: Offerte 2026-11-02");
});

test("omschrijving: maximaal 8000 tekens, resultaat en bron blijven staan", () => {
  const o = taakOmschrijving({ ...TAAK, omschrijving: "x".repeat(9000) });
  assert.equal(MAX_OMSCHRIJVING, 8000);
  assert.ok(o.length <= 8000, String(o.length));
  assert.match(o, / \.\.\.\n\nResultaat: Een werkende testwerkplek\.\nBron: Offerte 2026-11-02$/);
});

test("takenVoorPlan: titel, fase, uren (null blijft null) en de opgebouwde omschrijving", () => {
  const d = vers();
  const p = takenVoorPlan(d);
  assert.equal(p.length, d.taken.length);
  assert.deepEqual(Object.keys(p[0]).sort(), ["fase", "omschrijving", "titel", "uren"]);
  const proef = p.find((t) => t.titel === "Proefmigratie met twee gebruikers uitvoeren");
  assert.equal(proef.uren, null);
  assert.match(proef.omschrijving, /Bron: Mail Sanne de Vries 2026-11-12$/);
});

test("takenVoorPlan: ongeldig dossier geeft een fout", () => {
  const d = vers();
  d.taken[0].bron = "";
  assert.throws(() => takenVoorPlan(d), /taken\[0\]\.bron/);
});

test("voegTakenToe vervangt de taken en laat notities en bijlagen staan", () => {
  const plan = { notities: [{ titel: "n", tekst: "t" }], bijlagen: [{ titel: "b", url: "https://x" }], taken: [{ titel: "oud" }] };
  const uit = voegTakenToe(plan, [{ titel: "nieuw" }]);
  assert.deepEqual(uit, { notities: plan.notities, bijlagen: plan.bijlagen, taken: [{ titel: "nieuw" }] });
});

test("hoofd: zet de taken in het plan en noemt ze; zonder plan alleen tonen", () => {
  const bestanden = { "d.json": JSON.stringify(vers()), "plan.json": JSON.stringify({ notities: [{ titel: "Projectstart: briefing kick-off", tekst: "x" }], bijlagen: [] }) };
  const deps = { lees: (p) => bestanden[p], bestaat: (p) => p in bestanden, schrijf: (p, t) => { bestanden[p] = t; } };
  const r = hoofd(["--dossier", "d.json", "--plan", "plan.json"], deps);
  assert.equal(r.code, 0, r.uitvoer);
  const plan = JSON.parse(bestanden["plan.json"]);
  assert.equal(plan.taken.length, 5);
  assert.equal(plan.notities.length, 1);
  assert.match(r.uitvoer, /Proefmigratie met twee gebruikers uitvoeren \(Realisatie- en uitvoeringsfase, uren nog te bepalen\)/);
  assert.match(r.uitvoer, /Mailboxen en bestanden migreren \(Realisatie- en uitvoeringsfase, 28 uur\)/);
  const alleen = hoofd(["--dossier", "d.json"], deps);
  assert.equal(alleen.code, 0);
  assert.match(alleen.uitvoer, /Bron: Offerte 2026-11-02/);
});

test("hoofd: zonder --dossier gebruik en code 1, ongeldig dossier code 1", () => {
  assert.equal(hoofd([], {}).code, 1);
  const d = vers();
  d.taken.push({ ...d.taken[0] });
  const r = hoofd(["--dossier", "d.json"], { lees: () => JSON.stringify(d) });
  assert.equal(r.code, 1);
  assert.match(r.uitvoer, /dubbel/);
});
