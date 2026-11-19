#!/usr/bin/env node
// Controle per taak en per checklistpunt, zodat er geen belangrijk punt wegvalt.
//
//  vooraf   Voor het schrijven: het dossier is geldig (elk draaiboekpunt staat erin met een status), alles uit de
//           offerte, afspraken, besluiten, aan te leveren zaken, technische vragen en meerwerk heeft een taak of een
//           reden, en geen bron verwijst naar een taak die n.v.t. is. Maakt een controlerapport per taak om goed te
//           keuren. Schrijft nooit naar Autotask.
//  achteraf Na het schrijven: per taak de fase en de omschrijving (API) en elk checklistpunt met vinkje en
//           inspringing vergelijken met wat er in Autotask staat. De checklist staat alleen op het taakscherm (de API
//           kan taak-checklists niet lezen): browserscript maakt een script dat dat in de ingelogde Autotask-pagina
//           doet, of geef de taakpagina's mee als <map>/<taskId>.html.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { valideerDossier } from "./dossier.mjs";
import { titelSleutel } from "./draaiboek.mjs";

const GEBRUIK = [
  "Gebruik:",
  "  controle.mjs vooraf --dossier <pad> [--rapport <pad.md>]",
  "  controle.mjs achteraf --verwacht <pad> --stand <pad> [--checklists <map met <taskId>.html of .txt>]",
  "  controle.mjs browserscript --verwacht <pad> --uit <pad.js>   checklistcontrole in de ingelogde Autotask-pagina",
  "Er wordt niets in Autotask geschreven.",
  "",
].join("\n");

const isTekst = (v) => typeof v === "string" && v.trim() !== "";
const lijst = (v) => (Array.isArray(v) ? v : []);
// Vergelijken zonder hoofdletters, accenten, spaties en leestekens aan het eind.
export const sleutel = (s) => titelSleutel(String(s ?? "").replace(/[.!:;,\s]+$/, ""));

// Alles wat in het project terug moet komen: per bron in het dossier de tekst die een taak of een reden nodig heeft.
export function verplichtePunten(d) {
  const uit = [];
  const voeg = (soort, tekst, bron) => { if (isTekst(tekst)) uit.push({ soort, tekst: tekst.trim(), bron: bron ?? null }); };
  for (const s of lijst(d.scope?.inbegrepen)) voeg("scope", s, "Offerte (scope)");
  for (const a of lijst(d.afspraken)) voeg("afspraak", a?.tekst, a?.bron);
  for (const b of lijst(d.besluiten)) voeg("besluit", b?.vraag, b?.bron);
  for (const a of lijst(d.aanleveren)) voeg("aanleveren", a?.wat, null);
  for (const v of lijst(d.technischeVragen)) voeg("technische vraag", v?.vraag, v?.bron);
  for (const m of lijst(d.meerwerk)) voeg("meerwerk", m?.wat, m?.bron);
  return uit;
}

const telStatus = (punten) => {
  const t = { open: 0, gedaan: 0, nvt: 0, extra: 0 };
  for (const p of lijst(punten)) if (p && p.status in t) t[p.status] += 1;
  return t;
};

// Controle voor het schrijven. Uitkomst: { fouten, waarschuwingen, tegenstrijdig, dekking, perTaak }.
export function vooraf(d) {
  const fouten = [...valideerDossier(d)];
  const waarschuwingen = [];
  const taken = lijst(d.taken);
  const taakOp = (titel) => taken.find((t) => isTekst(t?.titel) && sleutel(t.titel) === sleutel(titel));

  // Dekking: elke regel uit de offerte en elk punt uit afspraken, besluiten en dergelijke heeft een taak of een reden.
  const dekking = lijst(d.dekking);
  if (taken.length && d.dekking === undefined) fouten.push("dekking: ontbreekt; zet per offerteregel en per afspraak, besluit, aan te leveren zaak, technische vraag en meerwerk de taak waar het terugkomt (of null met reden)");
  dekking.forEach((x, i) => {
    const pad = `dekking[${i}]`;
    if (!x || typeof x !== "object") return fouten.push(`${pad}: object verplicht`);
    if (!isTekst(x.tekst)) fouten.push(`${pad}.tekst: verplicht`);
    if (!isTekst(x.bron)) fouten.push(`${pad}.bron: verplicht (offerte, mail, notitie of document met datum)`);
    if (x.taak === null || x.taak === undefined) {
      if (!isTekst(x.reden)) fouten.push(`${pad}: geen taak; zet een taak of een reden waarom er geen taak nodig is`);
      return;
    }
    const taak = taakOp(x.taak);
    if (!taak) return fouten.push(`${pad}.taak: "${x.taak}" is geen taak in het dossier`);
    if (taak.status === "nvt") fouten.push(`${pad}: "${x.tekst}" (${x.bron}) hoort bij "${taak.titel}", maar die taak staat op n.v.t. (${taak.reden ?? "geen reden"})`);
  });
  if (d.dekking !== undefined) {
    for (const v of verplichtePunten(d)) {
      if (!dekking.some((x) => sleutel(x?.tekst) === sleutel(v.tekst))) fouten.push(`dekking: ${v.soort} "${v.tekst}" heeft geen taak of reden`);
    }
  }

  // Per taak: statussen, en waarschuwingen voor wat aandacht vraagt.
  const perTaak = taken.filter((t) => t && isTekst(t.titel)).map((t) => {
    const tel = telStatus(t.punten);
    const bronnen = dekking.filter((x) => isTekst(x?.taak) && sleutel(x.taak) === sleutel(t.titel));
    if (t.status === "nodig" && lijst(t.punten).length && tel.open + tel.extra + tel.gedaan === 0) waarschuwingen.push(`"${t.titel}": nodig, maar alle punten zijn n.v.t.; zet de taak op n.v.t. of controleer`);
    if (t.status === "nodig" && !lijst(t.punten).length && t.sjabloon === false) waarschuwingen.push(`"${t.titel}": nodig, maar zonder punten`);
    lijst(t.punten).forEach((p) => {
      if (p?.status === "gedaan" && !isTekst(p.bron)) waarschuwingen.push(`"${t.titel}": "${p.tekst}" staat op gedaan zonder bron`);
    });
    return { titel: t.titel, fase: t.fase, status: t.status, reden: t.reden ?? null, tel, punten: lijst(t.punten), bronnen };
  });
  const tegenstrijdig = taken.flatMap((t) => lijst(t?.punten).filter((p) => p?.status === "extra" && /^controleren:/i.test(p.tekst ?? "")).map((p) => ({ taak: t.titel, tekst: p.tekst, bron: p.bron })));
  return { fouten, waarschuwingen, tegenstrijdig, dekking, perTaak };
}

const MARK = { open: "[ ]", gedaan: "[x]", nvt: "n.v.t.", extra: "+" };
const puntRegel = (p) => {
  const in_ = p.onder ? "    " : "";
  const bij = p.status === "nvt" ? `: ${p.reden}` : p.bron && !/\(bron:/.test(p.tekst) ? ` (bron: ${p.bron})` : "";
  return `${in_}- ${MARK[p.status] ?? "?"} ${p.tekst}${bij}`;
};

// Het controlerapport in Markdown: eerst wat moet worden opgelost, dan dekking, dan per taak elk punt.
export function rapport(d, u) {
  const r = [];
  r.push(`# Controlerapport ${d.klant?.weergave ?? ""} (project ${d.projectId ?? "?"})`.replace(/\s+\(/, " ("), "");
  r.push(`Uitkomst: ${u.fouten.length} fouten, ${u.waarschuwingen.length} waarschuwingen, ${u.tegenstrijdig.length} tegenstrijdigheden. ${u.fouten.length ? "Niet schrijven tot de fouten zijn opgelost." : "Klaar om ter goedkeuring voor te leggen."}`, "");
  if (u.fouten.length) r.push("## Fouten", "", ...u.fouten.map((f) => `- ${f}`), "");
  if (u.waarschuwingen.length) r.push("## Waarschuwingen", "", ...u.waarschuwingen.map((w) => `- ${w}`), "");
  if (u.tegenstrijdig.length) r.push("## Tegenstrijdigheden", "", ...u.tegenstrijdig.map((t) => `- ${t.taak}: ${t.tekst}${/\(bron:/.test(t.tekst) ? "" : ` (bron: ${t.bron})`}`), "");
  r.push("## Dekking van offerte en afspraken", "", "| Bron | Wat | Taak |", "|---|---|---|");
  for (const x of u.dekking) r.push(`| ${x.bron ?? ""} | ${String(x.tekst ?? "").replace(/\|/g, "/")} | ${x.taak ?? `geen: ${x.reden ?? ""}`} |`);
  r.push("", "## Per taak", "");
  for (const t of u.perTaak) {
    const kop = t.status === "nvt" ? `n.v.t.: ${t.reden}` : `${t.tel.open} open, ${t.tel.gedaan} gedaan, ${t.tel.nvt} n.v.t., ${t.tel.extra} extra`;
    r.push(`### ${t.titel}`, `Fase: ${t.fase}. ${kop}.`);
    if (t.bronnen.length) r.push(`Komt uit: ${t.bronnen.map((x) => `${x.tekst} (${x.bron})`).join("; ")}.`);
    r.push("", ...(t.punten.length ? t.punten.map(puntRegel) : ["- geen punten"]), "");
  }
  return r.join("\n");
}

// --- Achteraf ---
// leesChecklist en vergelijkChecklist staan op zichzelf (geen imports of hulpfuncties van buiten), zodat
// browserscript() ze ook in de Autotask-pagina kan draaien.

// De checklist van een taakpagina, uit de HTML (klassen ChecklistItem, Completed, Indented) of uit de paginatekst.
// Uitkomst: { punten: [{ tekst, gedaan, ingesprongen }], teller }; ingesprongen is null als het onbekend is (tekst).
export function leesChecklist(pagina) {
  const bron = String(pagina ?? "");
  if (/class="ChecklistItem[\s"]/.test(bron)) {
    // Autotask codeert tekens als &#x20AC; (euro), &#x2B; (plus) en &#xEB; (e met trema).
    const ont = (x) => x.replace(/<[^>]+>/g, "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
    const punten = [];
    for (const deel of bron.split(/<div class="ChecklistItem(?=[\s"])/).slice(1)) {
      const klassen = (/^([^"]*)"/.exec(deel) ?? ["", ""])[1].split(/\s+/);
      const titel = /<span class="Title">([\s\S]*?)<\/span>/.exec(deel);
      punten.push({ tekst: ont(titel ? titel[1] : ""), gedaan: klassen.includes("Completed"), ingesprongen: klassen.includes("Indented") });
    }
    return { punten, teller: null };
  }
  const regels = bron.replace(/\r/g, "").split("\n").map((r) => r.trim());
  const start = regels.findIndex((r) => r === "Checklist");
  if (start < 0) return { punten: [], teller: null };
  let i = start + 1;
  let teller = null;
  const m = /^\((\d+)\/(\d+)\)$/.exec(regels[i] ?? "");
  if (m) { teller = { gedaan: Number(m[1]), totaal: Number(m[2]) }; i += 1; }
  const datumDoor = /\s*\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} by .+$/;
  const punten = [];
  for (; i < regels.length; i++) {
    const r = regels[i];
    if (!r || /^(Hide|Show) Completed Items$/.test(r)) continue;
    if (/^(Prompt to automate|Activity$|All checklist items have been completed)/.test(r)) break;
    punten.push({ tekst: r.replace(datumDoor, "").replace(/!$/, "").trim(), gedaan: datumDoor.test(r), ingesprongen: null });
  }
  return { punten, teller };
}

// Eén taak: elk verwacht checklistpunt aanwezig, met het juiste vinkje en (als bekend) de juiste inspringing.
// Leest de pagina zelf met leesChecklist (in de browser staat die als losse functie ernaast).
export function vergelijkChecklist(titel, verwacht, pagina) {
  const sleutel = (s) => String(s ?? "").replace(/[.!:;,\s]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
  const fouten = [];
  const waarschuwingen = [];
  const { punten, teller } = leesChecklist(pagina);
  const over = [...punten];
  for (const p of verwacht) {
    const j = over.findIndex((q) => sleutel(q.tekst) === sleutel(p.tekst));
    if (j < 0) { fouten.push(`"${titel}": checklistpunt ontbreekt: "${p.tekst}"`); continue; }
    const q = over[j];
    if (Boolean(q.gedaan) !== Boolean(p.gedaan)) fouten.push(`"${titel}": "${p.tekst}" is ${q.gedaan ? "afgevinkt" : "niet afgevinkt"}, verwacht ${p.gedaan ? "afgevinkt" : "open"}`);
    if (typeof p.ingesprongen === "boolean" && typeof q.ingesprongen === "boolean" && p.ingesprongen !== q.ingesprongen) fouten.push(`"${titel}": "${p.tekst}" is ${q.ingesprongen ? "ingesprongen" : "niet ingesprongen"}, verwacht ${p.ingesprongen ? "ingesprongen" : "niet ingesprongen"}`);
    over.splice(j, 1);
  }
  for (const q of over) waarschuwingen.push(`"${titel}": punt in Autotask dat niet verwacht is: "${q.tekst}"`);
  if (teller && teller.totaal !== punten.length) waarschuwingen.push(`"${titel}": teller ${teller.gedaan}/${teller.totaal} maar ${punten.length} punten gelezen (lijst ingeklapt of niet volledig geladen?)`);
  return { fouten, waarschuwingen, punten: punten.length };
}

// verwacht: [{ titel, taskId?, fase?, omschrijving?, checklist?: [{ tekst, gedaan, ingesprongen? }] }]
// stand: { fases: [{ id, title }], taken: [{ id, title, phaseID, description }] } (uit de API)
// checklists: { [taskId]: HTML of tekst van de taakpagina }; zonder checklists alleen fase en omschrijving.
export function achteraf(verwacht, stand, checklists = null) {
  const fouten = [];
  const waarschuwingen = [];
  const perTaak = [];
  const faseTitel = new Map(lijst(stand.fases).map((f) => [f.id, f.title]));
  for (const v of lijst(verwacht)) {
    const t = lijst(stand.taken).find((x) => sleutel(x.title) === sleutel(v.titel));
    if (!t) { fouten.push(`"${v.titel}": taak staat niet in Autotask`); continue; }
    const uit = { titel: v.titel, id: t.id, punten: 0 };
    if (isTekst(v.fase) && sleutel(faseTitel.get(t.phaseID)) !== sleutel(v.fase)) fouten.push(`"${v.titel}": fase is "${faseTitel.get(t.phaseID) ?? "onbekend"}", verwacht "${v.fase}"`);
    if (typeof v.omschrijving === "string" && String(t.description ?? "").replace(/\r/g, "") !== v.omschrijving) fouten.push(`"${v.titel}": omschrijving wijkt af`);
    if (checklists && Array.isArray(v.checklist)) {
      if (checklists[t.id] === undefined) fouten.push(`"${v.titel}": checklist niet gelezen (geen taakpagina)`);
      else {
        const c = vergelijkChecklist(v.titel, v.checklist, checklists[t.id]);
        fouten.push(...c.fouten);
        waarschuwingen.push(...c.waarschuwingen);
        uit.punten = c.punten;
      }
    }
    perTaak.push(uit);
  }
  return { fouten, waarschuwingen, perTaak };
}

// Script voor de ingelogde Autotask-pagina (zelfde domein): haalt per taak de taakpagina op en vergelijkt de
// checklist. Het leest alleen en geeft een samenvatting terug; de taken in verwacht hebben een taskId nodig.
export function browserscript(verwacht) {
  const taken = lijst(verwacht).filter((v) => Number.isInteger(v.taskId) && Array.isArray(v.checklist)).map((v) => ({ titel: v.titel, taskId: v.taskId, checklist: v.checklist }));
  return [
    "(async () => {",
    `const taken = ${JSON.stringify(taken)};`,
    `const leesChecklist = ${leesChecklist.toString()};`,
    `const vergelijkChecklist = ${vergelijkChecklist.toString()};`,
    "const fouten = []; const waarschuwingen = []; let punten = 0;",
    "for (const t of taken) {",
    "  const r = await fetch('/Mvc/Projects/TaskDetail.mvc?taskId=' + t.taskId, { credentials: 'same-origin' });",
    "  const html = await r.text();",
    "  if (!r.ok || /Authenticat/i.test(r.url) || !/ChecklistItem|Checklist/.test(html)) { fouten.push('\"' + t.titel + '\": taakpagina niet geladen (ingelogd?)'); continue; }",
    "  const c = vergelijkChecklist(t.titel, t.checklist, html);",
    "  fouten.push(...c.fouten); waarschuwingen.push(...c.waarschuwingen); punten += c.punten;",
    "}",
    "return { taken: taken.length, punten, fouten, waarschuwingen };",
    "})()",
  ].join("\n");
}

// --- CLI ---

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export function hoofd(argv, deps = {}) {
  const lees = deps.lees ?? ((pad) => readFileSync(pad, "utf8"));
  const schrijf = deps.schrijf ?? ((pad, tekst) => writeFileSync(pad, tekst, "utf8"));
  const json = (pad) => JSON.parse(lees(pad));
  try {
    if (argv[0] === "vooraf" && optie(argv, "--dossier")) {
      const d = json(optie(argv, "--dossier"));
      const u = vooraf(d);
      const md = rapport(d, u);
      if (optie(argv, "--rapport")) schrijf(optie(argv, "--rapport"), md);
      const kort = [`Fouten: ${u.fouten.length}`, ...u.fouten.map((f) => `  ${f}`), `Waarschuwingen: ${u.waarschuwingen.length}`, ...u.waarschuwingen.map((w) => `  ${w}`), `Tegenstrijdigheden: ${u.tegenstrijdig.length}`, ...u.tegenstrijdig.map((t) => `  ${t.taak}: ${t.tekst}`)];
      return { code: u.fouten.length ? 1 : 0, uitvoer: kort.join("\n") + "\n" };
    }
    if (argv[0] === "achteraf" && optie(argv, "--verwacht") && optie(argv, "--stand")) {
      const map = optie(argv, "--checklists");
      const checklists = map ? {} : null;
      const bestaat = deps.bestaat ?? existsSync;
      const lijstMap = deps.lijstMap ?? readdirSync;
      if (map && bestaat(map)) for (const f of lijstMap(map)) { const m = /^(\d+)\.(txt|html)$/.exec(f); if (m) checklists[Number(m[1])] = lees(join(map, f)); }
      const u = achteraf(json(optie(argv, "--verwacht")), json(optie(argv, "--stand")), checklists);
      const punten = u.perTaak.reduce((n, t) => n + t.punten, 0);
      const kort = [`Taken gecontroleerd: ${u.perTaak.length}, checklistpunten gelezen: ${punten}`, `Fouten: ${u.fouten.length}`, ...u.fouten.map((f) => `  ${f}`), `Waarschuwingen: ${u.waarschuwingen.length}`, ...u.waarschuwingen.map((w) => `  ${w}`)];
      return { code: u.fouten.length ? 1 : 0, uitvoer: kort.join("\n") + "\n" };
    }
    if (argv[0] === "browserscript" && optie(argv, "--verwacht") && optie(argv, "--uit")) {
      const v = json(optie(argv, "--verwacht"));
      schrijf(optie(argv, "--uit"), browserscript(v));
      const n = lijst(v).filter((x) => Number.isInteger(x.taskId) && Array.isArray(x.checklist)).length;
      return { code: 0, uitvoer: `Browserscript voor ${n} taken geschreven naar ${optie(argv, "--uit")}. Draai het in de ingelogde Autotask-pagina.\n` };
    }
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
  return { code: 1, uitvoer: GEBRUIK };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { code, uitvoer } = hoofd(process.argv.slice(2));
  process.stdout.write(uitvoer);
  process.exitCode = code;
}
