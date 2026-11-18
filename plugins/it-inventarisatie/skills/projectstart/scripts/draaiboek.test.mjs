import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draaiboek, draaiboekPunten, sjabloonTaak, volgorde, wachtOpWbs, faseVolgorde } from "./draaiboek.mjs";
import { SJABLOON_FASES, SJABLOON_TITELS, draaiboekUitRijen, leesRijen, gedeeldeTeksten, schoon } from "./draaiboek-naar-json.mjs";

const db = draaiboek();
const ruw = readFileSync(new URL("../assets/easywork-draaiboek.json", import.meta.url), "utf8");

// --- Het draaiboek als data ---

test("draaiboek: 29 taken, de 7 fases van het sjabloon in volgorde, titels zoals in Autotask", () => {
  assert.equal(db.taken.length, 29);
  assert.deepEqual(faseVolgorde(db), SJABLOON_FASES);
  assert.deepEqual(SJABLOON_FASES, ["Initiatie- en overdracht fase", "Projectmanagement", "Voorbereidings- en planningsfase", "Realisatie- en uitvoeringsfase", "Opleveringsfase", "After sales en administratiefase", "NACALC (Werkzaamheden buiten scope)"]);
  assert.deepEqual(db.taken.map((t) => t.autotaskTitel ?? t.titel), SJABLOON_TITELS);
  const lic = db.taken.find((t) => t.titel === "Licentieplan maken");
  assert.equal(lic.autotaskTitel, "Licentie plan maken");
  assert.equal(db.taken.filter((t) => t.autotaskTitel).length, 1);
  assert.match(db.datum, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(db.bron, /Easywork_Draaiboek\.xlsx/);
});

test("draaiboek: vorm per taak en punt, zonder Verbeteradvies", () => {
  assert.doesNotMatch(ruw, /verbeteradvies/i);
  for (const t of db.taken) {
    assert.deepEqual(Object.keys(t).filter((k) => k !== "autotaskTitel"), ["wbs", "fase", "titel", "rol", "wachtOp", "toelichting", "punten"], t.titel);
    assert.match(t.wbs, /^\d\.\d+$/);
    for (const p of t.punten) {
      assert.deepEqual(Object.keys(p), ["tekst", "rol", "toelichting", "kinderen"]);
      for (const k of p.kinderen) assert.deepEqual(Object.keys(k), ["tekst", "rol", "toelichting"]);
    }
  }
});

test("draaiboek: schrijfregels (geen em-dash, geen M365, geen opsommingstekens)", () => {
  assert.doesNotMatch(ruw, /—|\bM365\b|\bBC\b|"\s*[•–]/);
  assert.match(ruw, /Controle Microsoft 365 licenties \(NCE\)/);
});

test("draaiboek: de engineerpunten in administratie- en PM-taken staan erin", () => {
  const rolVan = (titel, tekst) => draaiboekPunten(sjabloonTaak(titel)).find((p) => p.tekst === tekst)?.rol;
  assert.equal(rolVan("Administratieve opstart project", "CPOR registratie aanvragen (boven de 10 users)"), "Engineer");
  assert.equal(rolVan("Administratieve opstart project", "PAL registratie (moet via engineer)"), "Engineer");
  assert.equal(rolVan("Administratieve opstart project", "Azure accelerate fund aanvragen"), "Engineer");
  assert.equal(rolVan("Project opstart", "Technische inventarisatie plannen"), "Engineer");
  assert.equal(rolVan("Huidige documentatie ontvangen", "GDAP relatie opzetten"), "Engineer");
  assert.equal(rolVan("Administratieve oplevering", "CPOR aanvraag indienen"), "Engineer");
  assert.equal(sjabloonTaak("Huidige documentatie ontvangen").rol, "Projectmanager");
});

test("sjabloonTaak: herkent beide schrijfwijzen, hoofdletters en spaties genegeerd", () => {
  assert.equal(sjabloonTaak("licentie  plan maken"), sjabloonTaak("Licentieplan maken"));
  assert.equal(sjabloonTaak("Printers koppelen"), null);
});

// --- Conversie (draaiboek-naar-json.mjs) ---

const KOP = ["WBS", "Niveau", "Omschrijving", "Rol", "Wacht op (afhankelijkheid)", "Toelichting", "Verbeteradvies"];
function rijenVoorAlles() {
  const rijen = [["Easywork Draaiboek — JUICT projectsjabloon"], KOP];
  SJABLOON_FASES.forEach((fase, i) => {
    rijen.push([`FASE ${i + 1} — ${fase.toUpperCase()}  (1 taken)`]);
    for (const titel of SJABLOON_TITELS.filter((_, j) => j % 7 === i)) rijen.push([`${i + 1}.1`, "Taak", titel === "Licentie plan maken" ? "Licentieplan maken" : titel, "Engineer", "—", "", "intern advies"]);
  });
  rijen.splice(4, 0, ["", "Sub-punt", "•  Controle M365 licenties", "Engineer", "", "Let op", "niet meenemen"], ["", "Kindpunt", "–  Kind", "Projectmanager", "", "", ""]);
  return rijen;
}

test("draaiboekUitRijen: fases uit samengevoegde rijen, tekens weg, streepje is leeg, Verbeteradvies niet mee", () => {
  const d = draaiboekUitRijen(rijenVoorAlles(), { datum: "2026-09-17" });
  assert.equal(d.taken.length, 29);
  assert.equal(d.datum, "2026-09-17");
  const eerste = d.taken[0];
  assert.equal(eerste.fase, "Initiatie- en overdracht fase");
  assert.equal(eerste.wachtOp, null);
  assert.deepEqual(eerste.punten, [{ tekst: "Controle Microsoft 365 licenties", rol: "Engineer", toelichting: "Let op", kinderen: [{ tekst: "Kind", rol: "Projectmanager", toelichting: null }] }]);
  assert.doesNotMatch(JSON.stringify(d), /advies|meenemen/);
  assert.equal(d.taken.find((t) => t.titel === "Licentieplan maken").autotaskTitel, "Licentie plan maken");
});

test("draaiboekUitRijen: onbekende taak of fase, of een ontbrekende sjabloontaak, stopt de conversie", () => {
  const vreemd = rijenVoorAlles();
  vreemd.push(["7.9", "Taak", "Iets nieuws", "Engineer", "", ""]);
  assert.throws(() => draaiboekUitRijen(vreemd), /Iets nieuws.*niet in het sjabloon/);
  const fase = rijenVoorAlles();
  fase[2] = ["FASE 1 — ONBEKEND (1 taken)"];
  assert.throws(() => draaiboekUitRijen(fase), /ONBEKEND/);
  const mist = rijenVoorAlles().filter((r) => r[2] !== "After sales");
  assert.throws(() => draaiboekUitRijen(mist), /niet in het draaiboek: After sales/);
});

test("leesRijen en gedeeldeTeksten: cellen op kolomletter, gedeelde en inline tekst, entiteiten", () => {
  const gedeeld = gedeeldeTeksten('<sst><si><t>WBS</t></si><si><r><t>A &amp; </t></r><r><t xml:space="preserve">B</t></r></si></sst>');
  assert.deepEqual(gedeeld, ["WBS", "A & B"]);
  const rijen = leesRijen('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>x</t></is></c><c r="AA2"><v>5</v></c></row></sheetData>', gedeeld);
  assert.deepEqual(rijen[0], ["WBS", "", "A & B"]);
  assert.equal(rijen[1][1], "x");
  assert.equal(rijen[1][26], "5");
});

test("schoon: em-dash en afkortingen weg", () => {
  assert.equal(schoon("Controle M365 — en BC"), "Controle Microsoft 365, en Business Central");
});

// --- Volgorde ---

const alle = () => db.taken.map((t) => ({ titel: t.autotaskTitel ?? t.titel, sjabloon: true, fase: t.fase, status: "nodig", punten: [] }));
const plek = (v, titel) => v.taken.findIndex((x) => x.taak.titel === titel);

test("wachtOpWbs: taaknummers en hele fases", () => {
  assert.deepEqual(wachtOpWbs(sjabloonTaak("Project opstart")).wbs, ["2.1"]);
  assert.deepEqual(wachtOpWbs(sjabloonTaak("Setup Microsoft 365")).wbs, ["3.1", "3.2", "3.3", "3.4"]);
  assert.deepEqual(wachtOpWbs({ titel: "x", wbs: "9.9", wachtOp: "8.8 Bestaat niet" }).fouten.length, 1);
});

test("volgorde: elke taak na waar hij op wacht, over de fases heen, stappen 1 tot en met m", () => {
  const v = volgorde(alle(), db);
  assert.deepEqual(v.fouten, []);
  assert.equal(v.taken.length, 29);
  for (const { taak, wachtOp } of v.taken) for (const w of wachtOp) assert.ok(plek(v, w) < plek(v, taak.titel), `${w} voor ${taak.titel}`);
  assert.ok(plek(v, "Project opstart") > plek(v, "Projectafstemming met verkoop"));
  // Project afsluitingsgesprek staat in fase 2, maar wacht op de hele opleveringsfase.
  assert.ok(plek(v, "Project afsluitingsgesprek") > plek(v, "IT Glue updaten"));
  assert.deepEqual(v.taken.map((x) => x.stap), Array.from({ length: 29 }, (_, i) => i + 1));
  assert.ok(v.taken.every((x) => x.van === 29));
});

test("volgorde: taak die niet nodig is krijgt geen stap; wie erop wacht, wacht op zijn voorgangers", () => {
  const taken = alle();
  Object.assign(taken.find((t) => t.titel === "Setup telefonie"), { status: "nvt", reden: "Buiten de offerte" });
  const v = volgorde(taken, db);
  const tel = v.taken.find((x) => x.taak.titel === "Setup telefonie");
  assert.equal(tel.stap, null);
  assert.equal(v.taken[0].van, 28);
  const opl = v.taken.find((x) => x.taak.titel === "Telefonie oplevering op locatie");
  assert.ok(!opl.wachtOp.includes("Setup telefonie"));
  assert.ok(opl.wachtOp.includes("Setup netwerk"));
  assert.ok(opl.wachtOp.includes("Licentie plan maken"), opl.wachtOp.join("; "));
});

test("volgorde: eigen taak standaard aan het eind van zijn fase, of na de taken in wachtOp", () => {
  const taken = alle();
  taken.push({ titel: "Printers koppelen", sjabloon: false, fase: "Voorbereidings- en planningsfase", status: "nodig", bron: "Mail", punten: [] });
  taken.push({ titel: "Proefmigratie", sjabloon: false, fase: "Realisatie- en uitvoeringsfase", status: "nodig", bron: "Mail", wachtOp: ["Setup Microsoft 365"], punten: [] });
  const v = volgorde(taken, db);
  assert.deepEqual(v.fouten, []);
  const printers = v.taken.find((x) => x.taak.titel === "Printers koppelen");
  for (const t of ["Maken Plan van Aanpak", "Aanschaf benodigde hardware en/of software", "Huidige documentatie ontvangen", "Licentie plan maken"]) assert.ok(printers.wachtOp.includes(t), t);
  assert.ok(plek(v, "Printers koppelen") < plek(v, "Setup Microsoft 365"));
  assert.deepEqual(v.taken.find((x) => x.taak.titel === "Proefmigratie").wachtOp, ["Setup Microsoft 365"]);
  // Bij gelijke stand komt een eigen taak achter de sjabloontaken van zijn fase.
  assert.equal(plek(v, "Proefmigratie"), plek(v, "Setup telefonie") + 1);
  assert.ok(plek(v, "Proefmigratie") < plek(v, "Distribueren welkomsbrief"));
});

test("volgorde: onbekende verwijzing en een rondje zijn fouten", () => {
  const taken = alle();
  taken.push({ titel: "A", sjabloon: false, fase: "Opleveringsfase", status: "nodig", bron: "Mail", wachtOp: ["Bestaat niet"], punten: [] });
  assert.match(volgorde(taken, db).fouten.join("\n"), /taken\[29\]\.wachtOp: "Bestaat niet" is geen taak in het dossier/);
  const rond = alle();
  rond.push({ titel: "A", sjabloon: false, fase: "Opleveringsfase", status: "nodig", bron: "Mail", wachtOp: ["B"], punten: [] });
  rond.push({ titel: "B", sjabloon: false, fase: "Opleveringsfase", status: "nodig", bron: "Mail", wachtOp: ["A"], punten: [] });
  const v = volgorde(rond, db);
  assert.match(v.fouten.join("\n"), /loopt rond.*A; B/);
  assert.equal(v.taken.length, 31, "bij een rondje komen alle taken toch in de lijst");
});
