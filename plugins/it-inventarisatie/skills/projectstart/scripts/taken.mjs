#!/usr/bin/env node
// Technische taken op basis van het Easywork-draaiboek. Het project komt altijd uit het sjabloon Easywork Basic;
// de skill vult per sjabloontaak de subtaken uit het draaiboek in (open, gedaan, niet van toepassing) en voegt
// projectspecifieke punten toe met een bron. `zaai` zet de volledige structuur in het dossier, `plan` zet de taken
// in plan.json voor autotask-schrijf.mjs. Schrijft nooit naar Autotask.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { valideerDossier } from "./dossier.mjs";
import { ROLLEN, autotaskTitel, draaiboek, draaiboekPunten, puntSleutel, sjabloonTaak, titelSleutel, volgorde } from "./draaiboek.mjs";

export const MAX_OMSCHRIJVING = 8000; // Task.description, zone 19
export const SUBTAKEN_NOTITIE = "Projectstart: subtaken";

const GEBRUIK = [
  "Gebruik:",
  "  taken.mjs zaai --dossier <pad>             zet alle sjabloontaken met hun punten (open) in het dossier",
  "  taken.mjs plan --dossier <pad> --plan <pad> zet de taken in plan.json voor autotask-schrijf.mjs",
  "  taken.mjs toon --dossier <pad>             toont de taken in volgorde met de tekst per taak",
  "Er wordt niets in Autotask geschreven.",
  "",
].join("\n");

export const urenTekst = (u) => (u === null || u === undefined ? "uren nog te bepalen" : `${String(u).replace(".", ",")} uur`);

// --- Zaaien ---

// De volledige structuur van het sjabloon: alle 29 taken met alle punten "open". Wat er al in het dossier staat
// blijft staan (status, reden, extra punten, eigen taken); alleen ontbrekende sjabloontaken en punten komen erbij.
export function vanDraaiboek(dossierTaken = [], db = draaiboek()) {
  const bestaand = [...(dossierTaken ?? [])];
  const uit = [];
  for (const s of db.taken) {
    const i = bestaand.findIndex((t) => t?.sjabloon === true && sjabloonTaak(t.titel, db) === s);
    const oud = i >= 0 ? bestaand.splice(i, 1)[0] : null;
    const punten = [...(oud?.punten ?? [])];
    const aanwezig = new Set(punten.filter((p) => p?.status !== "extra").map(puntSleutel));
    for (const p of draaiboekPunten(s)) {
      if (aanwezig.has(puntSleutel(p))) continue;
      punten.push({ tekst: p.tekst, ...(p.onder ? { onder: p.onder } : {}), status: "open" });
    }
    uit.push(oud ? { ...oud, punten } : { titel: autotaskTitel(s), sjabloon: true, fase: s.fase, status: "nodig", uren: null, punten });
  }
  return [...uit, ...bestaand];
}

// --- Tekst in Autotask ---

const MARKER = { open: "[ ]", gedaan: "[x]" };
const rolVan = (p, taakRol) => (ROLLEN.includes(p.rol) ? p.rol : ROLLEN.includes(taakRol) ? taakRol : "Engineer");

function puntRegel(p, inspring) {
  if (p.status === "extra") return `${inspring}+ ${p.tekst} (bron: ${p.bron})`;
  if (p.status === "nvt") return `${inspring}${p.tekst}, n.v.t.: ${p.reden}`;
  return `${inspring}${MARKER[p.status] ?? "[ ]"} ${p.tekst}`;
}

// "Wacht op" kort: zijn alle taken van een fase nodig, dan "alle taken van <fase>".
function wachtOpTekst(titels, fasePerTitel, takenPerFase) {
  if (!titels.length) return "geen andere taak";
  const rest = [...titels];
  const delen = [];
  for (const [fase, alle] of takenPerFase) {
    if (alle.length > 1 && alle.every((t) => rest.includes(t))) {
      delen.push(`alle taken van ${fase}`);
      for (const t of alle) rest.splice(rest.indexOf(t), 1);
    }
  }
  return [...delen, ...rest].join("; ");
}

// De tekst van één taak: stap en wacht op, de uitleg van de markeringen, en de punten per rol genummerd.
export function taakTekst(taak, { stap = null, van = null, wachtOp = "geen andere taak", db = draaiboek() } = {}) {
  const s = taak.sjabloon === true ? sjabloonTaak(taak.titel, db) : null;
  const meta = new Map(draaiboekPunten(s).map((p) => [puntSleutel(p), p]));
  const regels = [];
  regels.push(stap ? `Stap ${stap} van ${van}. Wacht op: ${wachtOp}` : `Wacht op: ${wachtOp}`);
  regels.push(s
    ? "Subtaken volgens het Easywork-draaiboek, bijgewerkt door projectstart. [x] gedaan, [ ] open, + extra voor dit project."
    : `Taak voor dit project buiten het sjabloon (bron: ${taak.bron}). [x] gedaan, [ ] open, + extra.`);
  if (typeof taak.uren === "number") regels.push(`Uren volgens de offerte: ${urenTekst(taak.uren)}.`);
  const punten = (taak.punten ?? []).map((p) => ({ ...p, rol: rolVan({ rol: p.rol ?? meta.get(puntSleutel(p))?.rol }, s?.rol), toelichting: p.status === "extra" ? null : meta.get(puntSleutel(p))?.toelichting ?? null }));
  if (!punten.length) regels.push("", "Geen subtaken in het draaiboek.");
  for (const rol of ROLLEN) {
    const vanRol = punten.filter((p) => p.rol === rol);
    if (!vanRol.length) continue;
    regels.push("", rol);
    let n = 0;
    const subNummer = new Map();
    for (const p of vanRol) {
      // Een kindpunt staat onder zijn sub-punt als dat bij dezelfde rol hoort, anders los met "onder: ...".
      const ouder = p.onder && p.status !== "extra" ? vanRol.find((q) => !q.onder && titelSleutel(q.tekst) === titelSleutel(p.onder) && q.status !== "extra") : null;
      let inspring = "   ";
      if (ouder && subNummer.has(ouder)) {
        const nummer = subNummer.get(ouder);
        nummer.kind += 1;
        regels.push(puntRegel(p, `   ${nummer.n}.${nummer.kind} `));
        inspring = "       ";
      } else {
        n += 1;
        if (!p.onder) subNummer.set(p, { n, kind: 0 });
        const tekst = p.onder && !ouder && p.status !== "extra" ? { ...p, tekst: `${p.tekst} (onder: ${p.onder})` } : p;
        regels.push(puntRegel(tekst, `${n}. `));
      }
      if (p.toelichting) regels.push(`${inspring}Toelichting: ${p.toelichting}`);
    }
  }
  return regels.join("\n");
}

// Per rol het aantal punten en hoeveel daarvan nog open zijn (open of extra), voor PVA en briefing.
export function puntenPerRol(taak, db = draaiboek()) {
  const s = taak.sjabloon === true ? sjabloonTaak(taak.titel, db) : null;
  const meta = new Map(draaiboekPunten(s).map((p) => [puntSleutel(p), p]));
  const uit = Object.fromEntries(ROLLEN.map((r) => [r, { totaal: 0, open: 0 }]));
  for (const p of taak.punten ?? []) {
    const rol = rolVan({ rol: p.rol ?? meta.get(puntSleutel(p))?.rol }, s?.rol);
    uit[rol].totaal += 1;
    if (p.status === "open" || p.status === "extra") uit[rol].open += 1;
  }
  return uit;
}

// Taken in logische volgorde met stap en wacht op, zonder te valideren (voor PVA en briefing).
export function takenInVolgorde(taken, db = draaiboek()) {
  return volgorde(taken ?? [], db).taken;
}

// Past de tekst niet in de omschrijving (8000 tekens), dan een ingekorte omschrijving en de volledige tekst als notitie.
export function voorAutotask(tekst) {
  if (tekst.length <= MAX_OMSCHRIJVING) return { omschrijving: tekst, notitie: null };
  const staart = `\n... zie notitie ${SUBTAKEN_NOTITIE} voor de volledige lijst.`;
  let kort = tekst.slice(0, MAX_OMSCHRIJVING - staart.length);
  const regel = kort.lastIndexOf("\n");
  if (regel > 0) kort = kort.slice(0, regel);
  return { omschrijving: kort.trimEnd() + staart, notitie: tekst };
}

// --- Plan ---

const telOpen = (t) => (t.punten ?? []).filter((p) => p.status === "open" || p.status === "extra").length;

// De taken in logische volgorde, met de tekst voor Autotask.
export function takenVoorPlan(d, db = draaiboek()) {
  const fouten = valideerDossier(d);
  if (fouten.length) throw new Error(`Dossier is niet geldig:\n${fouten.join("\n")}`);
  const v = volgorde(d.taken ?? [], db);
  const nodig = v.taken.filter((x) => x.stap);
  const fasePerTitel = new Map(nodig.map((x) => [x.taak.titel, x.taak.fase]));
  const takenPerFase = new Map();
  for (const x of nodig) takenPerFase.set(x.taak.fase, [...(takenPerFase.get(x.taak.fase) ?? []), x.taak.titel]);
  return v.taken.map(({ taak, stap, van, wachtOp }) => ({
    titel: taak.titel.trim(),
    sjabloon: taak.sjabloon === true,
    fase: taak.fase.trim(),
    status: taak.status,
    ...(taak.status === "nvt" ? { reden: taak.reden } : {}),
    uren: typeof taak.uren === "number" ? taak.uren : null,
    ...(taak.sjabloon === true ? {} : { bron: taak.bron }),
    stap,
    punten: (taak.punten ?? []).length,
    open: telOpen(taak),
    omschrijving: taakTekst(taak, { stap, van, wachtOp: wachtOpTekst(wachtOp, fasePerTitel, takenPerFase), db }),
  }));
}

// Het dossier is de bron: de taken in het plan worden in zijn geheel vervangen.
export function voegTakenToe(plan, taken) {
  return { ...plan, notities: plan.notities ?? [], bijlagen: plan.bijlagen ?? [], taken };
}

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

const regelVoor = (t) => `${t.stap ? `${t.stap}. ` : "-  "}${t.titel} (${t.fase}${t.status === "nvt" ? `, n.v.t.: ${t.reden}` : `, ${t.punten} punten, ${t.open} open`}${t.sjabloon ? "" : ", buiten het sjabloon"})`;

export function hoofd(argv, deps = {}) {
  const lees = deps.lees ?? ((pad) => readFileSync(pad, "utf8"));
  const bestaat = deps.bestaat ?? existsSync;
  const schrijf = deps.schrijf ?? ((pad, tekst) => writeFileSync(pad, tekst, "utf8"));
  const db = deps.draaiboek ?? draaiboek();
  const opdracht = ["zaai", "plan", "toon"].includes(argv[0]) ? argv[0] : optie(argv, "--plan") ? "plan" : "toon";
  const dossierPad = optie(argv, "--dossier");
  if (!dossierPad) return { code: 1, uitvoer: GEBRUIK };
  let d;
  try {
    d = JSON.parse(lees(dossierPad));
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }

  if (opdracht === "zaai") {
    const voor = d.taken ?? [];
    const na = vanDraaiboek(voor, db);
    const puntenVoor = voor.reduce((n, t) => n + (t?.punten?.length ?? 0), 0);
    const puntenNa = na.reduce((n, t) => n + (t?.punten?.length ?? 0), 0);
    if (voor.length && na.length === voor.length && puntenNa === puntenVoor) {
      return { code: 0, uitvoer: "De taken staan al in het dossier en missen niets uit het draaiboek; niets gewijzigd.\n" };
    }
    try {
      schrijf(dossierPad, JSON.stringify({ ...d, taken: na }, null, 2) + "\n");
    } catch (e) {
      return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
    }
    return {
      code: 0,
      uitvoer: `${na.length - voor.length} sjabloontaken en ${puntenNa - puntenVoor} punten uit het draaiboek (${db.datum ?? "zonder datum"}) in ${dossierPad} gezet, alle punten open.\n`
        + "Zet nu per punt gedaan of nvt met reden, voeg extra punten toe met een bron, en draai dossier.mjs controleer.\n",
    };
  }

  let taken;
  try {
    taken = takenVoorPlan(d, db);
  } catch (e) {
    return { code: /niet geldig/.test(e.message) ? 1 : 2, uitvoer: `${e.message}\n` };
  }
  const nodig = taken.filter((t) => t.stap).length;
  const regels = [`${taken.length} taken, ${nodig} nodig, in logische volgorde:`, ...taken.map(regelVoor)];
  if (opdracht === "toon") {
    regels.push("", ...taken.filter((t) => t.stap).flatMap((t) => [`${t.titel}:`, t.omschrijving, ""]));
    return { code: 0, uitvoer: regels.join("\n").trimEnd() + "\n" };
  }
  const planPad = optie(argv, "--plan");
  if (!planPad) return { code: 1, uitvoer: GEBRUIK };
  try {
    const plan = voegTakenToe(bestaat(planPad) ? JSON.parse(lees(planPad)) : {}, taken);
    schrijf(planPad, JSON.stringify(plan, null, 2) + "\n");
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
  regels.push("", `Toegevoegd aan ${planPad}. Zet ze op het project met autotask-schrijf.mjs (eerst de voorvertoning).`);
  return { code: 0, uitvoer: regels.join("\n") + "\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
