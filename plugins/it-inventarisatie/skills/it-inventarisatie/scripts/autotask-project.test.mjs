import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SJABLOON_TAKEN, TAAK_KOPPELING, normaliseerTitel, planTaskUpdates, toonPlan, pasToe,
  haalCredentials, maakAt, hoofd,
} from "./autotask-project.mjs";
import { nieuw } from "./werkbestand.mjs";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/autotask-taken.voorbeeld.json", import.meta.url), "utf8"));
const OPTIES = { datum: "04-11-2026", engineer: "Voorbeeld Engineer" };

function werkbestand() {
  return {
    schema: 1,
    klant: "Voorbeeld Techniek B.V.",
    slug: "voorbeeld-techniek-bv",
    offerte: {
      scope: { m365: true, werkplekken: true, server: false, netwerk: true, printers: true, applicaties: true, telefonie: false, beveiliging: true },
      uren: [{ fase: "setup netwerk", uren: 6 }, { fase: "Voorbereiding", uren: 4 }],
    },
    antwoorden: {
      netwerk: {
        internet: "Glasvezel 500/500",
        aantalSwitches: 3,
        accessPoints: ["Kantoor", "Werkplaats"],
        adminPassword: "Geheim-Netwerk-123",
        firewall: { merk: "Voorbeeldmerk", beheerWachtwoord: "Ook-Geheim-456" },
        opmerking: "wachtwoord: Vrijetekst-789",
      },
      mail: { mailboxen: 24, gedeeldeMailboxen: ["info", "facturen"] },
      beveiliging: { mfa: "Voor alle gebruikers" },
    },
    autotask: { companyId: 900100, projectId: 900001, toegepast: false },
  };
}

const plan = () => planTaskUpdates(fixture().taken, werkbestand(), OPTIES);
const wijziging = (p, titel) => p.wijzigingen.find((w) => w.titel === titel);

test("SJABLOON_TAKEN heeft de 29 taken van Easywork Basic", () => {
  assert.equal(SJABLOON_TAKEN.length, 29);
  assert.equal(new Set(SJABLOON_TAKEN).size, 29);
  for (const t of ["Administratieve opstart project", "Setup telefonie", "Initiële datamigratie", "NACALC (Werkzaamheden buiten scope)", "After sales"]) {
    assert.ok(SJABLOON_TAKEN.includes(t), t);
  }
});

test("TAAK_KOPPELING volgt de sjabloontabel en verwijst alleen naar sjabloontaken", () => {
  assert.deepEqual(TAAK_KOPPELING["Setup telefonie"], { onderdelen: ["telefonie"], scope: "telefonie" });
  assert.deepEqual(TAAK_KOPPELING["Telefonie oplevering op locatie"], { onderdelen: ["telefonie"], scope: "telefonie" });
  assert.deepEqual(TAAK_KOPPELING["Setup netwerk"], { onderdelen: ["netwerk"], scope: "netwerk" });
  assert.deepEqual(TAAK_KOPPELING["Initiële datamigratie"], { onderdelen: ["server"], scope: "server" });
  assert.deepEqual(TAAK_KOPPELING["Definitieve datamigratie"], { onderdelen: ["server"], scope: "server" });
  assert.deepEqual(TAAK_KOPPELING["Mailmigratie Microsoft 365"], { onderdelen: ["mail"], scope: "m365" });
  assert.deepEqual(TAAK_KOPPELING["Setup Microsoft 365"], { onderdelen: ["mail", "licenties", "beveiliging"], scope: "m365" });
  assert.deepEqual(TAAK_KOPPELING["Huidige documentatie ontvangen"], { onderdelen: ["documentatie"] });
  assert.equal(Object.keys(TAAK_KOPPELING).length, 14);
  for (const t of Object.keys(TAAK_KOPPELING)) assert.ok(SJABLOON_TAKEN.includes(t), t);
});

test("normaliseerTitel negeert hoofdletters, diakritische tekens en extra spaties", () => {
  assert.equal(normaliseerTitel("  Initiële  Datamigratie "), normaliseerTitel("initiele datamigratie"));
});

test("telefonie buiten scope: Setup telefonie wordt nvt met status 5, 0 uur en notitie", () => {
  const w = wijziging(plan(), "Setup telefonie");
  assert.equal(w.actie, "nvt");
  assert.equal(w.taskId, 910001);
  assert.equal(w.status, 5);
  assert.equal(w.estimatedHours, 0);
  assert.equal(w.notitie.titel, "Inventarisatie 04-11-2026");
  assert.equal(w.notitie.tekst, "Niet van toepassing volgens de inventarisatie van 04-11-2026 (Voorbeeld Engineer): telefonie valt niet in de offerte.");
  assert.equal(w.omschrijving, undefined);
});

test("server buiten scope: Initiele datamigratie (zonder trema) wordt ook nvt", () => {
  const w = wijziging(plan(), "Initiele datamigratie");
  assert.equal(w.actie, "nvt");
  assert.match(w.notitie.tekst, /: server valt niet in de offerte\.$/);
});

test("netwerk in scope: Setup netwerk wordt aanvullen met details en uren uit de offerte", () => {
  const w = wijziging(plan(), "Setup netwerk");
  assert.equal(w.actie, "aanvullen");
  assert.equal(w.status, undefined);
  assert.equal(w.estimatedHours, 6);
  assert.equal(w.notitie.titel, "Inventarisatie 04-11-2026");
  assert.ok(w.notitie.tekst.startsWith("Inventarisatie 04-11-2026 (Voorbeeld Engineer)"));
  assert.match(w.notitie.tekst, /aantal switches: 3/);
  assert.match(w.notitie.tekst, /Glasvezel 500\/500/);
  assert.match(w.notitie.tekst, /Voorbeeldmerk/);
  assert.ok(w.omschrijving.length > 0);
  assert.ok(w.omschrijving.length <= 1000);
});

test("geheimen komen niet in notitie of omschrijving", () => {
  const p = plan();
  const alles = JSON.stringify(p) + toonPlan(p);
  for (const geheim of ["Geheim-Netwerk-123", "Ook-Geheim-456", "Vrijetekst-789", "adminPassword", "beheerWachtwoord"]) {
    assert.ok(!alles.includes(geheim), geheim);
  }
  assert.match(wijziging(p, "Setup netwerk").notitie.tekst, /staat in IT Glue/);
});

test("bestaande omschrijving blijft vooraan staan", () => {
  const w = wijziging(plan(), "Setup Microsoft 365");
  assert.equal(w.actie, "aanvullen");
  assert.ok(w.omschrijving.startsWith("Afstemmen met de klant over de tenant."));
  assert.match(w.omschrijving, /Inventarisatie 04-11-2026/);
  assert.equal(w.estimatedHours, undefined, "geen fase in de offerte, uren blijven ongewijzigd");
});

test("eigen taak staat in onbekend en niet in wijzigingen; taak zonder koppeling wordt niet aangeraakt", () => {
  const p = plan();
  assert.deepEqual(p.onbekend, ["Koffieautomaat aansluiten op het netwerk"]);
  assert.ok(!p.wijzigingen.some((w) => w.taskId === 910007));
  assert.ok(!p.wijzigingen.some((w) => w.titel === "Project opstart"));
});

test("ontbrekende sjabloontaken staan in ontbrekend", () => {
  const p = plan();
  assert.equal(p.projectId, 900001);
  assert.equal(p.ontbrekend.length, 29 - 6);
  assert.ok(p.ontbrekend.includes("Setup Intune"));
  assert.ok(!p.ontbrekend.includes("Setup netwerk"));
  assert.ok(!p.ontbrekend.includes("Initiële datamigratie"), "Initiele telt als Initiële");
});

test("taken met status 5 worden overgeslagen", () => {
  const taken = fixture().taken.map((t) => (t.title === "Setup telefonie" ? { ...t, status: 5 } : t));
  const p = planTaskUpdates(taken, werkbestand(), OPTIES);
  assert.equal(wijziging(p, "Setup telefonie"), undefined);
  assert.ok(!p.ontbrekend.includes("Setup telefonie"));
});

test("nieuw werkbestand (scope onbekend): geen enkele taak wordt nvt", () => {
  const p = planTaskUpdates(fixture().taken, nieuw("Voorbeeld Techniek B.V."), OPTIES);
  assert.deepEqual(p.wijzigingen.filter((w) => w.actie === "nvt"), []);
});

test("alleen scope false is buiten scope; null en true niet", () => {
  const wb = werkbestand();
  wb.offerte.scope.telefonie = null;
  wb.offerte.scope.server = true;
  const p = planTaskUpdates(fixture().taken, wb, OPTIES);
  assert.notEqual(wijziging(p, "Setup telefonie")?.actie, "nvt");
  assert.notEqual(wijziging(p, "Initiele datamigratie")?.actie, "nvt");
  assert.equal(p.wijzigingen.filter((w) => w.actie === "nvt").length, 0);
});

test("opnieuw plannen voegt de samenvatting niet nog eens toe aan de omschrijving", () => {
  const eerste = wijziging(plan(), "Setup netwerk");
  const taken = fixture().taken.map((t) => (t.id === 910002 ? { ...t, description: eerste.omschrijving, estimatedHours: 6 } : t));
  const p = planTaskUpdates(taken, werkbestand(), OPTIES);
  const w = wijziging(p, "Setup netwerk");
  assert.equal(w.omschrijving, undefined);
  assert.equal(w.estimatedHours, undefined);
  assert.ok(w.notitie, "notitie blijft in het plan; pasToe slaat hem over als hij al bestaat");
});

test("datum als Date wordt dd-mm-jjjj", () => {
  const p = planTaskUpdates(fixture().taken, werkbestand(), { datum: new Date(2026, 10, 4), engineer: "X" });
  assert.equal(wijziging(p, "Setup telefonie").notitie.titel, "Inventarisatie 04-11-2026");
});

test("lange antwoorden: omschrijving max 1000 tekens, notitie max 32000 tekens", () => {
  const wb = werkbestand();
  wb.antwoorden.netwerk.lijst = Array.from({ length: 2000 }, (_, i) => `switch-${i} met een lange omschrijving van de poorten`);
  const w = wijziging(planTaskUpdates(fixture().taken, wb, OPTIES), "Setup netwerk");
  assert.ok(w.omschrijving.length <= 1000);
  assert.ok(w.notitie.tekst.length <= 32000);
});

test("toonPlan laat per taak de wijziging zien, plus ontbrekend en onbekend", () => {
  const uit = toonPlan(plan());
  assert.match(uit, /Setup telefonie/);
  assert.match(uit, /niet van toepassing/i);
  assert.match(uit, /status 5/i);
  assert.match(uit, /8 → 6/);
  assert.match(uit, /Koffieautomaat/);
  assert.match(uit, /Setup Intune/);
  assert.ok(!uit.includes("—"), "geen em-dashes");
});

function nepAt() {
  const calls = [];
  return {
    calls,
    async patchTask(projectId, body) { calls.push(["patchTask", projectId, body]); return { itemId: body.id }; },
    async postTaskNote(body) { calls.push(["postTaskNote", body]); return { itemId: 1 }; },
    async postProjectAttachment(projectId, body) { calls.push(["postProjectAttachment", projectId, body]); return { itemId: 2 }; },
  };
}

test("pasToe patcht taken en plaatst notities met noteType 3 en publish 2", async () => {
  const at = nepAt();
  const r = await pasToe(plan(), { at, bestaandeNotities: [] });
  const patch = at.calls.find((c) => c[0] === "patchTask" && c[2].id === 910001);
  assert.deepEqual(patch, ["patchTask", 900001, { id: 910001, status: 5, estimatedHours: 0 }]);
  const netwerk = at.calls.find((c) => c[0] === "patchTask" && c[2].id === 910002);
  assert.equal(netwerk[2].estimatedHours, 6);
  assert.ok(netwerk[2].description.length > 0);
  const note = at.calls.find((c) => c[0] === "postTaskNote" && c[1].taskID === 910001)[1];
  assert.deepEqual(Object.keys(note).sort(), ["description", "noteType", "publish", "taskID", "title"]);
  assert.equal(note.noteType, 3);
  assert.equal(note.publish, 2);
  assert.equal(note.title, "Inventarisatie 04-11-2026");
  assert.equal(r.fouten.length, 0);
  assert.equal(r.taken, plan().wijzigingen.length);
});

test("pasToe slaat een notitie over als dezelfde titel al op die taak staat", async () => {
  const at = nepAt();
  const r = await pasToe(plan(), { at, bestaandeNotities: [{ taskID: 910001, title: "Inventarisatie 04-11-2026" }] });
  const notes = at.calls.filter((c) => c[0] === "postTaskNote");
  assert.ok(!notes.some((c) => c[1].taskID === 910001), "geen tweede notitie op Setup telefonie");
  assert.ok(notes.some((c) => c[1].taskID === 910002), "andere taken krijgen wel hun notitie");
  assert.ok(r.overgeslagen.some((o) => o.taskId === 910001));
});

test("pasToe weigert een notitie met een wachtwoord in vrije tekst (aangepast plan.json)", async () => {
  const at = nepAt();
  const p = plan();
  wijziging(p, "Setup netwerk").notitie.tekst += "\nwachtwoord: handmatig-ingevuld";
  const r = await pasToe(p, { at, bestaandeNotities: [] });
  assert.ok(!at.calls.some((c) => c[0] === "postTaskNote" && c[1].taskID === 910002));
  assert.ok(r.fouten.some((f) => f.taskId === 910002));
});

test("pasToe gaat door na een fout en meldt die zonder stacktrace", async () => {
  const at = nepAt();
  at.patchTask = async (projectId, body) => { if (body.id === 910001) throw new Error("Autotask API fout 500"); at.calls.push(["patchTask", projectId, body]); };
  const r = await pasToe(plan(), { at, bestaandeNotities: [] });
  assert.equal(r.fouten.length, 1);
  assert.equal(r.fouten[0].taskId, 910001);
  assert.ok(at.calls.some((c) => c[0] === "patchTask" && c[2].id === 910002));
});

test("pasToe nvt: notitie eerst; faalt de notitie, dan geen patch", async () => {
  const at = nepAt();
  at.postTaskNote = async (body) => { if (body.taskID === 910001) throw new Error("Autotask API fout 500"); at.calls.push(["postTaskNote", body]); };
  const r = await pasToe(plan(), { at, bestaandeNotities: [] });
  assert.ok(r.fouten.some((f) => f.taskId === 910001));
  assert.ok(!at.calls.some((c) => c[0] === "patchTask" && c[2].id === 910001), "geen status 5 zonder notitie");
  assert.ok(at.calls.some((c) => c[0] === "patchTask" && c[2].id === 910002), "andere taken gaan door");
});

test("pasToe nvt: patch faalt na de notitie; een tweede run patcht wel en dupliceert de notitie niet", async () => {
  const at = nepAt();
  const geplaatst = [];
  at.postTaskNote = async (body) => { geplaatst.push({ taskID: body.taskID, title: body.title }); at.calls.push(["postTaskNote", body]); };
  let faal = true;
  at.patchTask = async (projectId, body) => { if (faal && body.id === 910001) throw new Error("Autotask API fout 500"); at.calls.push(["patchTask", projectId, body]); };
  const eerste = await pasToe(plan(), { at, bestaandeNotities: [] });
  assert.ok(eerste.fouten.some((f) => f.taskId === 910001));
  assert.equal(geplaatst.filter((n) => n.taskID === 910001).length, 1);

  faal = false;
  // de taak staat nog open, dus het nieuwe plan bevat de nvt-actie opnieuw
  const tweede = await pasToe(plan(), { at, bestaandeNotities: geplaatst });
  assert.equal(tweede.fouten.length, 0);
  assert.deepEqual(at.calls.find((c) => c[0] === "patchTask" && c[2].id === 910001), ["patchTask", 900001, { id: 910001, status: 5, estimatedHours: 0 }]);
  assert.equal(geplaatst.filter((n) => n.taskID === 910001).length, 1, "geen tweede notitie");
});

// --- Credentials en HTTP-laag ---

function nepExec(waarden) {
  const calls = [];
  const exec = (cmd, args) => {
    const vault = args[args.indexOf("--vault-name") + 1];
    const naam = args[args.indexOf("--name") + 1];
    calls.push(`${vault}/${naam}`);
    const v = waarden[`${vault}/${naam}`];
    if (v === undefined) throw new Error("SecretNotFound");
    return v + "\r\n";
  };
  exec.calls = calls;
  return exec;
}

test("haalCredentials: juict-shared-kv eerst, CRLF weg, zone standaard 19", () => {
  const exec = nepExec({
    "juict-shared-kv/AUTOTASK-USERNAME": "u", "juict-shared-kv/AUTOTASK-API-KEY": "k", "juict-shared-kv/AUTOTASK-INTEGRATION-CODE": "c",
  });
  const c = haalCredentials({ exec, env: {} });
  assert.deepEqual(c, { username: "u", secret: "k", integrationCode: "c", zone: "19" });
  assert.equal(exec.calls[0], "juict-shared-kv/AUTOTASK-USERNAME");
});

test("haalCredentials: valt terug op ju-hermes-emmanuel en daarna op env", () => {
  const exec = nepExec({
    "ju-hermes-emmanuel/AUTOTASK-USERNAME": "u2", "ju-hermes-emmanuel/AUTOTASK-API-KEY": "k2",
    "ju-hermes-emmanuel/AUTOTASK-INTEGRATION-CODE": "c2", "ju-hermes-emmanuel/AUTOTASK-ZONE": "5",
  });
  assert.deepEqual(haalCredentials({ exec, env: {} }), { username: "u2", secret: "k2", integrationCode: "c2", zone: "5" });
  const env = { AUTOTASK_USERNAME: "u3", AUTOTASK_API_KEY: "k3", AUTOTASK_INTEGRATION_CODE: "c3" };
  assert.deepEqual(haalCredentials({ exec: nepExec({}), env }), { username: "u3", secret: "k3", integrationCode: "c3", zone: "19" });
  assert.throws(() => haalCredentials({ exec: nepExec({}), env: {} }), /Geen Autotask-gegevens/);
});

const CREDS = { username: "api-user", secret: "GEHEIM-SECRET-XYZ", integrationCode: "CODE-123", zone: "19" };

function nepFetch(antwoord = () => ({ items: [] })) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const r = antwoord(url, init);
    if (r && r.status) return { ok: false, status: r.status, text: async () => r.text ?? "", json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r) };
  };
  f.calls = calls;
  return f;
}

test("maakAt: query, patchTask, postTaskNote en postProjectAttachment op de juiste endpoints", async () => {
  const fetch = nepFetch();
  const at = maakAt({ fetch, creds: CREDS });
  await at.query("Tasks", [{ field: "projectID", op: "eq", value: 900001 }]);
  await at.patchTask(900001, { id: 910001, status: 5 });
  await at.postTaskNote({ taskID: 910001, title: "t", description: "d", noteType: 3, publish: 2 });
  await at.postProjectAttachment(900001, { parentID: 900001, title: "x" });
  await at.get("Projects/900001/Attachments");
  const base = "https://webservices19.autotask.net/ATServicesRest/V1.0/";
  assert.deepEqual(fetch.calls.map((c) => [c.method, c.url]), [
    ["POST", base + "Tasks/query"],
    ["PATCH", base + "Projects/900001/Tasks"],
    ["POST", base + "TaskNotes"],
    ["POST", base + "Projects/900001/Attachments"],
    ["GET", base + "Projects/900001/Attachments"],
  ]);
  assert.deepEqual(fetch.calls[0].body, { filter: [{ field: "projectID", op: "eq", value: 900001 }] });
  assert.equal(fetch.calls[0].headers.UserName, "api-user");
  assert.equal(fetch.calls[0].headers.Secret, "GEHEIM-SECRET-XYZ");
  assert.equal(fetch.calls[0].headers.ApiIntegrationCode, "CODE-123");
});

test("maakAt: query volgt nextPageUrl", async () => {
  const fetch = nepFetch((url) => (url.endsWith("/query")
    ? { items: [{ id: 1 }], pageDetails: { nextPageUrl: "https://webservices19.autotask.net/ATServicesRest/V1.0/Tasks/query/next?paging=abc" } }
    : { items: [{ id: 2 }], pageDetails: { nextPageUrl: null } }));
  const filter = [{ field: "projectID", op: "eq", value: 900001 }];
  const items = await maakAt({ fetch, creds: CREDS }).query("Tasks", filter);
  assert.deepEqual(items.map((i) => i.id), [1, 2]);
  // Autotask wil voor de volgende pagina een POST met dezelfde body (REFERENCE.md van autotask-api).
  assert.equal(fetch.calls[1].method, "POST");
  assert.deepEqual(fetch.calls[1].body, { filter });
});

test("maakAt: volgt geen nextPageUrl naar een andere host", async () => {
  const fetch = nepFetch((url) => (url.endsWith("/query") ? { items: [{ id: 1 }], pageDetails: { nextPageUrl: "https://elders.example/steel" } } : { items: [] }));
  await assert.rejects(maakAt({ fetch, creds: CREDS }).query("Tasks", []), /andere host/);
  assert.equal(fetch.calls.length, 1);
});

test("maakAt: foutmelding bevat geen secrets", async () => {
  const fetch = nepFetch(() => ({ status: 401, text: "bad creds api-user GEHEIM-SECRET-XYZ CODE-123" }));
  await assert.rejects(maakAt({ fetch, creds: CREDS }).get("Projects/1"), (e) => {
    assert.match(e.message, /401/);
    assert.ok(!e.message.includes("GEHEIM-SECRET-XYZ") && !e.message.includes("CODE-123") && !e.message.includes("api-user"));
    return true;
  });
});

test("maakAt: maximaal 2 verzoeken tegelijk", async () => {
  let bezig = 0, piek = 0;
  const fetch = async () => {
    bezig++; piek = Math.max(piek, bezig);
    await new Promise((r) => setTimeout(r, 5));
    bezig--;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const at = maakAt({ fetch, creds: CREDS });
  await Promise.all(Array.from({ length: 6 }, (_, i) => at.get(`Projects/${i}`)));
  assert.equal(piek, 2);
});


// --- CLI ---

function nepCliAt({ taken = fixture().taken, notities = [], bijlagen = [] } = {}) {
  const at = nepAt();
  at.query = async (entity, filter) => {
    at.calls.push(["query", entity, filter]);
    if (entity === "Projects") return [fixture().project];
    if (entity === "Tasks") return taken;
    if (entity === "TaskNotes") return notities.filter((n) => n.taskID === filter[0].value);
    return [];
  };
  at.get = async (path) => { at.calls.push(["get", path]); return { items: bijlagen }; };
  return at;
}

function nepBestanden(start = {}) {
  const bestanden = { ...start };
  return {
    bestanden,
    lees: (pad) => { if (!(pad in bestanden)) throw new Error("ENOENT"); return bestanden[pad]; },
    schrijf: (pad, inhoud) => { bestanden[pad] = inhoud; },
  };
}

const schrijfActies = (at) => at.calls.filter((c) => ["patchTask", "postTaskNote", "postProjectAttachment"].includes(c[0]));

test("cli zoek: open klantprojecten met projectType 5 en status niet 5", async () => {
  const at = nepCliAt();
  const r = await hoofd(["zoek", "--company", "900100"], { at });
  assert.equal(r.code, 0);
  assert.deepEqual(at.calls[0], ["query", "Projects", [
    { field: "companyID", op: "eq", value: 900100 },
    { field: "projectType", op: "eq", value: 5 },
    { field: "status", op: "noteq", value: 5 },
  ]]);
  assert.match(r.uitvoer, /900001/);
  assert.match(r.uitvoer, /Onboarding Voorbeeld Techniek/);
});

test("cli plan: leest taken en werkbestand, schrijft plan.json, schrijft niets naar Autotask", async () => {
  const at = nepCliAt();
  const fs = nepBestanden({ "wb.json": JSON.stringify(werkbestand()) });
  const r = await hoofd(["plan", "--project", "900001", "--werkbestand", "wb.json", "--uit", "plan.json", "--engineer", "Voorbeeld Engineer", "--datum", "04-11-2026"], { at, ...fs });
  assert.equal(r.code, 0, r.uitvoer);
  assert.deepEqual(at.calls[0], ["query", "Tasks", [{ field: "projectID", op: "eq", value: 900001 }]]);
  assert.equal(schrijfActies(at).length, 0);
  const opgeslagen = JSON.parse(fs.bestanden["plan.json"]);
  assert.equal(opgeslagen.projectId, 900001);
  assert.ok(!fs.bestanden["plan.json"].includes("Geheim-Netwerk-123"));
  assert.match(r.uitvoer, /Setup telefonie/);
});

test("cli toepassen zonder --toepassen is een voorvertoning", async () => {
  const at = nepCliAt();
  const fs = nepBestanden({ "plan.json": JSON.stringify(plan()) });
  const r = await hoofd(["toepassen", "--plan", "plan.json"], { at, ...fs });
  assert.equal(r.code, 0);
  assert.equal(schrijfActies(at).length, 0);
  assert.match(r.uitvoer, /--toepassen/);
});

test("cli toepassen --toepassen haalt bestaande notities op en slaat dubbele over", async () => {
  const at = nepCliAt({ notities: [{ taskID: 910001, title: "Inventarisatie 04-11-2026" }] });
  const fs = nepBestanden({ "plan.json": JSON.stringify(plan()) });
  const r = await hoofd(["toepassen", "--plan", "plan.json", "--toepassen"], { at, ...fs });
  assert.equal(r.code, 0, r.uitvoer);
  assert.ok(at.calls.some((c) => c[0] === "query" && c[1] === "TaskNotes"));
  assert.ok(!at.calls.some((c) => c[0] === "postTaskNote" && c[1].taskID === 910001));
  assert.ok(at.calls.some((c) => c[0] === "patchTask"));
});

test("cli bijlage: voorvertoning zonder --toepassen, upload met --toepassen", async () => {
  const pdf = Buffer.from("%PDF-1.4 voorbeeld");
  const fs = nepBestanden({ "rapport.pdf": pdf });
  let at = nepCliAt();
  let r = await hoofd(["bijlage", "--project", "900001", "--pdf", "rapport.pdf", "--klant", "Voorbeeld Techniek B.V."], { at, ...fs });
  assert.equal(r.code, 0, r.uitvoer);
  assert.equal(schrijfActies(at).length, 0);
  assert.match(r.uitvoer, /it-inventarisatie-voorbeeld-techniek-bv\.pdf/);

  at = nepCliAt();
  r = await hoofd(["bijlage", "--project", "900001", "--pdf", "rapport.pdf", "--klant", "Voorbeeld Techniek B.V.", "--toepassen"], { at, ...fs });
  assert.equal(r.code, 0, r.uitvoer);
  const [, projectId, body] = at.calls.find((c) => c[0] === "postProjectAttachment");
  assert.equal(projectId, 900001);
  assert.deepEqual(body, {
    parentID: 900001, attachmentType: "FILE_ATTACHMENT", publish: 1,
    title: "IT-inventarisatie Voorbeeld Techniek B.V.", fullPath: "it-inventarisatie-voorbeeld-techniek-bv.pdf",
    data: pdf.toString("base64"),
  });
});

test("cli bijlage: slaat over als dezelfde fullPath al op het project staat", async () => {
  const fs = nepBestanden({ "rapport.pdf": Buffer.from("%PDF") });
  const at = nepCliAt({ bijlagen: [{ id: 5, fullPath: "it-inventarisatie-voorbeeld-techniek-bv.pdf" }] });
  const r = await hoofd(["bijlage", "--project", "900001", "--pdf", "rapport.pdf", "--klant", "Voorbeeld Techniek B.V.", "--toepassen"], { at, ...fs });
  assert.equal(r.code, 0);
  assert.equal(schrijfActies(at).length, 0);
  assert.match(r.uitvoer, /staat al/);
});

test("cli: onbekend commando of ontbrekende argumenten geeft gebruik en code 1", async () => {
  const at = nepCliAt();
  assert.equal((await hoofd([], { at })).code, 1);
  assert.equal((await hoofd(["zoek"], { at })).code, 1);
  assert.equal((await hoofd(["plan", "--project", "abc", "--werkbestand", "x"], { at })).code, 1);
});

test("cli: API-fout wordt een nette melding met code 2", async () => {
  const at = nepCliAt();
  at.query = async () => { throw new Error("Autotask API fout 500"); };
  const r = await hoofd(["zoek", "--company", "900100"], { at });
  assert.equal(r.code, 2);
  assert.match(r.uitvoer, /500/);
  assert.ok(!r.uitvoer.includes("    at "), "geen stacktrace");
});

test("voorbeeldwerkbestand: offerte.uren gebruikt Easywork-taaktitels uit de taakkoppeling", () => {
  const wb = JSON.parse(readFileSync(new URL("../voorbeeld/inventarisatie.voorbeeld.json", import.meta.url), "utf8"));
  assert.ok(wb.offerte.uren.length > 0);
  for (const { fase } of wb.offerte.uren) assert.ok(Object.keys(TAAK_KOPPELING).includes(fase), fase);
  // de uren komen dan ook echt op de taken
  const taken = Object.keys(TAAK_KOPPELING).map((title, i) => ({ id: 920000 + i, projectID: 900001, title, status: 1, estimatedHours: null }));
  const p = planTaskUpdates(taken, wb, OPTIES);
  for (const { fase, uren } of wb.offerte.uren) assert.equal(wijziging(p, fase)?.estimatedHours, uren, fase);
  assert.deepEqual(p.wijzigingen.filter((w) => w.actie === "nvt"), [], "geen scope op false bij gekoppelde taken");
});
