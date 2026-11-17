import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefing, wijzigingen, uitvraagMail } from "./teksten.mjs";

const vers = () => JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
const LINKS = { presentatie: "https://claude.ai/artifact/pres", rapport: "https://claude.ai/artifact/rap" };

test("briefing heeft beide kopjes, links en de deel-actie", () => {
  const b = briefing(vers(), LINKS);
  assert.equal(b.titel, "Projectstart: briefing kick-off");
  assert.match(b.tekst, /Voor de projectleider/);
  assert.match(b.tekst, /Voor de techniek/);
  assert.ok(b.tekst.includes(LINKS.presentatie) && b.tekst.includes(LINKS.rapport));
  assert.match(b.tekst, /Presentatie en rapport delen met JUICT \(bewerken\)/);
  assert.match(b.tekst, /Welke versie draait de planningssoftware/);
  assert.ok(!b.tekst.includes("—"));
});

test("briefing noemt interne afspraken met bedrag, de mail niet", () => {
  assert.match(briefing(vers(), LINKS).tekst, /€ 100/);
  assert.ok(!uitvraagMail(vers(), { rapport: LINKS.rapport }).tekst.includes("100 per uur"));
});

test("uitvraag-mail bevat geen € en geen wachtwoordvraag, wel slotzin", () => {
  const m = uitvraagMail(vers(), { rapport: LINKS.rapport });
  const alles = `${m.onderwerp}\n${m.tekst}`;
  assert.ok(!/€|EUR|—|\bBC\b|\bM365\b/.test(alles));
  assert.match(m.tekst, /Wachtwoorden hoef je niet te sturen/);
  assert.ok(!/stuur.*wachtwoord/i.test(m.tekst.replace(/Wachtwoorden hoef je niet te sturen[^\n]*/, "")));
});

test("uitvraag-mail: ontvanger, cc, volgorde van onderdelen", () => {
  const m = uitvraagMail(vers(), { rapport: LINKS.rapport });
  assert.equal(m.aan, "joost.bakker@voorbeeldtechniek.example");
  assert.deepEqual(m.cc, ["sanne.devries@voorbeeldtechniek.example"]);
  assert.match(m.tekst, /^Hoi Joost,/);
  const pos = ["Bedankt", "**Besluiten", "**Wat we van jullie nodig hebben", "**Technische vragen", "levend document", "Wachtwoorden hoef"]
    .map((s) => m.tekst.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), pos.join());
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b));
  assert.ok(m.tekst.includes(LINKS.rapport));
  assert.match(m.tekst, /Lijst met alle gebruikers en hun functie.*Joost Bakker.*01-12-2026/);
  assert.match(m.tekst, /Overzicht van gedeelde mailboxen.*nog open/);
  assert.match(m.tekst, /Welke versie draait de planningssoftware/);
});

test("uitvraag-mail: besloten als afspraak, open als nog open; rapport volgt zonder link", () => {
  const d = vers();
  d.besluiten[0].besluit = "Alle medewerkers krijgen toegang.";
  const m = uitvraagMail(d, {});
  assert.match(m.tekst, /Afgesproken: Alle medewerkers krijgen toegang\./);
  assert.match(m.tekst, /Nog open: Blijft de oude telefooncentrale/);
  assert.match(m.tekst, /rapport volgt/i);
});

test("wijzigingen zonder verschil geeft null", () => {
  assert.equal(wijzigingen(vers(), vers()), null);
  const nieuw = vers();
  nieuw.versie = 2;
  nieuw.artifacts.rapport = "https://x";
  assert.equal(wijzigingen(vers(), nieuw), null);
});

test("wijzigingen noemt alleen wat veranderd is", () => {
  const nieuw = vers();
  nieuw.aanleveren.push({ wat: "Plattegrond van het kantoor", wie: "Joost Bakker", datum: "2026-12-05", tijd: null });
  nieuw.technischeVragen = [];
  nieuw.overleg.ritme = "Wekelijks een kwartier";
  const w = wijzigingen(vers(), nieuw, { datum: new Date(2026, 10, 12, 10, 15) });
  assert.equal(w.titel, "Projectstart: aanvulling 12-11-2026 10:15");
  assert.match(w.tekst, /Plattegrond van het kantoor/);
  assert.match(w.tekst, /Welke versie draait de planningssoftware/);
  assert.match(w.tekst, /Wekelijks een kwartier/);
  assert.ok(!w.tekst.includes("Lijst met alle gebruikers"));
});

test("uitvraag-mail zonder mailadressen valt terug op namen", () => {
  const d = vers();
  for (const c of d.contacten) delete c.mail;
  const m = uitvraagMail(d, {});
  assert.equal(m.aan, "Joost Bakker");
  assert.deepEqual(m.cc, ["Sanne de Vries"]);
});

test("uitvraag-mail gooit bij een bedrag in het dossier", () => {
  const d = vers();
  d.besluiten[1].alsNiet = "Dan rekenen we € 50 extra.";
  assert.throws(() => uitvraagMail(d, {}), /bedrag/);
});

test("hoofd: briefing, mail en wijzigingen tonen; met --plan komt de notitie in het plan", async () => {
  const { hoofd, MAIL_NOTITIE } = await import("./teksten.mjs");
  const bestanden = { "d.json": JSON.stringify(vers()), "plan.json": JSON.stringify({ notities: [{ titel: "Projectstart: briefing kick-off", tekst: "oud" }], bijlagen: [{ titel: "Mini PVA", bestandsnaam: "Mini PVA Voorbeeld Techniek v1.docx", pad: "x.docx" }] }) };
  const deps = { lees: (p) => bestanden[p], bestaat: (p) => p in bestanden, schrijf: (p, t) => { bestanden[p] = t; } };

  const b = hoofd(["briefing", "--dossier", "d.json", "--presentatie", LINKS.presentatie, "--rapport", LINKS.rapport, "--plan", "plan.json"], deps);
  assert.equal(b.code, 0);
  assert.match(b.uitvoer, /Voor de projectleider/);
  let plan = JSON.parse(bestanden["plan.json"]);
  assert.equal(plan.notities.length, 1, "zelfde titel wordt vervangen, niet verdubbeld");
  assert.match(plan.notities[0].tekst, /Voor de techniek/);
  assert.equal(plan.bijlagen.length, 3, "bestaande bijlage blijft staan, plus link-bijlagen voor presentatie en rapport");
  assert.equal(plan.bijlagen[0].bestandsnaam, "Mini PVA Voorbeeld Techniek v1.docx");

  const m = hoofd(["mail", "--dossier", "d.json", "--rapport", LINKS.rapport, "--plan", "plan.json"], deps);
  assert.equal(m.code, 0);
  assert.match(m.uitvoer, /^Aan: joost\.bakker@voorbeeldtechniek\.example/);
  assert.match(m.uitvoer, /Onderwerp: Opvolging kick-off Voorbeeld Techniek/);
  plan = JSON.parse(bestanden["plan.json"]);
  assert.ok(plan.notities.some((n) => n.titel === MAIL_NOTITIE));

  const nieuw = vers();
  nieuw.doel = "Een ander doel.";
  bestanden["n.json"] = JSON.stringify(nieuw);
  const w = hoofd(["wijzigingen", "--oud", "d.json", "--nieuw", "n.json"], deps);
  assert.equal(w.code, 0);
  assert.match(w.uitvoer, /Doel: Een ander doel\./);
  assert.match(hoofd(["wijzigingen", "--oud", "d.json", "--nieuw", "d.json"], deps).uitvoer, /Geen wijzigingen/);
  assert.equal(hoofd(["onbekend"], deps).code, 1);
});

test("wijzigingen: titel met tijd, zodat een tweede aanvulling op dezelfde dag niet wordt overgeslagen", () => {
  const nieuw = vers();
  nieuw.doel = "Een ander doel.";
  assert.equal(wijzigingen(vers(), nieuw, { datum: new Date(2026, 10, 12, 9, 5) }).titel, "Projectstart: aanvulling 12-11-2026 09:05");
  assert.equal(wijzigingen(vers(), nieuw, { datum: new Date(2026, 10, 12, 14, 30) }).titel, "Projectstart: aanvulling 12-11-2026 14:30");
});

test("uitvraag-mail noemt de klantgerichte afspraken, niet de interne", () => {
  const m = uitvraagMail(vers(), {});
  assert.match(m.tekst, /\*\*Afspraken\.\*\*/);
  assert.match(m.tekst, /- Het gesprek over de planning vindt plaats op de laatste dinsdag van de maand\./);
  assert.ok(!m.tekst.includes("Extra werkzaamheden buiten scope"));
  assert.match(m.tekst, /\*\*Technische vragen/);
  const zonder = vers();
  zonder.afspraken = zonder.afspraken.filter((a) => a.intern);
  assert.ok(!uitvraagMail(zonder, {}).tekst.includes("**Afspraken"));
});

test("uitvraag-mail vangnet: euro, ',-', MFA zonder multifactor en wachtwoordtekst", () => {
  const met = (zet) => { const d = vers(); zet(d); return () => uitvraagMail(d, {}); };
  assert.throws(met((d) => { d.aanleveren[0].wat = "Offerte van 12.000 euro tekenen"; }), /bedrag/);
  assert.throws(met((d) => { d.aanleveren[0].wat = "Licentie van 500,- regelen"; }), /bedrag/);
  assert.throws(met((d) => { d.aanleveren[0].wat = "MFA aanzetten"; }), /MFA/);
  assert.doesNotThrow(met((d) => { d.aanleveren[0].wat = "Multifactor-authenticatie (MFA) aanzetten"; }));
  assert.throws(met((d) => { d.technischeVragen[0].vraag = "Klopt wachtwoord: Zomer2026!"; }), /wachtwoord/);
});

test("mail als notitie: zonder ** in de tekst; in de chat blijft de opmaak", async () => {
  const { hoofd, MAIL_NOTITIE } = await import("./teksten.mjs");
  const bestanden = { "d.json": JSON.stringify(vers()) };
  const deps = { lees: (p) => bestanden[p], bestaat: (p) => p in bestanden, schrijf: (p, t) => { bestanden[p] = t; } };
  const r = hoofd(["mail", "--dossier", "d.json", "--plan", "plan.json"], deps);
  assert.match(r.uitvoer, /\*\*Besluiten\.\*\*/);
  const notitie = JSON.parse(bestanden["plan.json"]).notities.find((n) => n.titel === MAIL_NOTITIE);
  assert.ok(!notitie.tekst.includes("**"), notitie.tekst);
  assert.match(notitie.tekst, /^Besluiten\. Dit is de stand van zaken\./m);
});

test("hoofd: briefing met url's zet link-bijlagen in het plan, zonder dubbelen", async () => {
  const { hoofd } = await import("./teksten.mjs");
  const bestanden = { "d.json": JSON.stringify(vers()), "plan.json": JSON.stringify({ notities: [], bijlagen: [{ titel: "Bestaand", url: LINKS.rapport }] }) };
  const deps = { lees: (p) => bestanden[p], bestaat: (p) => p in bestanden, schrijf: (p, t) => { bestanden[p] = t; } };
  const args = ["briefing", "--dossier", "d.json", "--presentatie", LINKS.presentatie, "--rapport", LINKS.rapport, "--plan", "plan.json"];
  for (let i = 0; i < 2; i++) assert.equal(hoofd(args, deps).code, 0);
  const plan = JSON.parse(bestanden["plan.json"]);
  assert.deepEqual(plan.bijlagen, [
    { titel: "Bestaand", url: LINKS.rapport },
    { titel: "Kick-off presentatie Voorbeeld Techniek", url: LINKS.presentatie },
  ]);
});

test("hoofd: briefing zonder url's laat bijlagen ongemoeid; rapport krijgt titel met autotask-naam", async () => {
  const { hoofd } = await import("./teksten.mjs");
  const bestanden = { "d.json": JSON.stringify(vers()) };
  const deps = { lees: (p) => bestanden[p], bestaat: (p) => p in bestanden, schrijf: (p, t) => { bestanden[p] = t; } };
  hoofd(["briefing", "--dossier", "d.json", "--plan", "p.json"], deps);
  assert.deepEqual(JSON.parse(bestanden["p.json"]).bijlagen, []);
  hoofd(["briefing", "--dossier", "d.json", "--rapport", LINKS.rapport, "--plan", "p.json"], deps);
  assert.deepEqual(JSON.parse(bestanden["p.json"]).bijlagen, [{ titel: "IT-inventarisatie Voorbeeld Techniek B.V.", url: LINKS.rapport }]);
});
