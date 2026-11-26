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

test("uitvraag-mail: ontvanger, cc, volgorde van onderdelen, nooit een url", () => {
  const m = uitvraagMail(vers(), { rapport: LINKS.rapport });
  assert.equal(m.aan, "joost.bakker@voorbeeldtechniek.example");
  assert.deepEqual(m.cc, ["sanne.devries@voorbeeldtechniek.example"]);
  assert.match(m.tekst, /^Hoi Joost,/);
  const pos = ["Bedankt voor jullie tijd", "In de bijlage vind je het inventarisatierapport", "**We vragen je het rapport zorgvuldig door te nemen.**", "levend document", "Kort de belangrijkste punten:", "- **Besluiten:**", "- **Aanleveren:**", "- **Technische vragen:**", "- **Afspraken:**", "Wachtwoorden hoef"]
    .map((s) => m.tekst.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), pos.join());
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b));
  assert.ok(!/claude\.ai|https?:/.test(m.tekst), "geen url in de mail");
  assert.match(m.tekst, /Lijst met alle gebruikers en hun functie \(Joost Bakker.*01-12-2026/);
  assert.match(m.tekst, /Overzicht van gedeelde mailboxen.*nog open/);
  assert.match(m.tekst, /Welke versie draait de planningssoftware/);
  assert.match(m.tekst, /Voortgangsoverleg: Tweewekelijks een half uur op dinsdag\./);
  assert.match(m.tekst, /Blijft de oude telefooncentrale/);
  assert.ok(!m.tekst.includes("Zonder besluit geldt"));
});

test("uitvraag-mail: genomen besluiten staan er niet bij, open besluiten wel", () => {
  const d = vers();
  d.besluiten[0].besluit = "Alle medewerkers krijgen toegang.";
  const m = uitvraagMail(d, {});
  assert.ok(!m.tekst.includes("Alle medewerkers krijgen toegang"));
  assert.ok(!m.tekst.includes(d.besluiten[0].vraag));
  assert.match(m.tekst, /Blijft de oude telefooncentrale/);
});

test("uitvraag-mail: lege lijsten laten hun punt weg, zonder punten ook de inleiding", () => {
  const d = vers();
  d.technischeVragen = [];
  d.afspraken = [];
  delete d.overleg.ritme;
  let m = uitvraagMail(d, {});
  assert.ok(!m.tekst.includes("**Technische vragen"));
  assert.ok(!m.tekst.includes("**Afspraken"));
  assert.match(m.tekst, /\*\*Besluiten:\*\*/);
  d.besluiten = d.besluiten.map((b) => ({ ...b, besluit: "Besloten." }));
  d.aanleveren = [];
  m = uitvraagMail(d, {});
  assert.ok(!m.tekst.includes("Kort de belangrijkste punten"));
  assert.match(m.tekst, /Wachtwoorden hoef je niet te sturen[^\n]*\n\nGroet,/);
});

test("uitvraag-mail: zonder rapport een toezegging in plaats van de bijlage", () => {
  const m = uitvraagMail(vers(), { bijlage: false });
  assert.ok(m.tekst.includes("Het inventarisatierapport sturen we je zo snel mogelijk toe. We vragen je het rapport dan zorgvuldig door te nemen: daarin staat vooral wat we nog van jullie nodig hebben."));
  assert.ok(!m.tekst.includes("In de bijlage"));
});

test("mailHtml: Calibri-wrapper, alinea's, lijst, vet en escaping", async () => {
  const { mailHtml } = await import("./teksten.mjs");
  const h = mailHtml('Hoi A & B,\n\nLet op <script>"x"</script> **vet** tekst.\n\nKort:\n- **Punt:** a < b.\n- Twee\n\nGroet,\nMike');
  assert.match(h, /^<div style="font-family:Calibri,sans-serif;font-size:11pt">/);
  assert.ok(h.includes("<p>Hoi A &amp; B,</p>"));
  assert.ok(h.includes("&lt;script&gt;&quot;x&quot;&lt;/script&gt; <b>vet</b> tekst."));
  assert.ok(!h.includes("<script>"));
  assert.ok(h.includes("<p>Kort:</p><ul><li><b>Punt:</b> a &lt; b.</li><li>Twee</li></ul>"));
  assert.ok(h.includes("<p>Groet,<br>Mike</p>"));
});

test("hoofd: mail --json schrijft aan, cc met puntkomma, html en tekst; --rapport komt niet in de mail", async () => {
  const { hoofd } = await import("./teksten.mjs");
  const bestanden = { "d.json": JSON.stringify(vers()) };
  const deps = { lees: (p) => bestanden[p], bestaat: (p) => p in bestanden, schrijf: (p, t) => { bestanden[p] = t; } };
  const r = hoofd(["mail", "--dossier", "d.json", "--rapport", LINKS.rapport, "--json", "mail.json"], deps);
  assert.equal(r.code, 0);
  const j = JSON.parse(bestanden["mail.json"]);
  assert.deepEqual(Object.keys(j), ["aan", "cc", "onderwerp", "html", "tekst"]);
  assert.equal(j.cc, "sanne.devries@voorbeeldtechniek.example");
  assert.ok(j.html.includes("<b>We vragen je het rapport zorgvuldig door te nemen.</b>"));
  for (const x of [r.uitvoer, j.tekst, j.html]) assert.ok(!/claude\.ai/.test(x));
  const z = hoofd(["mail", "--dossier", "d.json", "--zonder-rapport"], deps);
  assert.match(z.uitvoer, /sturen we je zo snel mogelijk toe/);
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
  d.besluiten[1].vraag = "Gaan we akkoord met € 50 extra?";
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
  assert.match(m.tekst, /- \*\*Afspraken:\*\* Voortgangsoverleg: .* Het gesprek over de planning vindt plaats op de laatste dinsdag van de maand\./);
  assert.ok(!m.tekst.includes("Extra werkzaamheden buiten scope"));
  const zonder = vers();
  zonder.afspraken = zonder.afspraken.filter((a) => a.intern);
  assert.ok(!uitvraagMail(zonder, {}).tekst.includes("Het gesprek over de planning"));
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
  assert.match(r.uitvoer, /\*\*Besluiten:\*\*/);
  const notitie = JSON.parse(bestanden["plan.json"]).notities.find((n) => n.titel === MAIL_NOTITIE);
  assert.ok(!notitie.tekst.includes("**"), notitie.tekst);
  assert.match(notitie.tekst, /^- Besluiten: /m);
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

test("uitvraagMail noemt het overlegritme niet dubbel als een afspraak het overleg al beschrijft", () => {
  const d = JSON.parse(readFileSync(new URL("../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
  d.overleg = { ...d.overleg, ritme: "Eens per drie weken" };
  d.afspraken = [{ tekst: "Voortgangsoverleg eens per drie weken.", intern: false, bron: "test" }];
  const { tekst } = uitvraagMail(d, {});
  assert.equal(tekst.split(/overleg/i).length - 1, 1);
});

test("uitvraag-mail laat een afspraak weg die nog tegen de offerte gecontroleerd moet worden", () => {
  const d = vers();
  d.afspraken.push({ tekst: "Het voortgangsgesprek wordt elke maand ingepland.", intern: false, bron: "Mail 2026-11-12" },
    { tekst: "Korting op de werkelijk bestede uren volgens de mail.", intern: false, financieel: true, controleren: true, bron: "Mail 2026-11-12" });
  const m = uitvraagMail(d);
  assert.match(m.tekst, /elke maand ingepland/);
  assert.doesNotMatch(m.tekst, /Korting/);
});

// --- GDAP ---

test("briefing noemt de GDAP-stand bij de techniek", () => {
  const d = vers();
  d.gdap = { status: "beperkt", gecontroleerd: "2026-11-26", ontbreekt: ["Beheerrollen"] };
  const t = briefing(d, LINKS).tekst;
  const techniek = t.slice(t.indexOf("Voor de techniek"));
  assert.match(techniek, /GDAP: .*Beheerrollen/);
});

test("uitvraag-mail vraagt om goedkeuring van het toegangsverzoek alleen bij geen toegang", () => {
  const d = vers();
  d.gdap = { status: "geen-toegang", gecontroleerd: "2026-11-26" };
  const m = uitvraagMail(d).tekst;
  assert.match(m, /\*\*Toegang:\*\*.*verzoek om toegang tot jullie Microsoft 365-omgeving/);
  assert.ok(!/GDAP/.test(m), "geen vakterm in de klantmail");
  d.gdap = { status: "actief", gecontroleerd: "2026-11-26" };
  assert.ok(!/\*\*Toegang:\*\*/.test(uitvraagMail(d).tekst));
});

test("wijzigingen meldt een andere GDAP-stand", () => {
  const oud = vers();
  oud.gdap = { status: "geen-toegang", gecontroleerd: "2026-11-20" };
  const nieuw = vers();
  nieuw.gdap = { status: "actief", gecontroleerd: "2026-11-26" };
  const w = wijzigingen(oud, nieuw, { datum: new Date("2026-11-26T10:00:00Z") });
  assert.match(w.tekst, /GDAP/);
});
