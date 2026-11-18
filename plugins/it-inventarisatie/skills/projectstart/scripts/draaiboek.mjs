// Het Easywork-draaiboek (assets/easywork-draaiboek.json): de subtaken onder de 29 taken van het projectsjabloon
// Easywork Basic. Wordt gemaakt met draaiboek-naar-json.mjs (alleen beheerders) en opnieuw gemaakt als het sjabloon
// of het draaiboek verandert.
import { readFileSync } from "node:fs";

export const ROLLEN = ["Engineer", "Projectmanager", "Verkoop/Administratie"];

let geladen = null;
export function draaiboek() {
  geladen ??= JSON.parse(readFileSync(new URL("../assets/easywork-draaiboek.json", import.meta.url), "utf8"));
  return geladen;
}

// Titels vergelijken zonder hoofdletters, accenten en spaties: "Licentieplan maken" = "Licentie plan maken".
export const titelSleutel = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
// Een punt in een taak: de tekst, en voor een kindpunt ook het sub-punt waar het onder hoort.
export const puntSleutel = (p) => `${titelSleutel(p?.onder ?? "")}|${titelSleutel(p?.tekst)}`;

// De titel zoals hij in Autotask staat.
export const autotaskTitel = (t) => t.autotaskTitel ?? t.titel;

export function sjabloonTaak(titel, db = draaiboek()) {
  const s = titelSleutel(titel);
  return db.taken.find((t) => titelSleutel(t.titel) === s || titelSleutel(t.autotaskTitel) === s) ?? null;
}

// Alle punten van een draaiboektaak, plat: eerst het sub-punt, dan zijn kindpunten (met `onder`).
export function draaiboekPunten(taak) {
  const uit = [];
  for (const p of taak?.punten ?? []) {
    uit.push({ tekst: p.tekst, rol: p.rol ?? taak.rol ?? null, toelichting: p.toelichting ?? null });
    for (const k of p.kinderen ?? []) uit.push({ tekst: k.tekst, onder: p.tekst, rol: k.rol ?? p.rol ?? taak.rol ?? null, toelichting: k.toelichting ?? null });
  }
  return uit;
}

// Volgorde van de fases zoals het draaiboek ze noemt.
export const faseVolgorde = (db = draaiboek()) => [...new Set(db.taken.map((t) => t.fase))];

// "Wacht op" uit het draaiboek: "2.2 Project opstart; Hele fase 3: Voorbereidings- en planningsfase".
// Geeft de wbs-nummers van de taken waarop gewacht wordt, of een fout bij een onbekende verwijzing.
export function wachtOpWbs(taak, db = draaiboek()) {
  const fases = faseVolgorde(db);
  const wbs = [];
  const fouten = [];
  for (const deel of String(taak.wachtOp ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
    const taakNr = /^(\d+\.\d+)\b/.exec(deel);
    const faseNr = /^hele\s+fase\s+(\d+)\b/i.exec(deel);
    if (taakNr && db.taken.some((t) => t.wbs === taakNr[1])) wbs.push(taakNr[1]);
    else if (faseNr && fases[Number(faseNr[1]) - 1]) wbs.push(...db.taken.filter((t) => t.fase === fases[Number(faseNr[1]) - 1]).map((t) => t.wbs));
    else fouten.push(`"${autotaskTitel(taak)}" wacht op "${deel}", maar die taak of fase staat niet in het draaiboek`);
  }
  return { wbs: [...new Set(wbs)].filter((w) => w !== taak.wbs), fouten };
}

const alsLijst = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// Logische volgorde van de taken over de fases heen, uit de "Wacht op" van het draaiboek. Een taak buiten het
// sjabloon wacht op de titels in zijn `wachtOp`, of standaard op de sjabloontaken van zijn eigen fase (einde fase).
// Alleen taken met status "nodig" krijgen een stapnummer; wacht een taak op een taak die niet nodig is, dan wacht
// hij op wat die taak zelf nodig had. Fases en datums in Autotask veranderen hierdoor niet.
// Uitkomst: { taken: [{ taak, stap, van, wachtOp: [titels] }] in volgorde, fouten: [tekst] }.
export function volgorde(taken, db = draaiboek()) {
  const lijst = (taken ?? []).map((t, i) => [t, i]).filter(([t]) => t && typeof t === "object" && typeof t.titel === "string" && t.titel.trim());
  const fases = faseVolgorde(db);
  const fouten = [];
  const knoop = lijst.map(([t, i]) => {
    const s = t.sjabloon === true ? sjabloonTaak(t.titel, db) : null;
    const faseIndex = fases.findIndex((f) => titelSleutel(f) === titelSleutel(s?.fase ?? t.fase));
    return { t, i, s, sorteer: [faseIndex < 0 ? fases.length : faseIndex, s ? db.taken.indexOf(s) : db.taken.length + i], na: new Set() };
  });
  const opWbs = new Map(knoop.filter((k) => k.s).map((k) => [k.s.wbs, k]));
  const opTitel = (titel) => knoop.find((k) => titelSleutel(k.t.titel) === titelSleutel(titel) || (k.s && sjabloonTaak(titel, db) === k.s));
  for (const k of knoop) {
    if (k.s) {
      const w = wachtOpWbs(k.s, db);
      fouten.push(...w.fouten);
      for (const nr of w.wbs) if (opWbs.has(nr)) k.na.add(opWbs.get(nr));
    } else if (alsLijst(k.t.wachtOp).length) {
      for (const titel of alsLijst(k.t.wachtOp)) {
        const doel = typeof titel === "string" ? opTitel(titel) : null;
        if (!doel) fouten.push(`taken[${k.i}].wachtOp: "${titel}" is geen taak in het dossier`);
        else if (doel !== k) k.na.add(doel);
      }
    } else {
      for (const ander of knoop) if (ander.s && ander.sorteer[0] === k.sorteer[0]) k.na.add(ander);
    }
  }
  // Kahn, bij gelijke stand op fase en dan op de volgorde in het draaiboek (eigen taken achteraan in hun fase).
  const rest = new Set(knoop);
  const klaar = [];
  while (rest.size) {
    const vrij = [...rest].filter((k) => [...k.na].every((n) => !rest.has(n)));
    if (!vrij.length) {
      fouten.push(`taken: de volgorde loopt rond (wacht op elkaar): ${[...rest].map((k) => k.t.titel).join("; ")}`);
      klaar.push(...[...rest].sort((a, b) => a.sorteer[0] - b.sorteer[0] || a.sorteer[1] - b.sorteer[1]));
      break;
    }
    vrij.sort((a, b) => a.sorteer[0] - b.sorteer[0] || a.sorteer[1] - b.sorteer[1]);
    klaar.push(vrij[0]);
    rest.delete(vrij[0]);
  }
  const nodig = (k) => k.t.status !== "nvt";
  // Directe voorgangers die nodig zijn; een taak die niet nodig is, wordt vervangen door zijn eigen voorgangers.
  const voorgangers = (k, gezien = new Set()) => {
    const uit = [];
    for (const n of k.na) {
      if (gezien.has(n)) continue;
      gezien.add(n);
      if (nodig(n)) uit.push(n);
      else uit.push(...voorgangers(n, gezien));
    }
    return uit;
  };
  const m = klaar.filter(nodig).length;
  let stap = 0;
  const positie = new Map(klaar.map((k, i) => [k, i]));
  return {
    taken: klaar.map((k) => ({
      taak: k.t,
      stap: nodig(k) ? ++stap : null,
      van: m,
      wachtOp: [...new Set(voorgangers(k))].sort((a, b) => positie.get(a) - positie.get(b)).map((n) => n.t.titel),
    })),
    fouten: [...new Set(fouten)],
  };
}
