// Teksten uit het dossier: interne briefing, aanvullingsnotitie en de uitvraag-mail (spec 5.5 en 5.6).
// Alleen de uitvraag-mail gaat naar de klant: daar staan geen bedragen en geen interne afspraken in.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isBedrag } from "./dossier.mjs";
import { findSecretText } from "../../it-inventarisatie/scripts/geheimen.mjs";

const p2 = (n) => String(n).padStart(2, "0");

export function nlDatum(waarde) {
  if (waarde instanceof Date) return `${p2(waarde.getDate())}-${p2(waarde.getMonth() + 1)}-${waarde.getFullYear()}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(waarde ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(waarde);
}

const nlTijd = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

const eindig = (z) => (/[.!?]$/.test(z) ? z : `${z}.`);
const voornaam = (naam) => String(naam).split(" ")[0];

const projectleider = (d) => d.team?.find((t) => /projectleider/i.test(t.rol))?.naam ?? null;

// --- Besluiten, aanleveren en vragen (gedeeld door briefing en mail) ---

// Een besluit met een ingevuld veld `besluit` is genomen; zonder dat veld is het nog open.
const isBesloten = (b) => typeof b.besluit === "string" && b.besluit.trim() !== "";

function besluitRegel(b) {
  if (isBesloten(b)) return `Afgesproken: ${eindig(b.besluit.trim())}`;
  const wie = b.beslisser ? ` ${b.beslisser} beslist` : " De beslisser is nog niet bepaald";
  const wanneer = b.uiterlijk ? ` uiterlijk ${nlDatum(b.uiterlijk)}` : "";
  return `Nog open: ${b.vraag}${wie}${wanneer}. Zonder besluit geldt: ${eindig(b.alsNiet)}`.replace(/\.\s*\./g, ".");
}

function aanleverRegel(a) {
  const delen = [];
  if (a.wie) delen.push(a.wie);
  if (a.datum) delen.push(`voor ${nlDatum(a.datum)}`);
  if (a.tijd) delen.push(`ongeveer ${a.tijd}`);
  return delen.length ? `${a.wat} (${delen.join(", ")})` : `${a.wat} (nog open: wie en wanneer)`;
}

// --- Briefing (intern) ---

export function briefing(d, { presentatie, rapport } = {}) {
  const l = [];
  const pl = projectleider(d);
  l.push(`Briefing voor de kick-off met ${d.klant.weergave}${d.kickoffDatum ? ` op ${nlDatum(d.kickoffDatum)}` : ""}.`, "");

  l.push("Voor de projectleider", "");
  l.push(`Doel: ${d.doel}`);
  l.push(`Harde datum: ${nlDatum(d.hardeDatum.datum)}. Klaar: ${d.hardeDatum.watKlaar} Niet klaar: ${d.hardeDatum.watNiet}`);
  l.push("", "Contacten:");
  for (const c of d.contacten) {
    const rollen = [c.beslisser ? "beslisser" : null, c.aanspreekpunt ? "aanspreekpunt" : null].filter(Boolean);
    l.push(`- ${c.naam}, ${c.rol}, ${c.organisatie}${rollen.length ? ` (${rollen.join(", ")})` : ""}`);
  }
  l.push("", "Besluiten:");
  for (const b of d.besluiten) l.push(`- ${besluitRegel(b)}`);
  l.push("", "Door de klant aan te leveren:");
  for (const a of d.aanleveren) l.push(`- ${aanleverRegel(a)}`);
  const intern = d.afspraken.filter((a) => a.intern);
  const klant = d.afspraken.filter((a) => !a.intern);
  if (klant.length) { l.push("", "Afspraken met de klant:"); for (const a of klant) l.push(`- ${a.tekst} (${a.bron})`); }
  if (intern.length) { l.push("", "Interne afspraken (niet delen met de klant):"); for (const a of intern) l.push(`- ${a.tekst} (${a.bron})`); }
  l.push("", `Overleg: ${d.overleg.ritme}. Aanspreekpunt ${d.overleg.aanspreekpunt}, escalatie ${d.overleg.escalatie}.`);
  if (d.overleg.verzoekenControle) l.push(d.overleg.verzoekenControle);
  l.push("");

  l.push("Voor de techniek", "");
  l.push("Scope, inbegrepen:");
  for (const s of d.scope.inbegrepen) l.push(`- ${s}`);
  l.push("Scope, buiten:");
  for (const s of d.scope.buiten) l.push(`- ${s}`);
  if (d.externePartijen?.length) {
    l.push("", "Externe partijen:");
    for (const e of d.externePartijen) l.push(`- ${e.naam}, ${e.rol}${e.aangestuurdDoor ? `, aangestuurd door ${e.aangestuurdDoor}` : ""}`);
  }
  if (d.overgangBeheer) l.push("", `Overgang beheer: ${d.overgangBeheer}`);
  for (const o of d.extraOnderwerpen ?? []) {
    l.push("", `Extra onderwerp ${o.soort}:`);
    for (const x of o.geregeld) l.push(`- Geregeld: ${x}`);
    for (const x of o.controleren) l.push(`- Controleren: ${x}`);
    for (const x of o.later) l.push(`- Later: ${x}`);
  }
  l.push("", "Punten om uit te vragen:");
  if (d.technischeVragen.length) for (const v of d.technischeVragen) l.push(`- ${v.vraag} (aan ${v.aan}, bron ${v.bron})`);
  else l.push("- Geen openstaande technische vragen.");
  for (const b of d.besluiten.filter((x) => !isBesloten(x))) l.push(`- Open besluit: ${b.vraag}`);
  l.push("");

  l.push("Links", `- Presentatie: ${presentatie ?? "nog niet gepubliceerd"}`, `- Rapport: ${rapport ?? "nog niet gepubliceerd"}`, "");
  l.push("Actie", `- Presentatie en rapport delen met JUICT (bewerken)${pl ? `, door ${pl}` : ""}`);
  return { titel: "Projectstart: briefing kick-off", tekst: l.join("\n") + "\n" };
}

// --- Aanvulling: alleen wat veranderd is ---

const LIJSTEN = [
  ["Contacten", (d) => d.contacten, (c) => `${c.naam}, ${c.rol}, ${c.organisatie}${c.beslisser ? ", beslisser" : ""}${c.aanspreekpunt ? ", aanspreekpunt" : ""}`],
  ["Team", (d) => d.team, (t) => `${t.naam}, ${t.rol}`],
  ["Besluiten", (d) => d.besluiten, (b) => besluitRegel(b)],
  ["Aanleveren", (d) => d.aanleveren, (a) => aanleverRegel(a)],
  ["Afspraken", (d) => d.afspraken, (a) => `${a.tekst} (${a.bron})${a.intern ? " [intern]" : ""}`],
  ["Technische vragen", (d) => d.technischeVragen, (v) => `${v.vraag} (aan ${v.aan})`],
  ["Scope inbegrepen", (d) => d.scope?.inbegrepen, (s) => s],
  ["Scope buiten", (d) => d.scope?.buiten, (s) => s],
  ["Extra onderwerpen", (d) => d.extraOnderwerpen, (o) => `${o.soort}: geregeld ${o.geregeld.join("; ") || "-"}; controleren ${o.controleren.join("; ") || "-"}; later ${o.later.join("; ") || "-"}`],
  ["Externe partijen", (d) => d.externePartijen, (e) => `${e.naam}, ${e.rol}${e.aangestuurdDoor ? `, aangestuurd door ${e.aangestuurdDoor}` : ""}`],
];

const ENKEL = [
  ["Doel", (d) => d.doel],
  ["Harde datum", (d) => d.hardeDatum && `${nlDatum(d.hardeDatum.datum)}; klaar: ${d.hardeDatum.watKlaar}; niet klaar: ${d.hardeDatum.watNiet}`],
  ["Kick-off", (d) => d.kickoffDatum && nlDatum(d.kickoffDatum)],
  ["Migratieplan", (d) => d.migratieplan?.datum && nlDatum(d.migratieplan.datum)],
  ["Vervolgofferte", (d) => d.vervolgOfferte],
  ["Gebruikersimpact", (d) => d.gebruikersimpact],
  ["Overgang beheer", (d) => d.overgangBeheer],
  ["Overleg ritme", (d) => d.overleg?.ritme],
  ["Overleg aanspreekpunt", (d) => d.overleg?.aanspreekpunt],
  ["Overleg escalatie", (d) => d.overleg?.escalatie],
  ["Overleg kanaal", (d) => d.overleg?.kanaal],
  ["Volgend overleg", (d) => d.overleg?.volgende && nlDatum(d.overleg.volgende)],
  ["Verzoeken en controle", (d) => d.overleg?.verzoekenControle],
  ["Fases", (d) => d.fases?.map((f) => `${f.code} ${f.naam} (${f.start} tot ${f.eind})`).join("; ")],
];

export function wijzigingen(oud, nieuw, { datum = new Date() } = {}) {
  const l = [];
  for (const [naam, haal, fmt] of LIJSTEN) {
    const o = (haal(oud) ?? []).map(fmt);
    const n = (haal(nieuw) ?? []).map(fmt);
    const erbij = n.filter((x) => !o.includes(x));
    const eraf = o.filter((x) => !n.includes(x));
    if (!erbij.length && !eraf.length) continue;
    l.push(`${naam}:`);
    for (const x of erbij) l.push(`- Nieuw of gewijzigd: ${x}`);
    for (const x of eraf) l.push(`- Vervallen of vervangen: ${x}`);
    l.push("");
  }
  for (const [naam, haal] of ENKEL) {
    const o = haal(oud) ?? null;
    const n = haal(nieuw) ?? null;
    if (o === n) continue;
    l.push(`${naam}: ${n ?? "leeg"} (was: ${o ?? "leeg"})`);
  }
  if (!l.length) return null;
  // Met de tijd erbij, zodat een tweede aanvulling op dezelfde dag niet als dubbel wordt overgeslagen.
  return { titel: `Projectstart: aanvulling ${nlDatum(datum)} ${nlTijd(datum)}`, tekst: l.join("\n").trim() + "\n" };
}

// --- Uitvraag-mail (naar de klant) ---

export function uitvraagMail(d, { rapport } = {}) {
  const aanspreek = d.contacten.find((c) => c.aanspreekpunt);
  if (!aanspreek) throw new Error("Geen contact met aanspreekpunt: true in het dossier; de mail heeft een ontvanger nodig.");
  const adres = (c) => (typeof c.mail === "string" && c.mail.trim() ? c.mail.trim() : c.naam);
  const cc = d.contacten.filter((c) => c.beslisser && c !== aanspreek).map(adres);
  const afzender = projectleider(d) ?? "JUICT";
  const l = [`Hoi ${voornaam(aanspreek.naam)},`, ""];

  l.push(`Bedankt voor de kick-off van het project met ${d.klant.weergave}. In deze mail staat wat we hebben afgesproken en wat we van jullie nodig hebben om door te gaan.`, "");

  l.push("**Besluiten.** Dit is de stand van zaken.");
  for (const b of d.besluiten) l.push(`- ${besluitRegel(b)}`);
  l.push("");

  const afspraken = d.afspraken.filter((a) => a.intern === false);
  if (afspraken.length) {
    l.push("**Afspraken.** Dit hebben we met elkaar afgesproken.");
    for (const a of afspraken) l.push(`- ${eindig(a.tekst)}`);
    l.push("");
  }

  l.push("**Wat we van jullie nodig hebben.** Zo houden we de planning haalbaar.");
  for (const a of d.aanleveren) l.push(`- ${aanleverRegel(a)}`);
  l.push("");

  if (d.technischeVragen.length) {
    l.push("**Technische vragen.** Hierop willen we graag een antwoord.");
    for (const v of d.technischeVragen) l.push(`- ${v.vraag} (${v.aan})`);
    l.push("");
  }

  l.push(rapport
    ? `Het inventarisatierapport is een levend document: je ziet er steeds in wat we nog nodig hebben. Je vindt het hier: ${rapport}`
    : "Het inventarisatierapport volgt en is een levend document: je ziet er steeds in wat we nog nodig hebben.", "");

  l.push("Wachtwoorden hoef je niet te sturen, het gaat nu alleen om het overzicht.", "", "Groet,", afzender);
  const uit = { aan: adres(aanspreek), cc, onderwerp: `Opvolging kick-off ${d.klant.weergave}`, tekst: l.join("\n") + "\n" };
  // Vangnet: de mail gaat naar de klant, dus nooit bedragen, em-dash, verboden afkortingen of wachtwoorden.
  const alles = `${uit.onderwerp}\n${uit.tekst}`;
  const fout = (wat) => { throw new Error(`Uitvraag-mail bevat ${wat}; pas het dossier aan.`); };
  if (isBedrag(alles)) fout("een bedrag");
  if (/—/.test(alles)) fout("een em-dash");
  if (/\bBC\b|\bM365\b/.test(alles)) fout("een verboden afkorting (BC of M365)");
  if (/\bMFA\b/.test(alles) && !/multifactor/i.test(alles)) fout("MFA zonder dat multifactor voluit staat");
  if (findSecretText(alles).length) fout("tekst die op een wachtwoord lijkt");
  return uit;
}

// --- CLI ---

const GEBRUIK = [
  "Gebruik:",
  "  teksten.mjs briefing --dossier <pad> [--presentatie <url>] [--rapport <url>] [--plan <pad>]",
  "  teksten.mjs wijzigingen --oud <pad> --nieuw <pad> [--plan <pad>]",
  "  teksten.mjs mail --dossier <pad> [--rapport <url>] [--plan <pad>]",
  "Zonder --plan alleen tonen. Met --plan komt de tekst als notitie in dat plan voor autotask-schrijf.mjs",
  "(het bestand wordt aangemaakt als het er nog niet is). Er wordt nooit iets verstuurd of in Autotask geschreven.",
  "",
].join("\n");

export const MAIL_NOTITIE = "Projectstart: uitvraag-mail";

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

// Voegt een notitie toe aan een plan; een notitie met dezelfde titel wordt vervangen.
export function voegToeAanPlan(plan, notitie) {
  const notities = (plan.notities ?? []).filter((n) => n.titel !== notitie.titel);
  return { notities: [...notities, notitie], bijlagen: plan.bijlagen ?? [] };
}

// Voegt link-bijlagen toe; een bijlage met dezelfde url staat er al en wordt niet verdubbeld.
export function voegLinksToe(plan, links) {
  const bijlagen = [...(plan.bijlagen ?? [])];
  for (const l of links) if (!bijlagen.some((b) => b.url != null && String(b.url).trim() === l.url)) bijlagen.push(l);
  return { ...plan, bijlagen };
}

export function hoofd(argv, deps = {}) {
  const lees = deps.lees ?? ((pad) => readFileSync(pad, "utf8"));
  const bestaat = deps.bestaat ?? existsSync;
  const schrijf = deps.schrijf ?? ((pad, tekst) => writeFileSync(pad, tekst, "utf8"));
  const json = (pad) => JSON.parse(lees(pad));
  const [cmd, ...rest] = argv;
  try {
    let notitie;
    let tonen;
    const links = [];
    if (cmd === "briefing" && optie(rest, "--dossier")) {
      notitie = briefing(json(optie(rest, "--dossier")), { presentatie: optie(rest, "--presentatie"), rapport: optie(rest, "--rapport") });
      tonen = `${notitie.titel}\n\n${notitie.tekst}`;
      const d = json(optie(rest, "--dossier"));
      const pres = optie(rest, "--presentatie"), rap = optie(rest, "--rapport");
      if (pres) links.push({ titel: `Kick-off presentatie ${d.klant.weergave}`, url: pres.trim() });
      if (rap) links.push({ titel: `IT-inventarisatie ${d.klant.autotask}`, url: rap.trim() });
    } else if (cmd === "wijzigingen" && optie(rest, "--oud") && optie(rest, "--nieuw")) {
      notitie = wijzigingen(json(optie(rest, "--oud")), json(optie(rest, "--nieuw")));
      if (!notitie) return { code: 0, uitvoer: "Geen wijzigingen; er komt geen notitie.\n" };
      tonen = `${notitie.titel}\n\n${notitie.tekst}`;
    } else if (cmd === "mail" && optie(rest, "--dossier")) {
      const m = uitvraagMail(json(optie(rest, "--dossier")), { rapport: optie(rest, "--rapport") });
      tonen = [`Aan: ${m.aan}`, `Cc: ${m.cc.join(", ") || "-"}`, `Onderwerp: ${m.onderwerp}`, "", m.tekst].join("\n");
      // In Autotask is ** geen opmaak: de notitie krijgt de kopjes zonder sterretjes.
      notitie = { titel: MAIL_NOTITIE, tekst: tonen.replace(/\*\*/g, "") };
    } else {
      return { code: 1, uitvoer: GEBRUIK };
    }
    const planPad = optie(rest, "--plan");
    if (planPad) {
      const plan = voegLinksToe(voegToeAanPlan(bestaat(planPad) ? json(planPad) : {}, notitie), links);
      schrijf(planPad, JSON.stringify(plan, null, 2) + "\n");
      tonen += `\nToegevoegd aan ${planPad} als notitie "${notitie.titel}".\n`;
      for (const l of links) tonen += `Link-bijlage "${l.titel}" in het plan.\n`;
    }
    return { code: 0, uitvoer: tonen };
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
