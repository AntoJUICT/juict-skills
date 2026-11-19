import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vooraf, rapport, verplichtePunten, leesChecklist, vergelijkChecklist, achteraf, browserscript, hoofd } from "./controle.mjs";

const vers = () => JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
const taak = (d, titel) => d.taken.find((t) => t.titel === titel);

// --- Vooraf ---

test("vooraf: het voorbeelddossier heeft geen fouten en meldt de tegenstrijdigheid", () => {
  const u = vooraf(vers());
  assert.deepEqual(u.fouten, []);
  assert.equal(u.tegenstrijdig.length, 1);
  assert.match(u.tegenstrijdig[0].tekst, /25 mailboxen/);
});

test("verplichtePunten: scope, afspraken, besluiten, aanleveren, technische vragen en meerwerk", () => {
  const soorten = new Set(verplichtePunten(vers()).map((v) => v.soort));
  assert.deepEqual([...soorten].sort(), ["aanleveren", "afspraak", "besluit", "meerwerk", "scope", "technische vraag"]);
});

test("vooraf: zonder dekking is het een fout", () => {
  const d = vers();
  delete d.dekking;
  assert.ok(vooraf(d).fouten.some((f) => /^dekking: ontbreekt/.test(f)));
});

test("vooraf: een afspraak zonder taak of reden wordt gemeld", () => {
  const d = vers();
  d.dekking = d.dekking.filter((x) => !/laatste dinsdag/.test(x.tekst));
  assert.ok(vooraf(d).fouten.some((f) => /afspraak "Het gesprek over de planning/.test(f)));
});

test("vooraf: een offerteregel bij een taak die n.v.t. is, is een fout", () => {
  const d = vers();
  d.dekking.push({ bron: "Offerte 2026-11-02", tekst: "4 toestellen", taak: "Setup telefonie" });
  assert.ok(vooraf(d).fouten.some((f) => /"4 toestellen".*hoort bij "Setup telefonie", maar die taak staat op n\.v\.t\./.test(f)));
});

test("vooraf: onbekende taak, geen reden zonder taak, geen bron", () => {
  const d = vers();
  d.dekking.push({ bron: "Mail 2026-11-20", tekst: "Printer", taak: "Printers koppelen" });
  d.dekking.push({ bron: "Mail 2026-11-20", tekst: "Iets", taak: null });
  d.dekking.push({ tekst: "Zonder bron", taak: "Setup Intune" });
  const f = vooraf(d).fouten.join("\n");
  assert.match(f, /"Printers koppelen" is geen taak in het dossier/);
  assert.match(f, /geen taak; zet een taak of een reden/);
  assert.match(f, /\.bron: verplicht/);
});

test("vooraf: draaiboekpunt weggelaten blijft een fout (uit de dossiercontrole)", () => {
  const d = vers();
  const t = taak(d, "Setup Intune");
  t.punten = t.punten.filter((p) => p.tekst !== "Laptops koppelen aan Autopilot");
  assert.ok(vooraf(d).fouten.some((f) => /Laptops koppelen aan Autopilot" uit het draaiboek ontbreekt/.test(f)));
});

test("vooraf: waarschuwingen voor gedaan zonder bron en een taak met alleen n.v.t.-punten", () => {
  const d = vers();
  const t = taak(d, "Setup Intune");
  t.punten.forEach((p) => Object.assign(p, { status: "nvt", reden: "Geen werkplekken" }));
  const w = vooraf(d).waarschuwingen.join("\n");
  assert.match(w, /"Setup Intune": nodig, maar alle punten zijn n\.v\.t\./);
  assert.match(w, /staat op gedaan zonder bron/);
});

test("rapport: fouten eerst, dekkingstabel en per taak elk punt met status", () => {
  const d = vers();
  const md = rapport(d, vooraf(d));
  assert.match(md, /^# Controlerapport Voorbeeld Techniek \(project 9001\)/);
  assert.match(md, /Klaar om ter goedkeuring voor te leggen/);
  assert.match(md, /\| Kickoff-notitie 2026-11-10 \| Blijft de oude telefooncentrale.*\| geen: Besluit van de klant/);
  assert.match(md, /### Setup telefonie\nFase: Realisatie- en uitvoeringsfase\. n\.v\.t\.: /);
  assert.match(md, /- \[ \] Baseline uitrollen/);
  assert.doesNotMatch(md, /\(bron: Mail Sanne de Vries 2026-11-12\) \(bron:/);
});

// --- Achteraf ---

const PAGINA = [
  "Description", "Eigenaar: engineer", "Timeline", "Checklist", "(2/4)", "Hide Completed Items",
  "Microsoft registraties!",
  "CPOR registratie aanvragen18/11/2026 14:22 by Voorbeeld Engineer",
  "PAL registratie (n.v.t.: geen partner)18/11/2026 14:23 by Voorbeeld Engineer",
  "Azure accelerate fund aanvragen",
  "Prompt to automate checking / unchecking", "Activity", "Nog iets",
].join("\n");

test("leesChecklist: punten, vinkjes, Important-teken en teller", () => {
  const { punten, teller } = leesChecklist(PAGINA);
  assert.deepEqual(teller, { gedaan: 2, totaal: 4 });
  assert.deepEqual(punten, [
    { tekst: "Microsoft registraties", gedaan: false, ingesprongen: null },
    { tekst: "CPOR registratie aanvragen", gedaan: true, ingesprongen: null },
    { tekst: "PAL registratie (n.v.t.: geen partner)", gedaan: true, ingesprongen: null },
    { tekst: "Azure accelerate fund aanvragen", gedaan: false, ingesprongen: null },
  ]);
});

const STAND = { fases: [{ id: 1, title: "1. Start en overdracht" }], taken: [{ id: 10, title: "1.3 Microsoft-registraties aanvragen", phaseID: 1, description: "Eigenaar: engineer" }] };
const VERWACHT = [{ titel: "1.3 Microsoft-registraties aanvragen", fase: "1. Start en overdracht", omschrijving: "Eigenaar: engineer", checklist: [
  { tekst: "Microsoft registraties", gedaan: false }, { tekst: "CPOR registratie aanvragen", gedaan: true },
  { tekst: "PAL registratie (n.v.t.: geen partner)", gedaan: true }, { tekst: "Azure accelerate fund aanvragen", gedaan: false },
] }];

test("achteraf: alles klopt", () => {
  const u = achteraf(VERWACHT, STAND, { 10: PAGINA });
  assert.deepEqual(u.fouten, []);
  assert.deepEqual(u.waarschuwingen, []);
  assert.equal(u.perTaak[0].punten, 4);
});

test("achteraf: ontbrekend punt, verkeerd vinkje, onverwacht punt, fase en omschrijving", () => {
  const v = structuredClone(VERWACHT);
  v[0].checklist[3].gedaan = true;
  v[0].checklist.push({ tekst: "Extra: SEPA", gedaan: false });
  v[0].checklist.splice(0, 1);
  v[0].fase = "2. Kick-off en voorbereiding";
  v[0].omschrijving = "anders";
  const u = achteraf(v, STAND, { 10: PAGINA });
  const f = u.fouten.join("\n");
  assert.match(f, /checklistpunt ontbreekt: "Extra: SEPA"/);
  assert.match(f, /"Azure accelerate fund aanvragen" is niet afgevinkt, verwacht afgevinkt/);
  assert.match(f, /fase is "1\. Start en overdracht", verwacht "2\. Kick-off en voorbereiding"/);
  assert.match(f, /omschrijving wijkt af/);
  assert.match(u.waarschuwingen.join("\n"), /niet verwacht is: "Microsoft registraties"/);
});

test("achteraf: taak ontbreekt of checklist niet gelezen", () => {
  const u = achteraf([...VERWACHT, { titel: "9.9 Bestaat niet" }], STAND, {});
  assert.match(u.fouten.join("\n"), /checklist niet gelezen/);
  assert.match(u.fouten.join("\n"), /"9\.9 Bestaat niet": taak staat niet in Autotask/);
});

const HTML = [
  '<span>(1/3)</span><div class="Checklist Size1">',
  '<div class="ChecklistItem" id="a"><div class="ChecklistIcon CheckBox Empty"></div><div class="Description"><span class="Title">Voorconfiguratie firewall</span></div></div>',
  '<div class="ChecklistItem Completed Indented" id="b"><div class="ChecklistIcon CheckBox Checked"></div><div class="Description"><span class="Title">LAN netwerken aanmaken + DHCP</span><span class="CompletedBy">18/11/2026 14:22 by Voorbeeld Engineer</span></div></div>',
  '<div class="ChecklistItem Indented" id="c"><div class="ChecklistIcon CheckBox Empty"></div><div class="Description"><span class="Title">AP &amp; SW koppelen aan site</span></div></div>',
  "</div>",
  '<div class="ChecklistItem" id="d"><div class="Description"><span class="Title">Deel facturatie (&#x20AC; 4.000,-) &#x2B; Offici&#xEB;le co&#246;rdinator</span></div></div>',
].join("");

test("leesChecklist: uit de HTML van de taakpagina, met vinkje en inspringing", () => {
  assert.deepEqual(leesChecklist(HTML).punten, [
    { tekst: "Voorconfiguratie firewall", gedaan: false, ingesprongen: false },
    { tekst: "LAN netwerken aanmaken + DHCP", gedaan: true, ingesprongen: true },
    { tekst: "AP & SW koppelen aan site", gedaan: false, ingesprongen: true },
    { tekst: "Deel facturatie (€ 4.000,-) + Officiële coördinator", gedaan: false, ingesprongen: false },
  ]);
});

test("vergelijkChecklist: inspringing telt mee als de pagina HTML is", () => {
  const c = vergelijkChecklist("3.6", [
    { tekst: "Voorconfiguratie firewall", gedaan: false, ingesprongen: false },
    { tekst: "LAN netwerken aanmaken + DHCP", gedaan: true, ingesprongen: true },
    { tekst: "AP & SW koppelen aan site", gedaan: false, ingesprongen: false },
  ], HTML);
  assert.deepEqual(c.fouten, ['"3.6": "AP & SW koppelen aan site" is ingesprongen, verwacht niet ingesprongen']);
  assert.equal(c.punten, 4);
  assert.deepEqual(c.waarschuwingen, ['"3.6": punt in Autotask dat niet verwacht is: "Deel facturatie (€ 4.000,-) + Officiële coördinator"']);
});

test("browserscript: zelfstandig uitvoerbaar met fetch, vergelijkt en leest alleen", async () => {
  const script = browserscript([{ titel: "3.6", taskId: 7, checklist: [{ tekst: "Voorconfiguratie firewall", gedaan: true }] }, { titel: "zonder id", checklist: [] }]);
  assert.doesNotMatch(script, /method:\s*['"](POST|PATCH|PUT|DELETE)/i);
  const nep = async (url) => ({ ok: true, url, text: async () => HTML });
  const uit = await new Function("fetch", `return ${script};`)(nep);
  assert.equal(uit.taken, 1);
  assert.equal(uit.punten, 4);
  assert.deepEqual(uit.fouten, ['"3.6": "Voorconfiguratie firewall" is niet afgevinkt, verwacht afgevinkt']);
  assert.equal(uit.waarschuwingen.length, 3);
});

// --- CLI ---

test("hoofd: zonder opdracht het gebruik, vooraf schrijft het rapport", () => {
  assert.equal(hoofd([]).code, 1);
  const geschreven = {};
  const pad = new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const r = hoofd(["vooraf", "--dossier", pad, "--rapport", "r.md"], { schrijf: (p, t) => { geschreven[p] = t; } });
  assert.equal(r.code, 0);
  assert.match(r.uitvoer, /^Fouten: 0/);
  assert.match(geschreven["r.md"], /# Controlerapport/);
});

test("hoofd: achteraf leest de checklists uit de map", () => {
  const bestanden = { "v.json": JSON.stringify(VERWACHT), "s.json": JSON.stringify(STAND), [`map${process.platform === "win32" ? "\\" : "/"}10.txt`]: PAGINA };
  const r = hoofd(["achteraf", "--verwacht", "v.json", "--stand", "s.json", "--checklists", "map"], {
    lees: (p) => bestanden[p], bestaat: () => true, lijstMap: () => ["10.txt", "notitie.md"],
  });
  assert.equal(r.code, 0, r.uitvoer);
  assert.match(r.uitvoer, /checklistpunten gelezen: 4/);
});
