import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pvaHtml, controleerPva, openPunten, main, MARKER_INHOUD } from "./pva.mjs";

const VOORBEELD_PAD = fileURLToPath(new URL("../../voorbeeld/dossier.voorbeeld.json", import.meta.url));
const voorbeeld = () => JSON.parse(readFileSync(VOORBEELD_PAD, "utf8"));
const html = (d = voorbeeld(), o = {}) => pvaHtml(d, { datum: "2026-11-17", ...o });
const koppen = (h) => [...h.matchAll(/<h1>([^<]*)<\/h1>/g)].map((m) => m[1]);
const tekst = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const hoofdstuk = (h, titel) => {
  const i = h.indexOf(`${titel}</h1>`);
  assert.ok(i >= 0, `hoofdstuk ${titel} ontbreekt`);
  const j = h.indexOf('<br clear="all"', i);
  return h.slice(i, j < 0 ? undefined : j);
};

test("hoofdstukken in de volgorde van de kick-off, genummerd", () => {
  assert.deepEqual(koppen(html()), [
    "1 Aanleiding en doel", "2 Route en scope", "3 Team en contactpersonen", "4 Planning", "5 Besluiten",
    "6 Wat jullie aanleveren", "7 Informatiebeveiliging", "8 Overleg en communicatie", "9 Impact en overgang",
    "10 Afspraken", "11 Technische uitvoering en afronding", "12 Open punten", "13 Goedkeuring",
  ]);
});

test("voorblad, inhoudsopgave-markering en roze label boven elk hoofdstuk", () => {
  const h = html(voorbeeld(), { versie: 3, logo: "file:///logo.svg", voorblad: "file:///band.png" });
  assert.match(h, /alt="voorblad" width="794" height="448"/);
  assert.match(h, /<img src="file:\/\/\/logo.svg" alt="JUICT" width="160" height="61">/);
  for (const s of ["Plan van aanpak", "Voorbeeld Techniek", "Versie 3", "17 november 2026", "Opgesteld door Pim Verhoeven, JUICT", "Autotask-project 9001"]) assert.ok(tekst(h).includes(s), s);
  assert.equal(h.split(MARKER_INHOUD).length - 1, 1);
  assert.match(h, /<p class="kicker">De eerste stap<\/p>\n<h1>1 Aanleiding en doel<\/h1>/);
  assert.match(h, /<p class="kicker">Fase 0<\/p>\n<h1>5 Besluiten<\/h1>/);
});

test("pagina-einde voor de inhoudsopgave en voor elk hoofdstuk", () => {
  const h = html();
  const einden = h.split('<br clear="all" style="page-break-before: always">').length - 1;
  assert.equal(einden, koppen(h).length + 1);
  assert.doesNotMatch(h, /<div[^>]*page-break/);
});

test("hoofdstukken zonder inhoud vallen weg en de nummering sluit aan", () => {
  const d = voorbeeld();
  d.besluiten = []; d.aanleveren = []; d.extraOnderwerpen = [];
  delete d.gebruikersimpact; delete d.overgangBeheer; delete d.externePartijen;
  d.afspraken = [];
  const k = koppen(html(d));
  for (const weg of ["Besluiten", "Wat jullie aanleveren", "Informatiebeveiliging", "Impact en overgang", "Afspraken"]) {
    assert.ok(!k.some((x) => x.endsWith(` ${weg}`)), weg);
  }
  assert.deepEqual(k.map((x) => Number(x.split(" ")[0])), k.map((_, i) => i + 1));
  assert.ok(k.includes("5 Overleg en communicatie"));
});

test("financiële afspraken in een eigen tabel met de bron per regel", () => {
  const h = hoofdstuk(html(), "Afspraken");
  assert.match(h, /<h2>Financiële afspraken<\/h2>/);
  const fin = h.slice(h.indexOf("Financiële afspraken"));
  assert.match(fin, /<th[^>]*>Bron<\/th>/);
  assert.match(fin, /€ 100 per uur\.<\/td><td><span class="klein">Offerte 2026-11-02<\/span>/);
  assert.match(fin, /met 12 maanden verlengd/);
  // Algemene afspraken staan niet in de financiële tabel en andersom.
  assert.doesNotMatch(fin, /laatste dinsdag/);
  assert.doesNotMatch(h.slice(0, h.indexOf("Financiële afspraken")), /per uur/);
});

test("financiële term die alleen in een mail staat: geen afspraak, wel een open punt", () => {
  const h = html();
  assert.doesNotMatch(hoofdstuk(h, "Afspraken"), /korting/);
  const open = hoofdstuk(h, "Open punten");
  assert.match(open, /10 procent korting op de werkelijk bestede uren\./);
  assert.match(open, /Mail Sanne de Vries 2026-11-12\. Controleren tegen de offerte/);
});

test("controleren zonder financieel is ongeldig", () => {
  const d = voorbeeld();
  d.afspraken[0].controleren = true;
  assert.throws(() => html(d), /controleren: alleen voor een financiële afspraak/);
});

test("feit zonder bron: uitgangspunt, nog te bevestigen, en een open punt", () => {
  const d = voorbeeld();
  delete d.doelBron;
  const h = html(d);
  const eerste = hoofdstuk(h, "Aanleiding en doel");
  assert.equal(eerste.split("Uitgangspunt, nog te bevestigen.").length - 1, 2); // doel en harde datum
  const open = tekst(hoofdstuk(h, "Open punten"));
  assert.ok(open.includes("Doel van het project"));
  assert.ok(open.includes("Harde datum 1 maart 2027"));
  d.doelBron = "Mail Sanne de Vries 2026-11-12";
  d.hardeDatum.bron = "Kick-off 2026-11-24";
  const met = html(d);
  assert.doesNotMatch(met, /nog te bevestigen/);
  assert.match(hoofdstuk(met, "Aanleiding en doel"), /Bron: Kick-off 2026-11-24/);
  assert.ok(!openPunten(d).some((p) => /Doel|Harde datum/.test(p.wat)));
});

test("genomen besluit toont uitkomst en bron; zonder bron wordt het een open punt", () => {
  const d = voorbeeld();
  const b = hoofdstuk(html(d), "Besluiten");
  assert.match(b, /Alle medewerkers krijgen leestoegang tot de gedeelde planningsmap\./);
  assert.match(b, /Bron: Mail Sanne de Vries 2026-11-12/);
  delete d.besluiten[0].bron;
  assert.match(hoofdstuk(html(d), "Besluiten"), /Bron nog vastleggen\./);
  assert.ok(openPunten(d).some((p) => p.wat.startsWith("Besluit: Welke gebruikers") && /zonder bron/.test(p.waarom)));
});

test("onbekende datums: nog te plannen in de planning en in Open punten, nooit n.t.b.", () => {
  const d = voorbeeld();
  d.migratieplan.datum = null;
  const h = html(d);
  const plan = hoofdstuk(h, "Planning");
  assert.match(plan, /Migratieplan klaar<\/td><td>nog te plannen/);
  assert.match(plan, /Overzicht van gedeelde mailboxen en distributielijsten<\/td><td>nog te plannen/);
  assert.match(plan, /<th[^>]*>Start<\/th><th[^>]*>Eind<\/th>/);
  assert.match(plan, /december 2026<\/td><td>januari 2027/);
  const open = tekst(hoofdstuk(h, "Open punten"));
  assert.ok(open.includes("Migratieplan Datum nog te plannen."));
  assert.ok(open.includes("Aanleveren: Overzicht van gedeelde mailboxen en distributielijsten"));
  assert.ok(open.includes("datum nog te plannen"));
  assert.doesNotMatch(tekst(h), /n\.t\.b\.|\bntb\b/i);
});

test("geen instructieteksten en geen lege tabellen", () => {
  const h = html();
  assert.deepEqual(controleerPva(h), []);
  assert.doesNotMatch(tekst(h), /\bVoer\b.*\buit\b|\bBeschrijf\b|\bMaak een\b/);
  for (const t of h.match(/<table\b[\s\S]*?<\/table>/g)) assert.match(t, /<tbody>[\s\S]*<td\b/);
  // De controle vangt ze ook echt.
  assert.ok(controleerPva("<p>Voer een impactanalyse uit.</p>").length);
  assert.ok(controleerPva("<p>Beschrijf hoe de overgang verloopt.</p>").length);
  assert.ok(controleerPva("<p>Maak een gedetailleerde planning.</p>").length);
  assert.ok(controleerPva("<table><thead><tr><th>Server</th></tr></thead><tbody>\n\n</tbody></table>").length);
  assert.ok(controleerPva("<p>Start n.t.b.</p>").length);
});

test("instructietekst uit het dossier blokkeert het PVA", () => {
  const d = voorbeeld();
  d.gebruikersimpact = "Voer een impactanalyse uit voor alle afdelingen.";
  assert.throws(() => html(d), /instructietekst/);
});

test("alles wordt ge-escaped", () => {
  const d = voorbeeld();
  d.klant.weergave = "<script>alert(1)</script>";
  d.scope.inbegrepen.push('Tekst met "aanhalingstekens" & <b>vet</b>');
  const h = html(d);
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(h, /&quot;aanhalingstekens&quot; &amp; &lt;b&gt;vet&lt;\/b&gt;/);
});

test("bedragen mogen in het PVA, schrijfregels en geheimen blijven verboden", () => {
  assert.match(html(), /€ 100 per uur/);
  const d = voorbeeld();
  d.doel = "Overstap naar M365 voor iedereen.";
  assert.throws(() => html(d), /M365/);
  const g = voorbeeld();
  g.scope.inbegrepen.push("Wachtwoord: Zomer2026!");
  assert.throws(() => html(g), /geheim|wachtwoord/i);
});

test("goedkeuring met opdrachtgever en projectleider", () => {
  const g = tekst(hoofdstuk(html(), "Goedkeuring"));
  for (const s of ["Rol", "Naam", "Functie", "Datum", "Handtekening", "Opdrachtgever Sanne de Vries Directeur", "Projectleider Pim Verhoeven"]) assert.ok(g.includes(s), s);
});

test("CLI: schrijft HTML, foutcodes bij gebruik en ongeldig dossier", () => {
  const map = mkdtempSync(join(tmpdir(), "pva-"));
  const stderr = process.stderr.write, stdout = process.stdout.write;
  process.stderr.write = () => true; process.stdout.write = () => true;
  try {
    const uit = join(map, "pva.html");
    assert.equal(main(["--dossier", VOORBEELD_PAD, "--uit", uit, "--versie", "2", "--datum", "2026-11-17"]), 0);
    assert.match(readFileSync(uit, "utf8"), /Versie 2/);
    assert.equal(main(["--dossier", VOORBEELD_PAD]), 1);
    assert.equal(main(["--dossier", VOORBEELD_PAD, "--uit", uit, "--versie", "nul"]), 1);
    const slecht = join(map, "slecht.json");
    writeFileSync(slecht, JSON.stringify({ ...voorbeeld(), doel: "" }));
    assert.equal(main(["--dossier", slecht, "--uit", uit]), 1);
    assert.equal(main(["--dossier", join(map, "bestaat-niet.json"), "--uit", uit]), 2);
  } finally {
    process.stderr.write = stderr; process.stdout.write = stdout;
    rmSync(map, { recursive: true, force: true });
  }
});

test("open punten: kolom heet 'Wie pakt het op', zodat een open aanleverder niet botst met de naam in de kolom", () => {
  const d = JSON.parse(readFileSync(new URL("../../voorbeeld/dossier.voorbeeld.json", import.meta.url), "utf8"));
  const html = pvaHtml(d, {});
  assert.ok(html.includes("Wie pakt het op"));
});
