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

// --- Technische taken (Easywork Basic) ---

const FASES = [{ id: 501, title: "Voorbereidings- en planningsfase" }, { id: 502, title: "Realisatie- en uitvoeringsfase" }, { id: 503, title: "Opleveringsfase" }];
const TEKST = "Stap 10 van 28. Wacht op: Licentie plan maken\nSubtaken volgens het Easywork-draaiboek.\n\nEngineer\n1. [ ] Setup Conditional Access";
const SJ = (titel, extra = {}) => ({ titel, sjabloon: true, fase: "Realisatie- en uitvoeringsfase", status: "nodig", uren: null, stap: 10, punten: 8, open: 7, omschrijving: TEKST, ...extra });
const EIGEN = { titel: "Proefmigratie uitvoeren", sjabloon: false, fase: "realisatie-  en uitvoeringsfase", status: "nodig", uren: 4, bron: "Mail Sanne de Vries 2026-11-12", stap: 17, punten: 1, open: 1, omschrijving: "Stap 17 van 28. Wacht op: Setup Microsoft 365\nTaak voor dit project." };
const AT_TAAK = (id, title, extra = {}) => ({ id, title, status: 1, description: "", estimatedHours: 8, ...extra });

function nepAtTaken() {
  const at = nepAt();
  at.postProjectTask = async (p, b) => { at.calls.push(["taak", p, b]); return { itemId: 900 }; };
  at.postTaskNote = async (b) => { at.calls.push(["taaknotitie", b]); return { itemId: 901 }; };
  at.patchTask = async (p, b) => { at.calls.push(["patch", p, b]); return { itemId: b.id }; };
  return at;
}
const bestaand = (taken, extra = {}) => ({ fases: FASES, taken, ...extra });

test("sjabloontaak met lege omschrijving: voorvertoning 'omschrijving vullen', daarna PATCH met id en description", async () => {
  const at = nepAtTaken();
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup Microsoft 365")] }, bestaand([AT_TAAK(71, "Setup Microsoft 365", { description: "  " })]));
  assert.equal(plan.taken[0].actie, "omschrijving");
  const voor = await voerUit(at, plan, { toepassen: false, lees });
  assert.equal(at.calls.length, 0);
  assert.match(voor.uitvoer, /Taak "Setup Microsoft 365" \(stap 10\): omschrijving vullen \(8 punten, 7 open\):\nStap 10 van 28/);
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.deepEqual(at.calls, [["patch", 9001, { id: 71, description: TEKST }]]);
  assert.equal(r.taakAanpassingen, 1);
  assert.match(r.uitvoer, /omschrijving gevuld/);
});

test("sjabloontaak: titel op schrijfwijze van Autotask (spaties, hoofdletters) gevonden", () => {
  const plan = planSchrijfacties(9001, { taken: [SJ("Licentieplan maken", { autotaskTitel: "Licentie plan maken" }), SJ("setup  intune")] },
    bestaand([AT_TAAK(72, "Licentie plan maken"), AT_TAAK(73, "Setup Intune")]));
  assert.deepEqual(plan.taken.map((t) => [t.actie, t.taskId]), [["omschrijving", 72], ["omschrijving", 73]]);
});

test("sjabloontaak met gevulde omschrijving: nooit overschrijven, notitie 'Projectstart: subtaken' (en niet dubbel)", async () => {
  const at = nepAtTaken();
  const er = AT_TAAK(71, "Setup Microsoft 365", { description: "Door de projectleider ingevuld." });
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup Microsoft 365")] }, bestaand([er]));
  assert.equal(plan.taken[0].actie, "notitie");
  const voor = await voerUit(at, plan, { toepassen: false, lees });
  assert.match(voor.uitvoer, /Taak "Setup Microsoft 365" \(stap 10\): omschrijving staat er al; notitie "Projectstart: subtaken" toevoegen:\nStap 10/);
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(at.calls.length, 1);
  assert.deepEqual(at.calls[0], ["taaknotitie", { taskID: 71, title: "Projectstart: subtaken", description: TEKST, noteType: 3, publish: 2 }]);
  assert.match(r.uitvoer, /omschrijving staat er al; notitie toegevoegd/);
  const nogEens = planSchrijfacties(9001, { taken: [SJ("Setup Microsoft 365")] }, bestaand([er], { taakNotities: [{ taskID: 71, title: "Projectstart: subtaken", description: ` ${TEKST} ` }] }));
  assert.equal(nogEens.taken[0].actie, "notitieStaatEr");
  const at2 = nepAtTaken();
  await voerUit(at2, nogEens, { toepassen: true, lees });
  assert.equal(at2.calls.length, 0);
});

test("sjabloontaak waar de omschrijving al precies zo staat: overslaan", () => {
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup Microsoft 365")] }, bestaand([AT_TAAK(71, "Setup Microsoft 365", { description: TEKST })]));
  assert.equal(plan.taken[0].actie, "overslaan");
});

test("sjabloontaak n.v.t.: eerst notitie met reden, dan PATCH status 5 en 0 uur; voorvertoning schrijft niets", async () => {
  const at = nepAtTaken();
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup telefonie", { status: "nvt", reden: "Telefonie valt buiten de offerte", stap: null })] }, bestaand([AT_TAAK(74, "Setup telefonie")]));
  assert.equal(plan.taken[0].actie, "nvt");
  const voor = await voerUit(at, plan, { toepassen: false, lees });
  assert.equal(at.calls.length, 0);
  assert.match(voor.uitvoer, /Taak "Setup telefonie": n\.v\.t\., sluiten met reden \(status Complete, 0 uur\), notitie "Projectstart: niet van toepassing": Niet van toepassing: Telefonie valt buiten de offerte/);
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.deepEqual(at.calls, [
    ["taaknotitie", { taskID: 74, title: "Projectstart: niet van toepassing", description: "Niet van toepassing: Telefonie valt buiten de offerte", noteType: 3, publish: 2 }],
    ["patch", 9001, { id: 74, status: 5, estimatedHours: 0 }],
  ]);
  assert.match(r.uitvoer, /n\.v\.t\., gesloten met reden/);
});

test("sjabloontaak n.v.t.: faalt de notitie, dan blijft de taak open (geen PATCH)", async () => {
  const at = nepAtTaken();
  at.postTaskNote = async () => { throw new Error("400"); };
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup telefonie", { status: "nvt", reden: "x" })] }, bestaand([AT_TAAK(74, "Setup telefonie")]));
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(r.fouten, 1);
  assert.equal(at.calls.filter((c) => c[0] === "patch").length, 0);
});

test("afgeronde taak (status 5) wordt nooit aangeraakt, ook niet bij n.v.t.", async () => {
  const at = nepAtTaken();
  const taken = [SJ("Setup Microsoft 365"), SJ("Setup telefonie", { status: "nvt", reden: "x" })];
  const plan = planSchrijfacties(9001, { taken }, bestaand([AT_TAAK(71, "Setup Microsoft 365", { status: 5 }), AT_TAAK(74, "Setup telefonie", { status: 5, description: "" })]));
  assert.deepEqual(plan.taken.map((t) => t.actie), ["afgerond", "afgerond"]);
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(at.calls.length, 0);
  assert.match(r.uitvoer, /staat op Complete in Autotask; niet aangepast/);
});

test("sjabloontaak die niet in het project staat: gemeld, niet aangemaakt, geen fout", async () => {
  const at = nepAtTaken();
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup netwerk")] }, bestaand([]));
  assert.equal(plan.taken[0].actie, "ontbreekt");
  for (const toepassen of [false, true]) {
    const r = await voerUit(at, plan, { toepassen, lees });
    assert.equal(r.fouten, 0);
    assert.equal(r.ontbreekt, 1);
    assert.match(r.uitvoer, /Taak "Setup netwerk" \(stap 10\): sjabloontaak ontbreekt in project; niet aangemaakt/);
  }
  assert.equal(at.calls.length, 0);
});

test("omschrijving langer dan 8000 tekens: ingekort in de omschrijving, volledig als notitie", async () => {
  const lang = "Stap 1 van 2. Wacht op: geen andere taak\n" + Array.from({ length: 500 }, (_, i) => `${i + 1}. [ ] Punt ${i + 1} met wat uitleg`).join("\n");
  const at = nepAtTaken();
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup Microsoft 365", { omschrijving: lang })] }, bestaand([AT_TAAK(71, "Setup Microsoft 365")]));
  const voor = await voerUit(at, plan, { toepassen: false, lees });
  assert.match(voor.uitvoer, /langer dan 8000 tekens en komt als notitie "Projectstart: subtaken"/);
  await voerUit(at, plan, { toepassen: true, lees });
  const patch = at.calls.find((c) => c[0] === "patch")[2];
  assert.ok(patch.description.length <= 8000);
  assert.match(patch.description, /zie notitie Projectstart: subtaken/);
  const notitie = at.calls.find((c) => c[0] === "taaknotitie")[1];
  assert.equal(notitie.description, lang);
});

test("taak buiten het sjabloon: voorvertoning 'nieuwe taak in <fase>', daarna POST met fase, taskType 1, status 1, uren", async () => {
  const at = nepAtTaken();
  const plan = planSchrijfacties(9001, { taken: [EIGEN, { ...EIGEN, titel: "Zonder uren", uren: null }] }, bestaand([]));
  assert.deepEqual(plan.taken.map((t) => [t.actie, t.phaseID]), [["nieuw", 502], ["nieuw", 502]]);
  const voor = await voerUit(at, plan, { toepassen: false, lees });
  assert.equal(at.calls.length, 0);
  assert.match(voor.uitvoer, /Taak "Proefmigratie uitvoeren" \(stap 17\): nieuwe taak in Realisatie- en uitvoeringsfase, 4 uur, omschrijving:\nStap 17/);
  const r = await voerUit(at, plan, { toepassen: true, lees });
  const posts = at.calls.filter((c) => c[0] === "taak");
  assert.deepEqual(posts[0][2], { projectID: 9001, phaseID: 502, title: "Proefmigratie uitvoeren", description: EIGEN.omschrijving, taskType: 1, status: 1, estimatedHours: 4 });
  assert.equal(posts[1][2].estimatedHours, 0);
  for (const [, , b] of posts) for (const v of ["assignedResourceID", "departmentID", "billingCodeID"]) assert.ok(!(v in b));
  assert.equal(r.taken, 2);
  assert.match(r.uitvoer, /aangemaakt in Realisatie- en uitvoeringsfase/);
});

test("taak buiten het sjabloon: onbekende fase is een fout; n.v.t. wordt niet aangemaakt; bestaande krijgt een aanvulling", async () => {
  const at = nepAtTaken();
  const plan = planSchrijfacties(9001, { taken: [{ ...EIGEN, fase: "Uitvoering" }, { ...EIGEN, titel: "Weg", status: "nvt", reden: "Vervallen" }, { ...EIGEN, titel: "Bestaat al" }] },
    bestaand([AT_TAAK(80, "Bestaat al", { description: "Anders", estimatedHours: 2 })]));
  assert.deepEqual(plan.taken.map((t) => t.actie), ["faseOnbekend", "nvtNietAangemaakt", "notitie"]);
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(r.fouten, 1);
  assert.match(r.uitvoer, /fase "Uitvoering" niet gevonden; niet aangemaakt/);
  assert.match(r.uitvoer, /n\.v\.t\. \(Vervallen\); niet aangemaakt/);
  assert.deepEqual(at.calls.map((c) => c[0]), ["taaknotitie"]);
  assert.equal(at.calls[0][1].title, "Projectstart: aanvulling");
  assert.match(at.calls[0][1].description, /Uren volgens de offerte: 4 uur \(nu in de taak: 2 uur\)/);
});

test("dubbele titel in het plan wordt maar een keer behandeld", () => {
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup Intune"), SJ("SETUP INTUNE")] }, bestaand([AT_TAAK(73, "Setup Intune")]));
  assert.deepEqual(plan.taken.map((t) => t.actie), ["omschrijving", "dubbel"]);
});

test("tekst met een wachtwoord gaat niet naar een taak", async () => {
  const at = nepAtTaken();
  const plan = planSchrijfacties(9001, { taken: [SJ("Setup Intune", { omschrijving: "wachtwoord: Geheim123!" })] }, bestaand([AT_TAAK(73, "Setup Intune")]));
  const r = await voerUit(at, plan, { toepassen: true, lees });
  assert.equal(at.calls.length, 0);
  assert.equal(r.fouten, 1);
});

test("CLI met taken: leest fases, taken en taaknotities, schrijft zonder --toepassen niets", async () => {
  const gelezen = [];
  const at = {
    ...nepAtTaken(),
    async queryProjectNotes() { return []; },
    async get() { return { items: [] }; },
    async getProjectPhases(p) { gelezen.push(["fases", p]); return FASES; },
    async getProjectTasks(p) { gelezen.push(["taken", p]); return [AT_TAAK(71, "Setup Microsoft 365", { description: "Al ingevuld" }), AT_TAAK(74, "Setup telefonie")]; },
    async query(entity, filter) { gelezen.push([entity, filter[0].value]); return []; },
  };
  const invoer = { taken: [SJ("Setup Microsoft 365"), SJ("Setup telefonie", { status: "nvt", reden: "x" }), EIGEN] };
  const r = await hoofd(["--project", "9001", "--plan", "plan.json"], { at, lees: () => JSON.stringify(invoer) });
  assert.equal(r.code, 0, r.uitvoer);
  assert.deepEqual(gelezen, [["fases", 9001], ["taken", 9001], ["TaskNotes", 71], ["TaskNotes", 74]]);
  assert.equal(at.calls.length, 0);
  assert.match(r.uitvoer, /omschrijving staat er al; notitie/);
  assert.match(r.uitvoer, /n\.v\.t\., sluiten met reden/);
  assert.match(r.uitvoer, /nieuwe taak in Realisatie- en uitvoeringsfase/);
});

test("CLI zonder taken in het plan leest geen fases of taken", async () => {
  const at = { ...nepAt(), async queryProjectNotes() { return []; }, async get() { return { items: [] }; },
    async getProjectPhases() { throw new Error("niet nodig"); }, async getProjectTasks() { throw new Error("niet nodig"); } };
  const r = await hoofd(["--project", "9001", "--plan", "plan.json"], { at, lees: () => JSON.stringify(INVOER) });
  assert.equal(r.code, 0, r.uitvoer);
});

test("plan uit taken.mjs voor het voorbeelddossier: elke taak een herkenbare actie, voorvertoning in volgorde", async () => {
  const { takenVoorPlan } = await import("./taken.mjs");
  const { readFileSync } = await import("node:fs");
  const d = JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
  const taken = takenVoorPlan(d);
  const projectTaken = taken.filter((t) => t.sjabloon).map((t, i) => AT_TAAK(100 + i, t.titel));
  const plan = planSchrijfacties(9001, { taken }, bestaand(projectTaken));
  const acties = plan.taken.map((t) => t.actie);
  assert.equal(acties.filter((a) => a === "omschrijving").length, 27);
  assert.equal(acties.filter((a) => a === "nvt").length, 2);
  assert.equal(acties.filter((a) => a === "nieuw").length, 1);
  const r = await voerUit(nepAtTaken(), plan, { toepassen: false, lees });
  assert.equal(r.fouten, 0, r.uitvoer);
  assert.ok(r.uitvoer.indexOf('Taak "Setup Microsoft 365"') < r.uitvoer.indexOf('Taak "Project afsluitingsgesprek"'), "voorvertoning in logische volgorde");
});
