import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { veiligeBestandsnaam, haalBronnen, hoofd } from "./bronnen.mjs";
import { maakAt } from "../../it-inventarisatie/scripts/autotask-project.mjs";

const fx = () => JSON.parse(readFileSync(new URL("./fixtures/attachments.voorbeeld.json", import.meta.url), "utf8"));
const CREDS = { username: "u", secret: "s", integrationCode: "i", zone: "19" };

function nepAt(f = fx()) {
  return {
    async get(pad) {
      if (pad === "Projects/9001") return f.project;
      if (pad === "Companies/8001") return f.bedrijf;
      if (pad === "Projects/9001/Attachments") return f.lijst;
      throw new Error("onverwacht pad " + pad);
    },
    async getProjectAttachment(projectId, id) { return f.bijlagen[id]; },
    async queryProjectNotes() { return f.notities; },
  };
}

const tijdelijk = () => mkdtempSync(join(tmpdir(), "bronnen-"));

test("veiligeBestandsnaam behoudt en-dash en accenten", () => {
  assert.equal(veiligeBestandsnaam("Re_ Voorbeeld _ Planning – volgende stappen.eml"), "Re_ Voorbeeld _ Planning – volgende stappen.eml");
  assert.equal(veiligeBestandsnaam("a/b:c*?.pdf"), "a_b_c__.pdf");
  assert.equal(veiligeBestandsnaam('x"<>|\\y é.pdf'), "x_____y é.pdf");
});

test("haalBronnen schrijft bijlagen en manifest met een nep-at", async () => {
  const map = tijdelijk();
  try {
    const m = await haalBronnen(nepAt(), 9001, map);
    assert.equal(m.projectId, 9001);
    assert.equal(m.companyId, 8001);
    assert.equal(m.bedrijfsnaam, "Voorbeeld Techniek B.V.");
    assert.equal(m.projectNaam, "Voorbeeld Techniek B.V. - Easywork Basic");
    assert.equal(m.bijlagen.length, 2);
    assert.deepEqual(m.bijlagen[0], {
      id: 70001, titel: "Offerte Voorbeeld – versie 2.pdf", bestand: "bronnen/70001-Offerte Voorbeeld – versie 2.pdf",
      type: "application/pdf", datum: "2026-10-01T08:15:00.000Z",
    });
    for (const b of m.bijlagen) assert.ok(existsSync(join(map, b.bestand)), b.bestand);
    assert.equal(readFileSync(join(map, m.bijlagen[0].bestand)).toString("latin1"), "%PDF-1.4\n%Voorbeeld\n");
    assert.deepEqual(m.notities, [{ id: 60001, titel: "Kickoff voorbeeld", tekst: "Voorbeeldnotitie: kickoff gepland.", datum: "2026-10-03T10:00:00.000Z" }]);
    assert.deepEqual(JSON.parse(readFileSync(join(map, "bronnen.json"), "utf8")), m);
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test("bijlage zonder extensie in de titel krijgt die van fullPath", async () => {
  const f = fx();
  f.lijst.items[0].title = "Offerte zonder punt";
  const map = tijdelijk();
  try {
    const m = await haalBronnen(nepAt(f), 9001, map);
    assert.equal(m.bijlagen[0].bestand, "bronnen/70001-Offerte zonder punt.pdf");
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test("bronnen.json bevat geen geheime sleutels of credentials", async () => {
  const f = fx();
  f.notities[0].secret = "GEHEIM-CANARY";
  const map = tijdelijk();
  try {
    await haalBronnen(nepAt(f), 9001, map);
    const tekst = readFileSync(join(map, "bronnen.json"), "utf8");
    assert.ok(!tekst.includes("GEHEIM-CANARY"));
    assert.ok(!/UserName|ApiIntegrationCode/i.test(tekst));
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test("bijlagen worden met maximaal 2 tegelijk gedownload (maakAt-semafoor)", async () => {
  const f = fx();
  const lijst = { items: Array.from({ length: 5 }, (_, i) => ({ ...f.lijst.items[0], id: 100 + i, title: `b${i}.pdf` })) };
  let bezig = 0, max = 0;
  const fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/Projects/9001")) return { ok: true, json: async () => f.project };
    if (u.endsWith("/Companies/8001")) return { ok: true, json: async () => f.bedrijf };
    if (u.endsWith("/Projects/9001/Attachments")) return { ok: true, json: async () => lijst };
    if (u.endsWith("/ProjectNotes/query")) return { ok: true, json: async () => ({ items: [], pageDetails: { nextPageUrl: null } }) };
    const m = u.match(/Attachments\/(\d+)$/);
    assert.ok(m, u);
    bezig++; max = Math.max(max, bezig);
    await new Promise((r) => setTimeout(r, 10));
    bezig--;
    return { ok: true, json: async () => ({ items: [{ ...f.bijlagen["70001"].items[0], id: Number(m[1]) }] }) };
  };
  const map = tijdelijk();
  try {
    const man = await haalBronnen(maakAt({ fetch, creds: CREDS }), 9001, map);
    assert.equal(man.bijlagen.length, 5);
    assert.ok(max === 2, `max gelijktijdig ${max}`);
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test("maakAt: getProjectAttachment en queryProjectNotes gebruiken de juiste endpoints", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body });
    return { ok: true, json: async () => ({ items: [{ id: 1 }], pageDetails: { nextPageUrl: null } }) };
  };
  const at = maakAt({ fetch, creds: CREDS });
  await at.getProjectAttachment(9001, 5);
  const n = await at.queryProjectNotes(9001);
  assert.equal(n.length, 1);
  assert.match(calls[0].url, /Projects\/9001\/Attachments\/5$/);
  assert.equal(calls[0].method, "GET");
  assert.match(calls[1].url, /ProjectNotes\/query$/);
  assert.deepEqual(JSON.parse(calls[1].body), { filter: [{ field: "projectID", op: "eq", value: 9001 }] });
});

test("hoofd: zonder --project geeft gebruik; met --project print manifest zonder inhoud", async () => {
  assert.equal((await hoofd([], {})).code, 1);
  const map = tijdelijk();
  try {
    const r = await hoofd(["--project", "9001", "--uit", map], { at: nepAt() });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.uitvoer).bijlagen.length, 2);
    assert.ok(!r.uitvoer.includes("Voorbeeldnotitie"), "notitietekst hoort niet in de CLI-uitvoer");
    assert.ok(existsSync(join(map, "bronnen.json")));
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test("link-bijlage en lege bijlage worden overgeslagen en in het manifest genoemd", async () => {
  const f = fx();
  f.lijst.items.push(
    { ...f.lijst.items[0], id: 70010, attachmentType: "URL", title: "Link naar de offertemap", fullPath: "https://example.com/map" },
    { ...f.lijst.items[0], id: 70011, title: "Leeg.pdf" },
  );
  f.bijlagen["70010"] = { items: [] };
  f.bijlagen["70011"] = { items: [{ id: 70011, title: "Leeg.pdf", data: null }] };
  const gevraagd = [];
  const at = nepAt(f);
  const orig = at.getProjectAttachment;
  at.getProjectAttachment = async (p, id) => { gevraagd.push(id); return orig(p, id); };
  const map = tijdelijk();
  try {
    const m = await haalBronnen(at, 9001, map);
    assert.deepEqual(m.bijlagen.map((b) => b.id), [70001, 70002]);
    assert.deepEqual(m.overgeslagen, [
      { id: 70010, titel: "Link naar de offertemap", reden: "geen bestandsbijlage" },
      { id: 70011, titel: "Leeg.pdf", reden: "geen inhoud" },
    ]);
    assert.ok(!gevraagd.includes(70010), "een link wordt niet gedownload");
  } finally { rmSync(map, { recursive: true, force: true }); }
});
