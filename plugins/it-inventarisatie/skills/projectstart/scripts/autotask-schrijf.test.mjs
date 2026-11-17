import { test } from "node:test";
import assert from "node:assert/strict";
import { planSchrijfacties, voerUit, hoofd } from "./autotask-schrijf.mjs";
import { maakAt } from "../../it-inventarisatie/scripts/autotask-project.mjs";

const INVOER = {
  notities: [{ titel: "Projectstart: briefing kick-off", tekst: "Inhoud" }, { titel: "Projectstart: aanvulling 12-11-2026", tekst: "Meer" }],
  bijlagen: [
    { titel: "Mini PVA Voorbeeld v1", bestandsnaam: "Mini PVA Voorbeeld v1.docx", pad: "C:/x/pva.docx" },
    { titel: "Kick-off Voorbeeld", bestandsnaam: "Kick-off Voorbeeld.pdf", pad: "C:/x/ko.pdf" },
  ],
};

function nepAt() {
  const calls = [];
  return {
    calls,
    async postProjectNote(p, b) { calls.push(["note", p, b]); return { itemId: 1 }; },
    async postProjectAttachment(p, b) { calls.push(["bijlage", p, b]); return { itemId: 2 }; },
  };
}
const lees = () => Buffer.from("abc");

test("plan slaat bestaande titel en bestaande fullPath over", () => {
  const plan = planSchrijfacties(9001, INVOER, {
    notities: [{ title: "projectstart: briefing kick-off " }],
    bijlagen: [{ fullPath: "kick-off voorbeeld.PDF" }],
  });
  assert.deepEqual(plan.notities.map((n) => n.actie), ["overslaan", "nieuw"]);
  assert.deepEqual(plan.bijlagen.map((n) => n.actie), ["nieuw", "overslaan"]);
});

test("zonder toepassen geen enkele POST", async () => {
  const at = nepAt();
  const plan = planSchrijfacties(9001, INVOER, { notities: [], bijlagen: [] });
  const r = await voerUit(at, plan, { toepassen: false, lees });
  assert.equal(at.calls.length, 0);
  assert.match(r.uitvoer, /Voorvertoning/);
});

test("met toepassen: notitie publish 2 noteType 5, bijlage met base64", async () => {
  const at = nepAt();
  const plan = planSchrijfacties(9001, INVOER, { notities: [], bijlagen: [] });
  await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(at.calls.length, 4);
  const [, p, b] = at.calls[0];
  assert.equal(p, 9001);
  assert.deepEqual(b, { projectID: 9001, title: "Projectstart: briefing kick-off", description: "Inhoud", noteType: 5, publish: 2, isAnnouncement: false });
  const bijlage = at.calls.find((c) => c[0] === "bijlage")[2];
  assert.equal(bijlage.fullPath, "Mini PVA Voorbeeld v1.docx");
  assert.equal(bijlage.parentID, 9001);
  assert.equal(bijlage.data, Buffer.from("abc").toString("base64"));
});

test("tweede run: bestaande notitie en bijlage worden overgeslagen", async () => {
  const at = nepAt();
  const bestaand = { notities: INVOER.notities.map((n) => ({ title: n.titel })), bijlagen: INVOER.bijlagen.map((b) => ({ fullPath: b.bestandsnaam })) };
  const plan = planSchrijfacties(9001, INVOER, bestaand);
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(at.calls.length, 0);
  assert.match(r.uitvoer, /staat er al/);
});

test("tekst met wachtwoord wordt niet geplaatst", async () => {
  const at = nepAt();
  const plan = planSchrijfacties(9001, { notities: [{ titel: "T", tekst: "wachtwoord: Geheim123!" }], bijlagen: [] }, {});
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(at.calls.length, 0);
  assert.match(r.uitvoer, /wachtwoord/);
});

test("maakAt.postProjectNote doet POST Projects/<id>/Notes", async () => {
  let gezien;
  const at = maakAt({
    creds: { username: "u", secret: "s", integrationCode: "i", zone: "19" },
    fetch: async (url, o) => { gezien = [url, o.method, JSON.parse(o.body)]; return { ok: true, json: async () => ({ itemId: 1 }) }; },
  });
  await at.postProjectNote(9001, { projectID: 9001, title: "t" });
  assert.equal(gezien[0], "https://webservices19.autotask.net/ATServicesRest/V1.0/Projects/9001/Notes");
  assert.equal(gezien[1], "POST");
});

test("CLI zonder toepassen leest alleen en schrijft niet", async () => {
  const at = { ...nepAt(), async queryProjectNotes() { return []; }, async get() { return { items: [] }; } };
  const r = await hoofd(["--project", "9001", "--plan", "plan.json"], { at, lees: () => JSON.stringify(INVOER) });
  assert.equal(r.code, 0);
  assert.equal(at.calls.length, 0);
});

test("plan: dubbele titel of fullPath binnen een plan wordt maar een keer nieuw", () => {
  const plan = planSchrijfacties(9001, {
    notities: [{ titel: "A", tekst: "1" }, { titel: " a ", tekst: "2" }],
    bijlagen: [{ titel: "x", bestandsnaam: "X.docx", pad: "p" }, { titel: "y", bestandsnaam: "x.DOCX", pad: "q" }],
  }, {});
  assert.deepEqual(plan.notities.map((n) => n.actie), ["nieuw", "overslaan"]);
  assert.deepEqual(plan.bijlagen.map((n) => n.actie), ["nieuw", "overslaan"]);
});

test("bijlagen uit het plan (PVA) zijn intern: publish 2", async () => {
  const at = nepAt();
  await voerUit(at, planSchrijfacties(9001, INVOER, {}), { toepassen: true, lees });
  const bijlagen = at.calls.filter((c) => c[0] === "bijlage");
  assert.equal(bijlagen.length, 2);
  for (const [, , b] of bijlagen) assert.equal(b.publish, 2);
});

test("voorvertoning toont de volledige notitietekst en per bijlage pad en grootte", async () => {
  const at = nepAt();
  const invoer = {
    notities: [{ titel: "Projectstart: briefing kick-off", tekst: "Regel een\nRegel twee met details" }],
    bijlagen: [{ titel: "Mini PVA Voorbeeld v1", bestandsnaam: "Mini PVA Voorbeeld v1.docx", pad: "C:/x/pva.docx" }],
  };
  const r = await voerUit(at, planSchrijfacties(9001, invoer, {}), { toepassen: false, lees: () => Buffer.from("12345") });
  assert.equal(at.calls.length, 0);
  assert.match(r.uitvoer, /Regel een\nRegel twee met details/);
  assert.match(r.uitvoer, /C:\/x\/pva\.docx/);
  assert.match(r.uitvoer, /5 bytes/);
});

test("voorvertoning: ontbrekend bestand is een fout, geen crash", async () => {
  const invoer = { notities: [], bijlagen: [{ titel: "x", bestandsnaam: "x.docx", pad: "C:/weg.docx" }] };
  const r = await voerUit(nepAt(), planSchrijfacties(9001, invoer, {}), { toepassen: false, lees: () => { throw new Error("ENOENT"); } });
  assert.equal(r.fouten, 1);
  assert.match(r.uitvoer, /C:\/weg\.docx/);
});

const LINK = { titel: "Kick-off presentatie Voorbeeld Techniek", url: "https://claude.ai/artifact/pres" };

test("link-bijlage: POST met attachmentType URL, publish 2, fullPath = url, zonder bestand te lezen", async () => {
  const at = nepAt();
  const plan = planSchrijfacties(9001, { notities: [], bijlagen: [LINK] }, {});
  await voerUit(at, plan, { toepassen: true, lees: () => { throw new Error("mag niet lezen"); } });
  assert.equal(at.calls.length, 1);
  assert.deepEqual(at.calls[0][2], { parentID: 9001, attachmentType: "URL", publish: 2, title: LINK.titel, fullPath: LINK.url });
});

test("link-bijlage: voorvertoning noemt titel en url, geen POST", async () => {
  const at = nepAt();
  const r = await voerUit(at, planSchrijfacties(9001, { bijlagen: [LINK] }, {}), { toepassen: false, lees: () => { throw new Error("nee"); } });
  assert.equal(at.calls.length, 0);
  assert.equal(r.fouten, 0);
  assert.match(r.uitvoer, /Link-bijlage "Kick-off presentatie Voorbeeld Techniek" wordt geplaatst: https:\/\/claude\.ai\/artifact\/pres/);
});

test("link-bijlage: bestaande fullPath (exact na trim) en dubbele url in plan worden overgeslagen", async () => {
  const plan = planSchrijfacties(9001, { bijlagen: [LINK, { titel: "nog eens", url: ` ${LINK.url} ` }, { titel: "ander", url: "https://claude.ai/artifact/rap" }] },
    { bijlagen: [{ fullPath: `${LINK.url} ` }] });
  assert.deepEqual(plan.bijlagen.map((b) => b.actie), ["overslaan", "overslaan", "nieuw"]);
  const at = nepAt();
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(at.calls.length, 1);
  assert.match(r.uitvoer, /Link-bijlage "Kick-off presentatie Voorbeeld Techniek" staat er al; overgeslagen/);
});

test("link-bijlage: url vergelijken is hoofdlettergevoelig", () => {
  const plan = planSchrijfacties(9001, { bijlagen: [{ titel: "a", url: "https://x.example/A" }] }, { bijlagen: [{ fullPath: "https://x.example/a" }] });
  assert.equal(plan.bijlagen[0].actie, "nieuw");
});

test("link-bijlage: url zonder https:// is een fout en wordt niet geplaatst", async () => {
  const at = nepAt();
  const plan = planSchrijfacties(9001, { bijlagen: [{ titel: "x", url: "http://claude.ai/a" }, { titel: "y", url: "javascript:alert(1)" }] }, {});
  for (const toepassen of [false, true]) {
    const r = await voerUit(at, plan, { toepassen, lees });
    assert.equal(r.fouten, 2);
    assert.match(r.uitvoer, /https:\/\//);
  }
  assert.equal(at.calls.length, 0);
});
