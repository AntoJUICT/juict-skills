import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { accent, slides, persoon } from "./slides.mjs";
import { bouwPresentatie, presentatieHtml, hoofd } from "./bouw.mjs";
import { MART_DECK, MART_BESTANDEN } from "./mart-bestanden.mjs";

const VOORBEELD_PAD = fileURLToPath(new URL("../../voorbeeld/dossier.voorbeeld.json", import.meta.url));
const voorbeeld = () => JSON.parse(readFileSync(VOORBEELD_PAD, "utf8"));
const voorbeeldMetBeveiliging = voorbeeld();
const zonderBeveiliging = () => ({ ...voorbeeld(), extraOnderwerpen: [] });
const slide = (d, id) => slides(d).find((x) => x.id === id);

const dossierMetOpenBesluit = (() => {
  const d = voorbeeld();
  d.besluiten = [{ vraag: "Welke omgeving wordt de basis?", beslisser: null, uiterlijk: null, alsNiet: "We houden de huidige omgeving aan." }];
  return d;
})();

test("maximaal 10 slides en vaste volgorde", () => {
  const s = slides(voorbeeldMetBeveiliging);
  assert.equal(s.length, 10);
  assert.deepEqual(s.map((x) => x.id), ["opening", "route", "team", "doel", "veilig", "planning", "besluiten", "aanleveren", "overleg", "afgesproken"]);
});

test("zonder beveiliging 9 slides", () => {
  const s = slides(zonderBeveiliging());
  assert.equal(s.length, 9);
  assert.ok(!s.some((x) => x.id === "veilig"));
});

test("eyebrows en titels volgens spec 5.2, elk met precies één accent", () => {
  const s = slides(voorbeeldMetBeveiliging);
  assert.deepEqual(s.map((x) => x.eyebrow), [
    "De eerste stap", "Zo werken we samen", "Vast team", "Waar we voor gaan", "Veilig vanaf dag één",
    "De route in maanden", "Fase 0", "Jullie aandeel", "Altijd op de hoogte", "Zo gaan we verder",
  ]);
  const titel = Object.fromEntries(s.map((x) => [x.id, x.titel]));
  assert.equal(titel.opening, "Vandaag beginnen we *samen*.");
  assert.equal(titel.route, "We staan bij stap *01*.");
  assert.equal(titel.team, "Korte lijnen, *vaste* gezichten.");
  // De voorbeeldtitels van slide 4 en 5 in de spec ("Twee bedrijven", "Wat er gebeurd is") gelden niet voor elke klant.
  assert.equal(titel.doel, "Eén doel, *heldere* grenzen.");
  assert.equal(titel.veilig, "Wat er al staat, nemen we *mee*.");
  assert.equal(titel.planning, "Van besluit naar plan in *twee* maanden.");
  assert.equal(titel.aanleveren, "Dit hebben we van *jullie* nodig.");
  assert.equal(titel.overleg, "Je weet altijd waar we *staan*.");
  assert.equal(titel.afgesproken, "Dit doen we *samen*.");
  for (const x of s) {
    assert.equal((x.titel.match(/\*[^*]+\*/g) ?? []).length, 1, x.id);
    assert.equal((x.html.match(/<em class="it">/g) ?? []).length, 1, x.id);
  }
});

test("aantal keuzes in de titel volgt het dossier", () => {
  assert.equal(slide(voorbeeld(), "besluiten").titel, "Twee keuzes bepalen het *tempo*.");
  assert.equal(slide(dossierMetOpenBesluit, "besluiten").titel, "Eén keuze bepaalt het *tempo*.");
});

test("open besluit zonder beslisser toont 'bepalen we vandaag'", () => {
  const html = slide(dossierMetOpenBesluit, "besluiten").html;
  assert.match(html, /bepalen we vandaag/);
  assert.match(html, /Welke omgeving wordt de basis\?/);
  assert.match(html, /We houden de huidige omgeving aan\./);
});

test("besluit met beslisser toont naam en datum, niets verzonnen", () => {
  const d = voorbeeld();
  delete d.besluiten[0].besluit; // nog open, met beslisser en datum
  const html = slide(d, "besluiten").html;
  assert.match(html, /Sanne de Vries/);
  assert.match(html, /15 december 2026/);
  const besloten = slide(voorbeeld(), "besluiten").html;
  assert.match(besloten, /<b>Besloten door:<\/b> Sanne de Vries/);
});

test("aanleverpunt zonder wie of datum blijft zichtbaar open", () => {
  const html = slide(voorbeeld(), "aanleveren").html;
  assert.match(html, /Overzicht van gedeelde mailboxen en distributielijsten/);
  const kaart = html.split("Overzicht van gedeelde mailboxen")[1];
  assert.match(kaart, /nog te bepalen/);
  assert.match(html, /Joost Bakker/);
  assert.match(html, /1 december 2026/);
  assert.match(html, /2 uur/);
});

test("teamlid zonder foto krijgt initialen, geen img", () => {
  const h = persoon("Pim Verhoeven", { fotoPaden: MART_BESTANDEN });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, />PV</);
  const metFoto = persoon("Mike Witbreuk", { fotoPaden: MART_BESTANDEN });
  assert.match(metFoto, /<img[^>]+src="assets\/teamfull\/mike\.jpg"/);
  assert.doesNotMatch(persoon("Mike de Klant", { fotoPaden: [] }), /<img/);
  const team = slide(voorbeeld(), "team").html;
  assert.doesNotMatch(team, /<img/);
  assert.match(team, /Pim Verhoeven/);
  assert.match(team, /Joost Bakker/);
  assert.match(team, /aanspreekpunt/i);
  assert.doesNotMatch(team, /beslist/i);
});

test("contactpersoon van de klant krijgt nooit een JUICT-foto", () => {
  const d = voorbeeld();
  d.contacten[0].naam = "Mike de Klant";
  assert.doesNotMatch(slide(d, "team").html, /teamfull\/mike/);
});

test("geen em-dash, geen €, geen BC in de html", () => {
  const uit = mkdtempSync(join(tmpdir(), "kickoff-"));
  try {
    const { bestand } = bouwPresentatie(voorbeeld(), uit);
    const html = readFileSync(bestand, "utf8");
    for (const verboden of [/—/, /€/, /\bEUR\b/, /\bBC\b/, /\bM365\b/, /raming/i, /vrijblijvend/i, /méér/i]) {
      assert.doesNotMatch(html, verboden, String(verboden));
    }
    assert.doesNotMatch(html, /100 per uur/); // interne afspraak blijft buiten de presentatie
  } finally { rmSync(uit, { recursive: true, force: true }); }
});

test("route markeert 01 als 'hier staan we' en dimt 03 tot 05", () => {
  const html = slide(voorbeeld(), "route").html;
  assert.match(html, /hier staan we/);
  const voor01 = html.split("<b>02</b>")[0];
  assert.match(voor01, /<b>01<\/b>/);
  assert.match(voor01, /hier staan we/);
  assert.match(html, /class="ring"[^>]*opacity:\s*\.35/);
  assert.match(html, /class="legend"[^>]*opacity:\s*\.35/);
  // fases met route 01 onder stap 01, route 02 onder stap 02
  const [stap01, stap02] = html.split("<b>02</b>");
  assert.match(stap01, /Voorbereiding en inrichting/);
  assert.match(stap02, /Migratie en oplevering/);
  assert.doesNotMatch(stap01, /Migratie en oplevering/);
});

test("doel-slide toont doel, scope en letterlijk wat er op de harde datum wel en niet klaar is", () => {
  const d = voorbeeld();
  const html = slide(d, "doel").html;
  assert.ok(html.includes("zonder onderbreking van de productie"));
  for (const r of [...d.scope.inbegrepen, ...d.scope.buiten]) assert.ok(html.includes(r), r);
  assert.ok(html.includes(d.hardeDatum.watKlaar));
  assert.ok(html.includes(d.hardeDatum.watNiet));
  assert.match(html, /1 maart 2027/);
});

test("slot eindigt met 'Tot snel.' en het telefoonnummer", () => {
  const html = slide(voorbeeld(), "afgesproken").html;
  assert.match(html, /Tot snel\./);
  assert.match(html, /053 7400 240/);
});

test("accent eist precies één *woord*", () => {
  assert.throws(() => accent("geen accent"));
  assert.throws(() => accent("*twee* *accenten*"));
  assert.equal(accent("Vandaag beginnen we *samen*."), 'Vandaag beginnen we <em class="it">samen</em>.');
  assert.equal(accent("A & *b<c*"), 'A &amp; <em class="it">b&lt;c</em>');
});

test("tekst uit het dossier wordt ge-escaped", () => {
  const d = voorbeeld();
  d.doel = "Werken <script>alert(1)</script> & meer";
  const html = slide(d, "doel").html;
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("bouwPresentatie weigert een ongeldig dossier", () => {
  const d = voorbeeld();
  delete d.doel;
  assert.throws(() => bouwPresentatie(d, tmpdir()), /doel/);
});

test("bouwPresentatie schrijft alleen de pagina en geeft de server-side kopieën", () => {
  const uit = mkdtempSync(join(tmpdir(), "kickoff-"));
  try {
    const { bestand, files } = bouwPresentatie(voorbeeld(), uit);
    assert.ok(isAbsolute(bestand));
    assert.equal(bestand, join(uit, "Kick-off Voorbeeld Techniek.html"));
    assert.deepEqual(readdirSync(uit), ["Kick-off Voorbeeld Techniek.html"]); // geen project/, geen compat.json
    const html = readFileSync(bestand, "utf8");
    assert.match(html, /<title>Kick-off Voorbeeld Techniek<\/title>/);
    assert.match(html, /href="deck\.css"/);
    assert.match(html, /href="assets\/colors_and_type\.css"/);
    assert.match(html, /<script src="present\.js"><\/script>/);
    assert.doesNotMatch(html, /(src|href)="(\/|project\/|_)/);
    assert.equal((html.match(/<section class="slide/g) ?? []).length, 10);
    const DS = "project/_ds/juict-design-system-019dd9ab-8148-72ee-85e6-20ec5e13e5de";
    assert.deepEqual(files["deck.css"], { artifact: MART_DECK, path: "project/deck.css" });
    assert.deepEqual(files["assets/img/kantoor-team.jpg"], { artifact: MART_DECK, path: "project/assets/img/kantoor-team.jpg" });
    assert.deepEqual(files["assets/fonts/LibreFranklin-Regular.ttf"], { artifact: MART_DECK, path: `${DS}/fonts/LibreFranklin-Regular.ttf` });
    assert.deepEqual(files["assets/fonts/Uniwars-SemiBold.otf"], { artifact: MART_DECK, path: `${DS}/fonts/Uniwars-SemiBold.otf` });
    for (const [sleutel, bron] of Object.entries(files)) {
      assert.ok(!sleutel.startsWith("_") && !sleutel.startsWith("project/"), sleutel);
      assert.equal(typeof bron, "object", sleutel); // alleen kopieën uit Marts deck, geen lokale bestanden
      assert.equal(bron.artifact, MART_DECK);
    }
    assert.ok(!Object.keys(files).some((k) => k.endsWith(".html") || k.includes("compat")));
    assert.equal(Object.keys(files).length, MART_BESTANDEN.length - 3);
  } finally { rmSync(uit, { recursive: true, force: true }); }
});

test("CLI bouwt de presentatie en schrijft files.json", async () => {
  const uit = mkdtempSync(join(tmpdir(), "kickoff-"));
  try {
    const r = await hoofd(["--dossier", VOORBEELD_PAD, "--uit", uit]);
    assert.equal(r.code, 0, r.uitvoer);
    assert.ok(existsSync(join(uit, "Kick-off Voorbeeld Techniek.html")));
    const files = JSON.parse(readFileSync(join(uit, "files.json"), "utf8"));
    assert.deepEqual(files["deck.css"], { artifact: MART_DECK, path: "project/deck.css" });
    assert.equal((await hoofd([])).code, 1);
  } finally { rmSync(uit, { recursive: true, force: true }); }
});

// --- Optionele kick-off-velden (fix-ronde 1) ---

const zonder = (d, ...velden) => { for (const v of velden) delete d[v]; return d; };

test("slide 1 toont de kick-off-datum; --datum gaat voor; zonder datum blijft hij open", () => {
  assert.match(slide(voorbeeld(), "opening").html, /24 november 2026/);
  const html = slides(voorbeeld(), { datum: "2026-11-30" }).find((x) => x.id === "opening").html;
  assert.match(html, /30 november 2026/);
  assert.doesNotMatch(html, /24 november 2026/);
  assert.match(slide(zonder(voorbeeld(), "kickoffDatum"), "opening").html, /class="k-open">datum nog te bepalen</);
});

test("slide 6 toont migratieplan en vervolgofferte; open of weg als ze ontbreken", () => {
  const html = slide(voorbeeld(), "planning").html;
  assert.match(html, /Migratieplan klaar: <b>15 januari 2027<\/b>/);
  assert.match(html, /aparte offerte voor de koppeling met de planningssoftware/);
  const leeg = voorbeeld();
  leeg.migratieplan = { datum: null };
  leeg.vervolgOfferte = null;
  const h2 = slide(leeg, "planning").html;
  assert.match(h2, /Migratieplan klaar: <span class="k-open">nog te bepalen<\/span>/);
  assert.doesNotMatch(h2, /offerte/i);
  assert.match(slide(zonder(voorbeeld(), "migratieplan"), "planning").html, /Migratieplan klaar: <span class="k-open">/);
});

test("slide 4 noemt de vervolgofferte alleen als het dossier hem noemt", () => {
  assert.match(slide(voorbeeld(), "doel").html, /aparte offerte voor de koppeling/);
  const d = voorbeeld();
  d.vervolgOfferte = null;
  assert.doesNotMatch(slide(d, "doel").html, /offerte/i);
  assert.doesNotMatch(slide(zonder(voorbeeld(), "vervolgOfferte"), "doel").html, /offerte/i);
});

test("slide 3 toont externe partijen met wie ze aanstuurt, of open", () => {
  const html = slide(voorbeeld(), "team").html;
  assert.match(html, /Voorbeeld Software/);
  assert.match(html, /aangestuurd door Pim Verhoeven/);
  const telecom = html.split("Voorbeeld Telecom")[1];
  assert.match(telecom, /aangestuurd door <span class="k-open">bepalen we vandaag<\/span>/);
  assert.doesNotMatch(html, /Wie hen aanstuurt/);
  // zonder externePartijen: geen verzonnen of altijd-open aansturing
  const kaal = slide(zonder(voorbeeld(), "externePartijen"), "team").html;
  assert.doesNotMatch(kaal, /aangestuurd|aanstuurt/);
  assert.match(kaal, /Femke Jansen/);
});

test("slide 10 toont het volgende overleg of laat het open", () => {
  assert.match(slide(voorbeeld(), "afgesproken").html, /Volgend overleg: <b>8 december 2026<\/b>/);
  const d = voorbeeld();
  d.overleg.volgende = null;
  assert.match(slide(d, "afgesproken").html, /Volgend overleg: <span class="k-open">bepalen we vandaag<\/span>/);
  delete d.overleg.volgende;
  assert.match(slide(d, "afgesproken").html, /Volgend overleg: <span class="k-open">/);
});

test("slide 9 toont hoe we verzoeken controleren alleen als dat bekend is", () => {
  assert.match(slide(voorbeeld(), "overleg").html, /pas door na akkoord van Joost Bakker/);
  const d = voorbeeld();
  d.overleg.verzoekenControle = null;
  assert.doesNotMatch(slide(d, "overleg").html, /Verzoeken/);
});

// Alle vrije-tekstvelden (ook die nu null zijn), behalve de vaste formaten van fases.
function tekstpaden(waarde, pad = []) {
  if (typeof waarde === "string" || waarde === null) return [pad];
  if (Array.isArray(waarde)) return waarde.flatMap((v, i) => tekstpaden(v, [...pad, i]));
  if (waarde && typeof waarde === "object") return Object.entries(waarde).flatMap(([k, v]) => tekstpaden(v, [...pad, k]));
  return [];
}
const VAST_FORMAAT = new Set(["route", "start", "eind"]);
const vrijeTekst = tekstpaden(voorbeeld()).filter((p) => !(p[0] === "fases" && VAST_FORMAAT.has(p.at(-1))));
const zet = (d, pad, w) => { pad.slice(0, -1).reduce((o, k) => o[k], d)[pad.at(-1)] = w; return d; };

test("elk vrij tekstveld wordt ge-escaped (geen rauwe <b>x</b>)", () => {
  assert.ok(vrijeTekst.length > 40, `paden: ${vrijeTekst.length}`);
  for (const pad of vrijeTekst) {
    const html = presentatieHtml(zet(voorbeeld(), pad, "<b>x</b>"));
    assert.doesNotMatch(html, /<b>x<\/b>/, pad.join("."));
  }
});

test("em-dash of bedrag in dossiertekst haalt de presentatie nooit", () => {
  const uit = mkdtempSync(join(tmpdir(), "kickoff-"));
  try {
    for (const pad of vrijeTekst) {
      assert.throws(() => bouwPresentatie(zet(voorbeeld(), pad, "a — b"), uit), /em-dash/, pad.join("."));
      const d = zet(voorbeeld(), pad, "kost € 5");
      const intern = pad[0] === "afspraken" && pad.at(-1) === "tekst" && d.afspraken[pad[1]].intern;
      if (intern) assert.doesNotMatch(readFileSync(bouwPresentatie(d, uit).bestand, "utf8"), /€/);
      else assert.throws(() => bouwPresentatie(d, uit), /bedrag/, pad.join("."));
    }
  } finally { rmSync(uit, { recursive: true, force: true }); }
});

// --- Feedback van Mike op de eerste echte kick-off (fix-ronde 3) ---

test("slide 3: klantcontacten alleen met naam, plus 'dagelijks aanspreekpunt'; JUICT met rol", () => {
  const html = slide(voorbeeld(), "team").html;
  const klant = html.split("<h3>Voorbeeld Techniek</h3>")[1].split('<div class="k-groep">')[0];
  assert.match(klant, /Sanne de Vries/);
  assert.match(klant, /Joost Bakker/);
  assert.doesNotMatch(klant, /Directeur|Office manager|k-rol/);
  assert.doesNotMatch(klant, /beslist/);
  assert.equal((klant.match(/dagelijks aanspreekpunt/g) ?? []).length, 1);
  assert.ok(klant.split("Joost Bakker")[1].includes("dagelijks aanspreekpunt"));
  const juict = html.split("<h3>JUICT</h3>")[1].split('<div class="k-groep">')[0];
  assert.match(juict, /<span class="k-rol">Projectleider<\/span>/);
  assert.match(html, /aangestuurd door Pim Verhoeven/); // externe partijen ongewijzigd
});

test("slide 8: op hoofdlijnen, details per mail; geen rapport in de hele deck", () => {
  const html = slide(voorbeeld(), "aanleveren").html;
  assert.match(html, /Op hoofdlijnen\. Wat we precies nodig hebben, sturen we jullie na vandaag per mail\./);
  assert.match(html, /Technische vragen bespreken we niet hier\. Die nemen we mee in die mail\./);
  assert.doesNotMatch(presentatieHtml(voorbeeld()), /rapport/i);
});

test("slide 10: alleen de volgende stappen, geen herhaling van besluiten en aanleverpunten", () => {
  const s = slide(voorbeeld(), "afgesproken");
  assert.equal(s.eyebrow, "Zo gaan we verder");
  assert.equal(s.titel, "Dit doen we *samen*.");
  const rijen = [...s.html.matchAll(/<li><span>([^<]*)<\/span><b>([\s\S]*?)<\/b><\/li>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rijen, [
    ["Mail met de afspraken van vandaag en wat we van jullie nodig hebben", "JUICT"],
    ["Lijst met alle gebruikers en hun functie", "Joost Bakker"],
    ["Start van de inventarisatie", "JUICT"],
  ]);
  assert.doesNotMatch(s.html, /telefooncentrale|gedeelde planningsmap/);
  for (const t of ["Volgend overleg", "053 7400 240", "Tot snel."]) assert.ok(s.html.includes(t), t);
});

test("slide 10: eerste aanleverpunt zonder wie blijft open; zonder aanleverpunten geen tweede stap", () => {
  const d = voorbeeld();
  d.aanleveren = [d.aanleveren[1]];
  assert.match(slide(d, "afgesproken").html, /<span>Overzicht van gedeelde mailboxen en distributielijsten<\/span><b><span class="k-open">nog te bepalen<\/span><\/b>/);
  d.aanleveren = [];
  assert.equal((slide(d, "afgesproken").html.match(/<li>/g) ?? []).length, 2);
});

test("slide 10 heeft geen aparte technische kick-off", () => {
  assert.doesNotMatch(presentatieHtml(voorbeeld()), /technische kick-off/i);
});

test("slide 9: kanaal, support en noodnummer onder de kaarten, voor de band", () => {
  const html = slide(voorbeeld(), "overleg").html;
  const regel = html.split('<div class="belofte">')[0];
  assert.match(regel, /Kanaal: <b>Microsoft Teams, kanaal Project nieuwe omgeving<\/b>/);
  assert.match(regel, /Support: <b>support@juict\.nl<\/b> en <b>klantportaal\.juict\.nl<\/b>/);
  assert.match(regel, /Noodnummer <b>053 7400 450<\/b>, alleen bij urgente storingen \(daar kunnen extra kosten aan zitten\)/);
  const d = voorbeeld();
  d.overleg.kanaal = null;
  assert.match(slide(d, "overleg").html, /Kanaal: <span class="k-open">bepalen we vandaag<\/span>/);
  delete d.overleg.kanaal;
  assert.match(slide(d, "overleg").html, /Kanaal: <span class="k-open">/);
});

test("slide 6: gebruikersimpact en overgang beheer alleen als het dossier ze noemt", () => {
  const d = voorbeeld();
  const html = slide(d, "planning").html;
  assert.ok(html.includes(`<p class="k-voet" style="margin-top:8px;">${d.gebruikersimpact}</p>`));
  assert.ok(html.includes("JUICT neemt het beheer pas over als we volledige toegang hebben."));
  d.gebruikersimpact = null;
  delete d.overgangBeheer;
  const leeg = slide(d, "planning").html;
  assert.doesNotMatch(leeg, /impact|beheer pas over/i);
});

test("slide 5: optioneel beveiligingsonderwerp toont (optioneel) bij het controleren", () => {
  const d = voorbeeld();
  assert.ok(!slide(d, "veilig").html.includes("(optioneel)"));
  d.extraOnderwerpen[0].optioneel = true;
  assert.ok(slide(d, "veilig").html.includes("Dit controleren we (optioneel)"));
});

test("slide 7: een genomen besluit staat er als besluit, niet als open punt", () => {
  const d = voorbeeld();
  d.besluiten = [{ vraag: "Welke omgeving wordt de basis?", beslisser: null, uiterlijk: null, alsNiet: "We houden de huidige omgeving aan.", besluit: "De nieuwe omgeving wordt de basis." }];
  const html = slide(d, "besluiten").html;
  assert.match(html, /<b>Besluit:<\/b> De nieuwe omgeving wordt de basis\./);
  assert.doesNotMatch(html, /bepalen we vandaag/);
  assert.doesNotMatch(html, /Als het vandaag niet lukt/);
});
