import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { valideerDossier, nieuweBronnen, laadStand, bewaarStand } from "./dossier.mjs";

const vers = () => JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

function nepAt(versies) {
  const posts = [];
  return {
    posts,
    async get(pad) {
      assert.equal(pad, "Projects/9001/Attachments");
      return { items: [
        { id: 1, title: "ander.pdf", fullPath: "ander.pdf", data: null },
        ...Object.keys(versies).map((n) => ({ id: 100 + Number(n), title: `projectstart-dossier-v${n}.json`, fullPath: `projectstart-dossier-v${n}.json`, data: null })),
      ] };
    },
    async getProjectAttachment(projectId, id) { return { items: [{ id, data: b64(versies[id - 100]) }] }; },
    async postProjectAttachment(projectId, body) { posts.push({ projectId, body }); return { itemId: 1 }; },
  };
}

test("voorbeelddossier is geldig", () => assert.deepEqual(valideerDossier(vers()), []));

test("bedrag in klantgerichte afspraak faalt, intern mag", () => {
  const d = vers();
  d.afspraken[0].tekst = "€ 100 per uur";
  d.afspraken[0].intern = false;
  const f = valideerDossier(d);
  assert.ok(f.some((x) => x.startsWith("afspraken[0].tekst")), f.join("\n"));
  d.afspraken[0].intern = true;
  assert.deepEqual(valideerDossier(d), []);
});

test("bedrag in ander veld faalt", () => {
  const d = vers();
  d.doel = "Kosten 500 EUR";
  assert.ok(valideerDossier(d).some((x) => x.startsWith("doel")));
});

test("afkorting BC faalt", () => {
  const d = vers();
  d.scope.inbegrepen = ["toegang tot BC"];
  assert.ok(valideerDossier(d).some((x) => x.startsWith("scope.inbegrepen[0]")));
});

test("MFA faalt tenzij voluit", () => {
  const d = vers();
  d.doel = "MFA voor iedereen";
  assert.ok(valideerDossier(d).some((x) => x.startsWith("doel")));
  d.doel = "Multifactor-authenticatie (MFA) voor iedereen";
  assert.deepEqual(valideerDossier(d), []);
});

test("em-dash faalt", () => {
  const d = vers();
  d.doel = "Veilig — en stabiel";
  assert.ok(valideerDossier(d).some((x) => x.startsWith("doel")));
});

test("route 03 faalt", () => {
  const d = vers();
  d.fases[0].route = "03";
  assert.ok(valideerDossier(d).some((x) => x.startsWith("fases[0].route")));
});

test("zonder fases faalt, ontbrekend veld faalt", () => {
  const d = vers();
  d.fases = [];
  delete d.doel;
  const f = valideerDossier(d);
  assert.ok(f.some((x) => x.startsWith("fases")));
  assert.ok(f.some((x) => x.startsWith("doel")));
});

test("geheim in tekst faalt", () => {
  const d = vers();
  d.doel = "wachtwoord: Geheim123!";
  assert.ok(valideerDossier(d).length > 0);
});

test("nieuweBronnen geeft alleen onverwerkte ids", () => {
  const d = vers();
  d.verwerkt = { bijlagen: [1], notities: [5] };
  const m = { bijlagen: [{ id: 1 }, { id: 2 }], notities: [{ id: 5 }, { id: 6 }] };
  const n = nieuweBronnen(d, m);
  assert.deepEqual(n.bijlagen.map((x) => x.id), [2]);
  assert.deepEqual(n.notities.map((x) => x.id), [6]);
});

test("laadStand pakt hoogste versie", async () => {
  const v2 = { ...vers(), versie: 2 }, v10 = { ...vers(), versie: 10, doel: "Nieuw doel" };
  const s = await laadStand(nepAt({ 2: v2, 10: v10 }), 9001);
  assert.equal(s.versie, 10);
  assert.equal(s.dossier.doel, "Nieuw doel");
  assert.equal(await laadStand(nepAt({}), 9001), null);
});

test("bewaarStand zonder wijziging schrijft niets", async () => {
  const v3 = { ...vers(), versie: 3 };
  const at = nepAt({ 3: v3 });
  const r = await bewaarStand(at, 9001, { ...vers(), versie: 1 }, { toepassen: true });
  assert.equal(at.posts.length, 0);
  assert.equal(r.bijlage, undefined);
});

test("bewaarStand zonder toepassen schrijft niets", async () => {
  const at = nepAt({ 3: { ...vers(), versie: 3 } });
  const d = { ...vers(), doel: "Anders doel" };
  const r = await bewaarStand(at, 9001, d, { toepassen: false });
  assert.equal(at.posts.length, 0);
  assert.match(r.voorvertoning, /v4/);
});

test("bewaarStand met toepassen schrijft v<N+1>", async () => {
  const at = nepAt({ 3: { ...vers(), versie: 3 } });
  const d = { ...vers(), doel: "Anders doel" };
  const r = await bewaarStand(at, 9001, d, { toepassen: true });
  assert.equal(at.posts.length, 1);
  const body = at.posts[0].body;
  assert.equal(body.fullPath, "projectstart-dossier-v4.json");
  assert.equal(body.title, "projectstart-dossier-v4.json");
  assert.equal(body.attachmentType, "FILE_ATTACHMENT");
  assert.equal(body.parentID, 9001);
  assert.equal(JSON.parse(Buffer.from(body.data, "base64").toString("utf8")).versie, 4);
  assert.equal(r.bijlage, "projectstart-dossier-v4.json");
});

test("bewaarStand eerste keer schrijft v1; ongeldig dossier wordt geweigerd", async () => {
  const at = nepAt({});
  await bewaarStand(at, 9001, vers(), { toepassen: true });
  assert.equal(at.posts[0].body.fullPath, "projectstart-dossier-v1.json");
  const slecht = { ...vers(), doel: "x — y" };
  await assert.rejects(() => bewaarStand(nepAt({}), 9001, slecht, { toepassen: true }));
});

test("geheim-genoemde sleutel genest geeft fout met pad", () => {
  const d = vers();
  d.extraOnderwerpen[0].token = "abc";
  d.contacten[0].wachtwoord = "x";
  const f = valideerDossier(d);
  assert.ok(f.includes("extraOnderwerpen[0].token: geheime sleutelnaam niet toegestaan"), f.join("\n"));
  assert.ok(f.some((x) => x.startsWith("contacten[0].wachtwoord")));
});

test("controleer en bewaar geven hetzelfde oordeel bij geheime sleutel", async () => {
  const d = vers();
  d.extraOnderwerpen[0].token = "abc";
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const pad = join(mkdtempSync(join(tmpdir(), "dos-")), "d.json");
  writeFileSync(pad, JSON.stringify(d));
  const { hoofd } = await import("./dossier.mjs");
  const c = await hoofd(["controleer", pad]);
  assert.equal(c.code, 1);
  const at = nepAt({});
  await assert.rejects(() => bewaarStand(at, 9001, d, { toepassen: true }), /extraOnderwerpen\[0\]\.token/);
  assert.equal(at.posts.length, 0);
});

test("laadStand valt terug op title en accepteert fullPath met prefix", async () => {
  const mk = (rijen, inhoud) => ({
    async get() { return { items: rijen }; },
    async getProjectAttachment(p, id) { return { items: [{ data: b64(inhoud[id]) }] }; },
  });
  const a = mk([
    { id: 1, title: "projectstart-dossier-v2.json", fullPath: "C:\\temp\\x.tmp" },
    { id: 2, title: "x", fullPath: "map/projectstart-dossier-v5.json" },
    { id: 3, title: "projectstart-dossier-v3.json", fullPath: null },
  ], { 1: { versie: 2 }, 2: { versie: 5 }, 3: { versie: 3 } });
  assert.equal((await laadStand(a, 9001)).versie, 5);
  const b2 = mk([{ id: 1, title: "projectstart-dossier-v2.json", fullPath: "" }], { 1: { versie: 2 } });
  assert.equal((await laadStand(b2, 9001)).versie, 2);
});

test("optionele kick-off-velden: afwezig en null zijn geldig", () => {
  const d = vers();
  for (const veld of ["kickoffDatum", "migratieplan", "vervolgOfferte", "externePartijen"]) delete d[veld];
  delete d.overleg.volgende;
  delete d.overleg.verzoekenControle;
  assert.deepEqual(valideerDossier(d), []);
  Object.assign(d, { kickoffDatum: null, migratieplan: { datum: null }, vervolgOfferte: null, externePartijen: [] });
  Object.assign(d.overleg, { volgende: null, verzoekenControle: null });
  assert.deepEqual(valideerDossier(d), []);
});

test("optionele kick-off-velden: verkeerd type faalt met pad", () => {
  const d = vers();
  Object.assign(d, { kickoffDatum: 12, migratieplan: "maart", vervolgOfferte: "", externePartijen: [{ naam: "X", rol: "", aangestuurdDoor: 3 }] });
  Object.assign(d.overleg, { volgende: false, verzoekenControle: [] });
  const f = valideerDossier(d);
  for (const pad of ["kickoffDatum", "migratieplan", "vervolgOfferte", "externePartijen[0].rol", "externePartijen[0].aangestuurdDoor", "overleg.volgende", "overleg.verzoekenControle"]) {
    assert.ok(f.some((r) => r.startsWith(`${pad}:`)), pad);
  }
  d.migratieplan = { datum: 5 };
  assert.match(valideerDossier(d).join("\n"), /^migratieplan\.datum:/m);
});

test("optionele kick-off-velden volgen de schrijfregels", () => {
  const d = vers();
  d.vervolgOfferte = "Offerte van € 5000 volgt.";
  d.externePartijen[0].aangestuurdDoor = "Pim — JUICT";
  d.overleg.verzoekenControle = "Via BC";
  const f = valideerDossier(d).join("\n");
  assert.match(f, /vervolgOfferte: bedrag/);
  assert.match(f, /externePartijen\[0\]\.aangestuurdDoor: em-dash/);
  assert.match(f, /overleg\.verzoekenControle: verboden afkorting/);
});

test("kanaal, gebruikersimpact en overgangBeheer: optioneel, tekst of null, met schrijfregels", () => {
  const d = vers();
  delete d.overleg.kanaal; delete d.gebruikersimpact; delete d.overgangBeheer;
  assert.deepEqual(valideerDossier(d), []);
  Object.assign(d, { gebruikersimpact: null, overgangBeheer: null });
  d.overleg.kanaal = null;
  assert.deepEqual(valideerDossier(d), []);
  Object.assign(d, { gebruikersimpact: 3, overgangBeheer: "Beheer via M365" });
  d.overleg.kanaal = "";
  const f = valideerDossier(d);
  for (const pad of ["gebruikersimpact", "overleg.kanaal"]) assert.ok(f.some((r) => r.startsWith(`${pad}:`)), pad);
  assert.ok(f.some((r) => r.startsWith("overgangBeheer: verboden afkorting")));
});

test("besluit en contact-mail: optioneel, vorm gecontroleerd, tekstregels gelden", () => {
  const d = vers();
  assert.deepEqual(valideerDossier(d), []);
  d.besluiten[0].besluit = null;
  d.contacten[0].mail = null;
  assert.deepEqual(valideerDossier(d), []);
  delete d.besluiten[0].besluit; delete d.contacten[0].mail;
  assert.deepEqual(valideerDossier(d), []);
  d.contacten[0].mail = "geen-adres";
  assert.ok(valideerDossier(d).some((x) => x.startsWith("contacten[0].mail")));
  d.contacten[0].mail = null;
  d.besluiten[0].besluit = 5;
  assert.ok(valideerDossier(d).some((x) => x.startsWith("besluiten[0].besluit")));
  d.besluiten[0].besluit = "Kosten € 10";
  assert.ok(valideerDossier(d).some((x) => x.startsWith("besluiten[0].besluit")));
});

test("extraOnderwerpen.optioneel moet een boolean zijn", () => {
  const d = JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
  d.extraOnderwerpen[0].optioneel = true;
  assert.deepEqual(valideerDossier(d), []);
  d.extraOnderwerpen[0].optioneel = "ja";
  assert.ok(valideerDossier(d).some((f) => f.startsWith("extraOnderwerpen[0].optioneel")));
});

test("hoofd nieuw: alleen bronnen die nog niet verwerkt zijn, zonder notitietekst", async () => {
  const d = vers();
  d.verwerkt = { bijlagen: [11], notities: [21] };
  const manifest = {
    bijlagen: [{ id: 11, titel: "oud.pdf", bestand: "bronnen/11-oud.pdf" }, { id: 12, titel: "nieuw.eml", bestand: "bronnen/12-nieuw.eml", datum: "2026-11-13" }],
    notities: [{ id: 21, titel: "oud", tekst: "x" }, { id: 22, titel: "Antwoord klant", tekst: "geheime inhoud blijft op schijf" }],
  };
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const map = mkdtempSync(join(tmpdir(), "dos-"));
  writeFileSync(join(map, "d.json"), JSON.stringify(d));
  writeFileSync(join(map, "bronnen.json"), JSON.stringify(manifest));
  const { hoofd } = await import("./dossier.mjs");
  const r = await hoofd(["nieuw", "--dossier", join(map, "d.json"), "--bronnen", join(map, "bronnen.json")]);
  assert.equal(r.code, 0);
  const uit = JSON.parse(r.uitvoer);
  assert.deepEqual(uit.bijlagen.map((b) => b.id), [12]);
  assert.deepEqual(uit.notities, [{ id: 22, titel: "Antwoord klant" }]);
  assert.ok(!r.uitvoer.includes("geheime inhoud"));
  assert.equal((await hoofd(["nieuw", "--dossier", join(map, "d.json")])).code, 1);
});

test("nieuweBronnen negeert de eigen uitvoer van de skill", () => {
  const d = vers();
  d.verwerkt = { bijlagen: [1], notities: [5] };
  const m = {
    bijlagen: [
      { id: 1, titel: "offerte.pdf", bestand: "bronnen/1-offerte.pdf" },
      { id: 2, titel: "projectstart-dossier-v1.json", bestand: "bronnen/2-projectstart-dossier-v1.json" },
      { id: 3, titel: "Mini PVA Voorbeeld Techniek v1", bestand: "bronnen/3-Mini PVA Voorbeeld Techniek v1.docx" },
      { id: 4, titel: "Mini PVA Voorbeeld Techniek v2.docx", bestand: "bronnen/4-Mini PVA Voorbeeld Techniek v2.docx" },
      { id: 9, titel: "x", bestand: "bronnen/9-projectstart-dossier-v2.json" },
      { id: 10, titel: "Antwoord klant.eml", bestand: "bronnen/10-Antwoord klant.eml" },
    ],
    notities: [
      { id: 5, titel: "Kickoff" },
      { id: 6, titel: "Projectstart: briefing kick-off" },
      { id: 7, titel: "Projectstart: aanvulling 12-11-2026 10:05" },
      { id: 8, titel: "Antwoord van de klant" },
    ],
  };
  const n = nieuweBronnen(d, m);
  assert.deepEqual(n.bijlagen.map((x) => x.id), [10]);
  assert.deepEqual(n.notities.map((x) => x.id), [8]);
});

test("tweede run zonder nieuwe externe bronnen: geen nieuwe dossierversie en geen PVA in het plan", async () => {
  const { mkdtempSync, writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { hoofd } = await import("./dossier.mjs");
  const teksten = await import("./teksten.mjs");
  // Na de eerste run staan op het project: de externe bronnen (1, 5) en de eigen uitvoer van de skill.
  const d = { ...vers(), verwerkt: { bijlagen: [1], notities: [5] } };
  const manifest = {
    bijlagen: [
      { id: 1, titel: "offerte.pdf", bestand: "bronnen/1-offerte.pdf" },
      { id: 2, titel: "projectstart-dossier-v1.json", bestand: "bronnen/2-projectstart-dossier-v1.json" },
      { id: 3, titel: "Mini PVA Voorbeeld Techniek v1", bestand: "bronnen/3-Mini PVA Voorbeeld Techniek v1.docx" },
    ],
    notities: [{ id: 5, titel: "Kickoff" }, { id: 6, titel: "Projectstart: briefing kick-off" }, { id: 7, titel: "Projectstart: uitvraag-mail" }],
  };
  const map = mkdtempSync(join(tmpdir(), "dos-"));
  writeFileSync(join(map, "d.json"), JSON.stringify(d));
  writeFileSync(join(map, "bronnen.json"), JSON.stringify(manifest));
  const r = await hoofd(["nieuw", "--dossier", join(map, "d.json"), "--bronnen", join(map, "bronnen.json")]);
  const uit = JSON.parse(r.uitvoer);
  assert.equal(uit.aantal, 0);
  assert.deepEqual([uit.bijlagen, uit.notities], [[], []]);
  // Het dossier blijft dus gelijk: geen nieuwe versie en geen aanvullingsnotitie of PVA in het plan.
  const at = nepAt({ 1: { ...d, versie: 1 } });
  const b = await bewaarStand(at, 9001, d, { toepassen: true });
  assert.equal(at.posts.length, 0);
  assert.equal(b.bijlage, undefined);
  const plan = join(map, "plan.json");
  const w = teksten.hoofd(["wijzigingen", "--oud", join(map, "d.json"), "--nieuw", join(map, "d.json"), "--plan", plan]);
  assert.match(w.uitvoer, /Geen wijzigingen/);
  assert.equal(existsSync(plan), false);
});

test("laad maakt een ontbrekende map aan", async () => {
  const { mkdtempSync, readFileSync: lees } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { hoofd } = await import("./dossier.mjs");
  const uit = join(mkdtempSync(join(tmpdir(), "dos-")), "nieuw", "werkmap", "dossier.json");
  const r = await hoofd(["laad", "--project", "9001", "--uit", uit], { at: nepAt({ 2: { ...vers(), versie: 2 } }) });
  assert.equal(r.code, 0, r.uitvoer);
  assert.equal(JSON.parse(lees(uit, "utf8")).versie, 2);
});

test("dossierbijlage is intern (publish 2)", async () => {
  const at = nepAt({});
  await bewaarStand(at, 9001, vers(), { toepassen: true });
  assert.equal(at.posts[0].body.publish, 2);
});

test("bedrag als '12.000 euro' of '500,-' faalt in klantgerichte tekst", () => {
  for (const tekst of ["Budget 12.000 euro voor de migratie", "Licenties kosten 500,- per jaar", "Twee euro's per gebruiker", "Kosten 300 Eur"]) {
    const d = vers();
    d.doel = tekst;
    assert.ok(valideerDossier(d).some((x) => x.startsWith("doel: bedrag")), tekst);
  }
  const d = vers();
  d.doel = "Europa en Europese wetgeving blijven leidend.";
  assert.deepEqual(valideerDossier(d), []);
});

test("fase met start na eind faalt", () => {
  const d = vers();
  d.fases[1].start = "2027-04";
  assert.ok(valideerDossier(d).some((x) => x.startsWith("fases[1]")), valideerDossier(d).join("\n"));
  d.fases[1].start = "2027-03";
  assert.deepEqual(valideerDossier(d), []);
});
