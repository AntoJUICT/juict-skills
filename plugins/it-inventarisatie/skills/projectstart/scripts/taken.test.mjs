import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vanDraaiboek, taakTekst, voorAutotask, takenVoorPlan, voegTakenToe, puntenPerRol, hoofd, MAX_OMSCHRIJVING, SUBTAKEN_NOTITIE } from "./taken.mjs";
import { draaiboek, draaiboekPunten, sjabloonTaak } from "./draaiboek.mjs";
import { valideerDossier } from "./dossier.mjs";

const vers = () => JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
const db = draaiboek();
const taak = (d, titel) => d.taken.find((t) => t.titel === titel);

// --- Zaaien ---

test("vanDraaiboek: alle 29 sjabloontaken met alle punten open, titel zoals in Autotask", () => {
  const taken = vanDraaiboek();
  assert.equal(taken.length, 29);
  assert.ok(taken.every((t) => t.sjabloon === true && t.status === "nodig" && t.uren === null));
  assert.ok(taken.some((t) => t.titel === "Licentie plan maken"), "autotaskTitel wordt de titel");
  const opstart = taak({ taken }, "Administratieve opstart project");
  assert.equal(opstart.fase, "Initiatie- en overdracht fase");
  assert.equal(opstart.punten.length, draaiboekPunten(sjabloonTaak("Administratieve opstart project")).length);
  assert.ok(opstart.punten.every((p) => p.status === "open"));
  assert.deepEqual(opstart.punten.find((p) => p.tekst === "CPOR registratie aanvragen (boven de 10 users)"), { tekst: "CPOR registratie aanvragen (boven de 10 users)", onder: "Microsoft registraties", status: "open" });
});

test("vanDraaiboek: wat er al staat blijft staan, ontbrekende taken en punten komen erbij", () => {
  const eigen = { titel: "Printers koppelen", sjabloon: false, fase: "Realisatie- en uitvoeringsfase", status: "nodig", bron: "Mail 2026-11-20", punten: [] };
  const intune = { titel: "setup intune", sjabloon: true, fase: "Realisatie- en uitvoeringsfase", status: "nvt", reden: "Geen werkplekken", punten: [{ tekst: "Baseline uitrollen", status: "gedaan" }, { tekst: "Iets extra", status: "extra", bron: "Offerte" }] };
  const taken = vanDraaiboek([intune, eigen]);
  assert.equal(taken.length, 30);
  assert.equal(taken.at(-1), eigen);
  const i = taak({ taken }, "setup intune");
  assert.equal(i.status, "nvt");
  assert.deepEqual(i.punten.map((p) => `${p.tekst}:${p.status}`), ["Baseline uitrollen:gedaan", "Iets extra:extra", "Applicaties toevoegen:open", "Laptops koppelen aan Autopilot:open"]);
});

test("vanDraaiboek: het gezaaide dossier is geldig", () => {
  const d = vers();
  d.taken = vanDraaiboek();
  assert.deepEqual(valideerDossier(d), []);
});

// --- Tekst ---

test("taakTekst: kop met stap en wacht op, punten per rol genummerd met kindpunten eronder", () => {
  const t = taakTekst(vanDraaiboek().find((x) => x.titel === "Administratieve opstart project"), { stap: 1, van: 28, wachtOp: "geen andere taak" });
  const regels = t.split("\n");
  assert.equal(regels[0], "Stap 1 van 28. Wacht op: geen andere taak");
  assert.ok(t.indexOf("\nEngineer\n") < t.indexOf("\nVerkoop/Administratie\n"));
  assert.match(t, /\nEngineer\n1\. \[ \] Microsoft registraties\n   1\.1 \[ \] CPOR registratie aanvragen \(boven de 10 users\)\n       Toelichting: Belangrijk!/);
  assert.match(t, /\nVerkoop\/Administratie\n1\. \[ \] Inrichten Autotask\n   1\.1 \[ \] Aanmaken Nacalculatie contract/);
  assert.doesNotMatch(t, /—/);
});

test("taakTekst: markeringen gedaan, open, n.v.t. met reden en extra met bron; kindpunt van een andere rol los met onder", () => {
  const t0 = vanDraaiboek().find((x) => x.titel === "Setup telefonie");
  t0.punten.find((p) => p.tekst === "Belplan uitvragen").status = "gedaan";
  Object.assign(t0.punten.find((p) => p.tekst === "WhatsApp-koppeling"), { status: "nvt", reden: "Niet in de offerte" });
  t0.punten.push({ tekst: "controleren: offerte noemt 10 toestellen, mail noemt 12", status: "extra", bron: "Mail 2026-11-20" });
  t0.uren = 4;
  const t = taakTekst(t0, { stap: 17, van: 28, wachtOp: "alle taken van Voorbereidings- en planningsfase" });
  assert.match(t, /^Stap 17 van 28\. Wacht op: alle taken van Voorbereidings- en planningsfase\n/);
  assert.match(t, /Uren volgens de offerte: 4 uur\./);
  assert.match(t, /\d\. \[x\] Belplan uitvragen/);
  assert.match(t, /\d\.\d+ WhatsApp-koppeling, n\.v\.t\.: Niet in de offerte/);
  assert.match(t, /\d\. \+ controleren: offerte noemt 10 toestellen, mail noemt 12 \(bron: Mail 2026-11-20\)/);
  // "Voorbereiding" is Verkoop/Administratie, het kindpunt "Klant aanmaken via het Speakup-portaal" is Engineer.
  assert.match(t, /\nEngineer\n[\s\S]*\d\. \[ \] Klant aanmaken via het Speakup-portaal \(onder: Voorbereiding\)/);
});

test("taakTekst: taak buiten het sjabloon noemt de bron; punten zonder rol bij de engineer", () => {
  const t = taakTekst({ titel: "Printers koppelen", sjabloon: false, fase: "Realisatie- en uitvoeringsfase", status: "nodig", bron: "Mail 2026-11-20", punten: [{ tekst: "Twee printers koppelen", status: "extra", bron: "Mail 2026-11-20" }] }, { stap: 18, van: 30, wachtOp: "Setup Microsoft 365" });
  assert.match(t, /buiten het sjabloon \(bron: Mail 2026-11-20\)/);
  assert.match(t, /\nEngineer\n1\. \+ Twee printers koppelen \(bron: Mail 2026-11-20\)/);
});

test("voorAutotask: tot 8000 tekens ongewijzigd; langer wordt ingekort met verwijzing naar de notitie", () => {
  assert.equal(MAX_OMSCHRIJVING, 8000);
  assert.deepEqual(voorAutotask("kort"), { omschrijving: "kort", notitie: null });
  const lang = Array.from({ length: 400 }, (_, i) => `${i + 1}. [ ] Punt nummer ${i + 1} met wat tekst`).join("\n");
  const r = voorAutotask(lang);
  assert.ok(lang.length > 8000);
  assert.ok(r.omschrijving.length <= 8000, String(r.omschrijving.length));
  assert.match(r.omschrijving, new RegExp(`\\n\\.\\.\\. zie notitie ${SUBTAKEN_NOTITIE} voor de volledige lijst\\.$`));
  assert.equal(r.notitie, lang);
  assert.ok(lang.startsWith(r.omschrijving.split("\n...")[0]), "afgekapt op een hele regel");
});

test("puntenPerRol: telt open en extra als open, per rol uit het draaiboek", () => {
  const d = vers();
  const r = puntenPerRol(taak(d, "Huidige documentatie ontvangen"));
  assert.deepEqual(r.Engineer, { totaal: 8, open: 7 });
  assert.deepEqual(r.Projectmanager, { totaal: 2, open: 2 });
  assert.deepEqual(r["Verkoop/Administratie"], { totaal: 1, open: 1 });
});

// --- Plan ---

test("takenVoorPlan: alle taken in logische volgorde met stap, tellingen en tekst", () => {
  const p = takenVoorPlan(vers());
  assert.equal(p.length, 30);
  const m365 = p.find((t) => t.titel === "Setup Microsoft 365");
  assert.equal(m365.stap, 10);
  assert.equal(m365.uren, 16);
  assert.equal(m365.punten, 8);
  assert.equal(m365.open, 7);
  assert.match(m365.omschrijving, /^Stap 10 van 28\. Wacht op: alle taken van Voorbereidings- en planningsfase\n/);
  const tel = p.find((t) => t.titel === "Setup telefonie");
  assert.equal(tel.stap, null);
  assert.equal(tel.status, "nvt");
  assert.match(tel.reden, /buiten de offerte/);
  const proef = p.find((t) => t.titel === "Proefmigratie met twee gebruikers uitvoeren");
  assert.equal(proef.sjabloon, false);
  assert.equal(proef.bron, "Mail Sanne de Vries 2026-11-12");
  assert.match(proef.omschrijving, /^Stap 17 van 28\. Wacht op: Setup Microsoft 365\n/);
  // Telefonie oplevering wacht op Setup netwerk en Setup telefonie; telefonie is n.v.t., dus wat telefonie zelf nodig had.
  const ict = p.find((t) => t.titel === "ICT oplevering op locatie");
  assert.doesNotMatch(ict.omschrijving.split("\n")[0], /Setup telefonie/);
  const stappen = p.filter((t) => t.stap).map((t) => t.stap);
  assert.deepEqual(stappen, Array.from({ length: 28 }, (_, i) => i + 1));
});

test("takenVoorPlan: ongeldig dossier geeft een fout", () => {
  const d = vers();
  taak(d, "Setup Intune").punten.pop();
  assert.throws(() => takenVoorPlan(d), /Laptops koppelen aan Autopilot.*ontbreekt/);
});

test("voegTakenToe vervangt de taken en laat notities en bijlagen staan", () => {
  const plan = { notities: [{ titel: "n", tekst: "t" }], bijlagen: [{ titel: "b", url: "https://x" }], taken: [{ titel: "oud" }] };
  const uit = voegTakenToe(plan, [{ titel: "nieuw" }]);
  assert.deepEqual(uit, { notities: plan.notities, bijlagen: plan.bijlagen, taken: [{ titel: "nieuw" }] });
});

// --- CLI ---

function nepBestanden(start) {
  const bestanden = { ...start };
  return { bestanden, deps: { lees: (p) => bestanden[p], bestaat: (p) => p in bestanden, schrijf: (p, t) => { bestanden[p] = t; } } };
}

test("hoofd zaai: leeg dossier krijgt de structuur; tweede keer verandert er niets", () => {
  const d = vers();
  delete d.taken;
  const { bestanden, deps } = nepBestanden({ "d.json": JSON.stringify(d) });
  const r = hoofd(["zaai", "--dossier", "d.json"], deps);
  assert.equal(r.code, 0, r.uitvoer);
  assert.match(r.uitvoer, /29 sjabloontaken en \d+ punten uit het draaiboek/);
  const na = JSON.parse(bestanden["d.json"]);
  assert.equal(na.taken.length, 29);
  assert.deepEqual(valideerDossier(na), []);
  const voor = bestanden["d.json"];
  const r2 = hoofd(["zaai", "--dossier", "d.json"], deps);
  assert.match(r2.uitvoer, /niets gewijzigd/);
  assert.equal(bestanden["d.json"], voor);
});

test("hoofd plan: zet de taken in het plan, in volgorde in de uitvoer; toon zonder plan", () => {
  const { bestanden, deps } = nepBestanden({ "d.json": JSON.stringify(vers()), "plan.json": JSON.stringify({ notities: [{ titel: "Projectstart: briefing kick-off", tekst: "x" }], bijlagen: [] }) });
  const r = hoofd(["plan", "--dossier", "d.json", "--plan", "plan.json"], deps);
  assert.equal(r.code, 0, r.uitvoer);
  const plan = JSON.parse(bestanden["plan.json"]);
  assert.equal(plan.taken.length, 30);
  assert.equal(plan.notities.length, 1);
  assert.match(r.uitvoer, /\n10\. Setup Microsoft 365 \(Realisatie- en uitvoeringsfase, 8 punten, 7 open\)/);
  assert.match(r.uitvoer, /\n-  Setup telefonie \(Realisatie- en uitvoeringsfase, n\.v\.t\.: Telefonie valt buiten de offerte/);
  const toon = hoofd(["toon", "--dossier", "d.json"], deps);
  assert.equal(toon.code, 0);
  assert.match(toon.uitvoer, /Stap 1 van 28\. Wacht op: geen andere taak/);
});

test("hoofd: zonder --dossier gebruik en code 1, ongeldig dossier code 1", () => {
  assert.equal(hoofd([], {}).code, 1);
  const d = vers();
  d.taken.push({ ...d.taken[0] });
  const r = hoofd(["plan", "--dossier", "d.json", "--plan", "p.json"], { lees: () => JSON.stringify(d), bestaat: () => false, schrijf: () => {} });
  assert.equal(r.code, 1);
  assert.match(r.uitvoer, /dubbel/);
});

test("draaiboek in het dossier: de engineerpunten in administratie- en PM-taken staan erin", () => {
  const d = vers();
  const punten = (titel) => taak(d, titel).punten.map((p) => p.tekst);
  for (const p of ["CPOR registratie aanvragen (boven de 10 users)", "PAL registratie (moet via engineer)", "Azure accelerate fund aanvragen"]) assert.ok(punten("Administratieve opstart project").includes(p), p);
  assert.ok(punten("Project opstart").includes("Technische inventarisatie plannen"));
  assert.ok(punten("Administratieve oplevering").includes("CPOR aanvraag indienen"));
  assert.ok(sjabloonTaak("Licentieplan maken", db));
});
