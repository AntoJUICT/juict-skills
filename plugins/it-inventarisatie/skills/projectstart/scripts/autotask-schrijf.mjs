#!/usr/bin/env node
// Schrijfacties naar het Autotask-project: notities, bijlagen en technische taken (spec 5.7).
// Zonder --toepassen gebeurt er geen enkele POST of PATCH. Een tweede run maakt niets dubbel:
// notities worden herkend op titel, bijlagen op fullPath (bestandsnaam), taken op titel binnen het project.
// Sjabloontaken (Easywork Basic) staan al in het project: een lege omschrijving wordt gevuld met de subtaken, een
// gevulde omschrijving nooit overschreven (dan een notitie), een taak die niet nodig is wordt gesloten met reden en
// een afgeronde taak (status 5) blijft ongemoeid. Alleen taken buiten het sjabloon worden aangemaakt.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { haalCredentials, maakAt, normaliseerTitel } from "../../it-inventarisatie/scripts/autotask-project.mjs";
import { findSecretText } from "../../it-inventarisatie/scripts/geheimen.mjs";
import { MAX_OMSCHRIJVING, SUBTAKEN_NOTITIE, voorAutotask } from "./taken.mjs";

const GEBRUIK = [
  "Gebruik:",
  "  autotask-schrijf.mjs --project <id> --plan <pad> [--toepassen]",
  "Het plan is JSON: { notities: [{titel, tekst}], bijlagen: [{titel, bestandsnaam, pad} of {titel, url}],",
  "  taken: [{titel, sjabloon, fase, status, reden, uren, stap, punten, open, omschrijving}] } (taken uit taken.mjs plan).",
  "Zonder --toepassen schrijft niets naar Autotask; je krijgt alleen een voorvertoning.",
  "",
].join("\n");

const NOTE_TYPE = 5; // zoals bestaande projectnotities in zone 19 (waargenomen op 12-11-2026)
const TASK_NOTE_TYPE = 3; // Task Notes (autotask-api REFERENCE.md)
const TAAK_NOTITIE = "Projectstart: aanvulling";
const TASK_TYPE_FIXED_WORK = 1;
const TASK_STATUS_NEW = 1; // nog niet live geverifieerd bij aanmaken (REFERENCE.md)
const isLink = (b) => b.url != null;
const normUrl = (u) => String(u ?? "").trim(); // exact: hoofdlettergevoelig
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const normTekst = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim().replace(/[ \t]+/g, " ");
const normFase = (s) => normaliseerTitel(s).replace(/\s*-\s*/g, "-");
const isUren = (u) => typeof u === "number" && Number.isFinite(u);
const uurTekst = (u) => (isUren(u) ? `${String(u).replace(".", ",")} uur` : "0 uur (uren nog te bepalen)");

const TAAK_STATUS_COMPLETE = 5;
const NVT_NOTITIE = "Projectstart: niet van toepassing";
const isLeeg = (s) => !String(s ?? "").trim();
const titelSleutel = (s) => normaliseerTitel(s).replace(/\s+/g, "");

// Notitie bij een bestaande taak buiten het sjabloon: alleen wat afwijkt. De taak zelf blijft zoals hij is.
function aanvulling(t, bestaand) {
  const delen = ["Volgens de offerte en de mails hoort bij deze taak het volgende. De taak zelf is niet aangepast; neem over wat klopt.", ""];
  if (isUren(t.uren) && t.uren !== (bestaand.estimatedHours ?? 0)) {
    delen.push(`Uren volgens de offerte: ${uurTekst(t.uren)} (nu in de taak: ${uurTekst(bestaand.estimatedHours ?? 0)})`, "");
  }
  if (normTekst(t.omschrijving) !== normTekst(bestaand.description)) delen.push("Omschrijving volgens het dossier:", String(t.omschrijving).trim());
  return delen.join("\n").trim();
}

const heeftNotitie = (notities, taskId, titel, tekst) =>
  notities.some((n) => n.taskID === taskId && norm(n.title) === norm(titel) && normTekst(n.description) === normTekst(tekst));

// Sjabloontaken staan al in het project (aangemaakt uit Easywork Basic). Per taak: omschrijving vullen als die leeg
// is, anders een notitie; niet van toepassing sluiten met reden; afgeronde taken nooit aanraken.
function planSjabloonTaak(t, er, notities) {
  if (!er) return { ...t, actie: "ontbreekt" };
  const basis = { ...t, taskId: er.id };
  if (er.status === TAAK_STATUS_COMPLETE) return { ...basis, actie: "afgerond" };
  if (t.status === "nvt") {
    const notitie = { titel: NVT_NOTITIE, tekst: `Niet van toepassing: ${t.reden}` };
    return { ...basis, actie: "nvt", notitie, notitieStaatEr: heeftNotitie(notities, er.id, notitie.titel, notitie.tekst) };
  }
  const { omschrijving, notitie: lang } = voorAutotask(t.omschrijving);
  if (isLeeg(er.description)) {
    const notitie = lang ? { titel: SUBTAKEN_NOTITIE, tekst: lang } : null;
    return { ...basis, actie: "omschrijving", omschrijvingAutotask: omschrijving, notitie, notitieStaatEr: !!notitie && heeftNotitie(notities, er.id, notitie.titel, notitie.tekst) };
  }
  if (normTekst(er.description) === normTekst(omschrijving)) return { ...basis, actie: "overslaan" };
  const notitie = { titel: SUBTAKEN_NOTITIE, tekst: t.omschrijving };
  return { ...basis, actie: heeftNotitie(notities, er.id, notitie.titel, notitie.tekst) ? "notitieStaatEr" : "notitie", notitie };
}

function planTaken(taken, bestaand) {
  const fases = new Map((bestaand.fases ?? []).map((f) => [normFase(f.title), f]));
  const opTitel = new Map((bestaand.taken ?? []).map((t) => [titelSleutel(t.title), t]));
  const notities = bestaand.taakNotities ?? [];
  const inPlan = new Set();
  return taken.map((t) => {
    const sleutel = titelSleutel(t.titel);
    if (inPlan.has(sleutel)) return { ...t, actie: "dubbel" };
    inPlan.add(sleutel);
    const er = opTitel.get(sleutel) ?? (t.autotaskTitel ? opTitel.get(titelSleutel(t.autotaskTitel)) : undefined);
    if (t.sjabloon === true) return planSjabloonTaak(t, er, notities);
    const fase = fases.get(normFase(t.fase));
    if (fase) t = { ...t, fase: fase.title }; // de schrijfwijze uit Autotask
    if (er) {
      if (er.status === TAAK_STATUS_COMPLETE) return { ...t, actie: "afgerond", taskId: er.id };
      const urenAnders = isUren(t.uren) && t.uren !== (er.estimatedHours ?? 0);
      if (!urenAnders && normTekst(voorAutotask(t.omschrijving).omschrijving) === normTekst(er.description)) return { ...t, actie: "overslaan", taskId: er.id };
      const notitie = { titel: TAAK_NOTITIE, tekst: aanvulling(t, er) };
      return { ...t, actie: heeftNotitie(notities, er.id, notitie.titel, notitie.tekst) ? "notitieStaatEr" : "notitie", taskId: er.id, notitie };
    }
    if (t.status === "nvt") return { ...t, actie: "nvtNietAangemaakt" };
    if (!fase) return { ...t, actie: "faseOnbekend", bekend: (bestaand.fases ?? []).map((f) => f.title) };
    return { ...t, actie: "nieuw", phaseID: fase.id };
  });
}

export function planSchrijfacties(projectId, { notities = [], bijlagen = [], taken = [] } = {}, bestaand = {}) {
  const titels = new Set((bestaand.notities ?? []).map((n) => norm(n.title)));
  const paden = new Set((bestaand.bijlagen ?? []).map((b) => norm(b.fullPath)));
  const urls = new Set((bestaand.bijlagen ?? []).map((b) => normUrl(b.fullPath)));
  const gezien = (set, sleutel) => (set.has(sleutel) ? true : (set.add(sleutel), false));
  return {
    projectId,
    notities: notities.map((n) => ({ ...n, actie: gezien(titels, norm(n.titel)) ? "overslaan" : "nieuw" })),
    bijlagen: bijlagen.map((b) => ({ ...b, actie: (isLink(b) ? gezien(urls, normUrl(b.url)) : gezien(paden, norm(b.bestandsnaam))) ? "overslaan" : "nieuw" })),
    taken: planTaken(taken, bestaand),
  };
}

const puntenTekst = (t) => `${t.punten ?? 0} punten, ${t.open ?? 0} open`;

async function plaatsTaakNotitie(at, taskId, notitie) {
  await at.postTaskNote({ taskID: taskId, title: notitie.titel, description: notitie.tekst, noteType: TASK_NOTE_TYPE, publish: 2 });
}

async function voerTakenUit(at, plan, toepassen, res, regels) {
  for (const t of plan.taken ?? []) {
    const kop = `Taak "${t.titel}"${t.stap ? ` (stap ${t.stap})` : ""}`;
    const mislukt = (e) => { res.fouten++; regels.push(`${kop}: mislukt: ${e.message}`); };
    switch (t.actie) {
      case "dubbel": regels.push(`${kop}: staat twee keer in het plan; de tweede is overgeslagen.`); continue;
      case "ontbreekt": res.ontbreekt++; regels.push(`${kop}: sjabloontaak ontbreekt in project; niet aangemaakt (maak het project uit Easywork Basic).`); continue;
      case "afgerond": regels.push(`${kop}: staat op Complete in Autotask; niet aangepast.`); continue;
      case "overslaan": regels.push(`${kop}: staat er al zo; overgeslagen.`); continue;
      case "notitieStaatEr": regels.push(`${kop}: omschrijving staat er al; dezelfde notitie "${t.notitie.titel}" ook; overgeslagen.`); continue;
      case "nvtNietAangemaakt": regels.push(`${kop}: n.v.t. (${t.reden}); niet aangemaakt.`); continue;
      case "faseOnbekend":
        res.fouten++;
        regels.push(`${kop}, ${uurTekst(t.uren)}: fase "${t.fase}" niet gevonden; niet aangemaakt. Fases op het project: ${t.bekend?.length ? t.bekend.join("; ") : "geen"}.`);
        continue;
      default:
    }
    const tekst = [t.titel, t.omschrijving, t.notitie?.tekst].filter(Boolean).join("\n");
    if (findSecretText(tekst).length) { res.fouten++; regels.push(`${kop}: overgeslagen, de tekst lijkt een wachtwoord te bevatten.`); continue; }

    if (t.actie === "omschrijving") {
      if (!toepassen) {
        regels.push(`${kop}: omschrijving vullen (${puntenTekst(t)}):`, t.omschrijvingAutotask);
        if (t.notitie) regels.push(`De volledige tekst is langer dan ${MAX_OMSCHRIJVING} tekens en komt als notitie "${t.notitie.titel}" bij de taak.`);
        regels.push("");
        continue;
      }
      try {
        await at.patchTask(plan.projectId, { id: t.taskId, description: t.omschrijvingAutotask });
        res.taakAanpassingen++;
        if (t.notitie && !t.notitieStaatEr) { await plaatsTaakNotitie(at, t.taskId, t.notitie); res.taakNotities++; }
        regels.push(`${kop}: omschrijving gevuld (${puntenTekst(t)}).`);
      } catch (e) { mislukt(e); }
      continue;
    }
    if (t.actie === "notitie") {
      if (!toepassen) { regels.push(`${kop}: omschrijving staat er al; notitie "${t.notitie.titel}" toevoegen:`, t.notitie.tekst, ""); continue; }
      try {
        await plaatsTaakNotitie(at, t.taskId, t.notitie);
        res.taakNotities++;
        regels.push(`${kop}: omschrijving staat er al; notitie toegevoegd.`);
      } catch (e) { mislukt(e); }
      continue;
    }
    if (t.actie === "nvt") {
      if (!toepassen) { regels.push(`${kop}: n.v.t., sluiten met reden (status Complete, 0 uur), notitie "${t.notitie.titel}": ${t.notitie.tekst}`); continue; }
      try {
        // Eerst de notitie, dan de status: faalt de notitie, dan blijft de taak open.
        if (!t.notitieStaatEr) { await plaatsTaakNotitie(at, t.taskId, t.notitie); res.taakNotities++; }
        await at.patchTask(plan.projectId, { id: t.taskId, status: TAAK_STATUS_COMPLETE, estimatedHours: 0 });
        res.taakAanpassingen++;
        regels.push(`${kop}: n.v.t., gesloten met reden.`);
      } catch (e) { mislukt(e); }
      continue;
    }
    // Nieuwe taak buiten het sjabloon.
    const { omschrijving, notitie: lang } = voorAutotask(t.omschrijving);
    if (!toepassen) {
      regels.push(`${kop}: nieuwe taak in ${t.fase}, ${uurTekst(t.uren)}, omschrijving:`, omschrijving);
      if (lang) regels.push(`De volledige tekst komt als notitie "${SUBTAKEN_NOTITIE}" bij de taak.`);
      regels.push("");
      continue;
    }
    try {
      const r = await at.postProjectTask(plan.projectId, {
        projectID: plan.projectId, phaseID: t.phaseID, title: t.titel, description: omschrijving,
        taskType: TASK_TYPE_FIXED_WORK, status: TASK_STATUS_NEW, estimatedHours: isUren(t.uren) ? t.uren : 0,
      });
      res.taken++;
      if (lang && r?.itemId) { await plaatsTaakNotitie(at, r.itemId, { titel: SUBTAKEN_NOTITIE, tekst: lang }); res.taakNotities++; }
      regels.push(`${kop}: aangemaakt in ${t.fase}.`);
    } catch (e) { mislukt(e); }
  }
}

export async function voerUit(at, plan, { toepassen = false, lees = (pad) => readFileSync(pad) } = {}) {
  const regels = [];
  const res = { notities: 0, bijlagen: 0, taken: 0, taakAanpassingen: 0, taakNotities: 0, ontbreekt: 0, fouten: 0 };
  for (const n of plan.notities) {
    if (n.actie === "overslaan") { regels.push(`Notitie "${n.titel}" staat er al; overgeslagen.`); continue; }
    if (findSecretText(`${n.titel}\n${n.tekst}`).length) { res.fouten++; regels.push(`Notitie "${n.titel}" overgeslagen: de tekst lijkt een wachtwoord te bevatten.`); continue; }
    if (!toepassen) { regels.push(`Notitie "${n.titel}" (${n.tekst.length} tekens) wordt geplaatst, volledige tekst:`, n.tekst.replace(/\n+$/, ""), ""); continue; }
    try {
      await at.postProjectNote(plan.projectId, { projectID: plan.projectId, title: n.titel, description: n.tekst, noteType: NOTE_TYPE, publish: 2, isAnnouncement: false });
      res.notities++;
      regels.push(`Notitie "${n.titel}" geplaatst.`);
    } catch (e) { res.fouten++; regels.push(`Notitie "${n.titel}" mislukt: ${e.message}`); }
  }
  for (const b of plan.bijlagen) {
    if (isLink(b)) {
      if (!/^https:[/][/]/.test(normUrl(b.url))) { res.fouten++; regels.push(`Link-bijlage "${b.titel}" overgeslagen: de url moet met https:// beginnen.`); continue; }
      if (b.actie === "overslaan") { regels.push(`Link-bijlage "${b.titel}" staat er al; overgeslagen.`); continue; }
      if (!toepassen) { regels.push(`Link-bijlage "${b.titel}" wordt geplaatst: ${normUrl(b.url)}`); continue; }
      try {
        await at.postProjectAttachment(plan.projectId, { parentID: plan.projectId, attachmentType: "URL", publish: 2, title: b.titel, fullPath: normUrl(b.url) });
        res.bijlagen++;
        regels.push(`Link-bijlage "${b.titel}" geplaatst.`);
      } catch (e) { res.fouten++; regels.push(`Link-bijlage "${b.titel}" mislukt: ${e.message}`); }
      continue;
    }
    if (b.actie === "overslaan") { regels.push(`Bijlage "${b.bestandsnaam}" staat er al; overgeslagen.`); continue; }
    if (!toepassen) {
      // Alleen lezen voor de grootte: zo zie je in de voorvertoning welk lokaal bestand er echt meegaat.
      try { regels.push(`Bijlage "${b.bestandsnaam}" wordt geplaatst uit ${b.pad} (${Buffer.from(lees(b.pad)).length} bytes).`); }
      catch (e) { res.fouten++; regels.push(`Bijlage "${b.bestandsnaam}" kan niet worden gelezen uit ${b.pad}: ${e.message}`); }
      continue;
    }
    try {
      const data = Buffer.from(lees(b.pad)).toString("base64");
      await at.postProjectAttachment(plan.projectId, { parentID: plan.projectId, attachmentType: "FILE_ATTACHMENT",
        publish: 2, // intern projectteam; bevestigen in de proefrun
        title: b.titel, fullPath: b.bestandsnaam, data });
      res.bijlagen++;
      regels.push(`Bijlage "${b.bestandsnaam}" geplaatst.`);
    } catch (e) { res.fouten++; regels.push(`Bijlage "${b.bestandsnaam}" mislukt: ${e.message}`); }
  }
  await voerTakenUit(at, plan, toepassen, res, regels);
  const kop = toepassen
    ? `${res.notities} notities, ${res.bijlagen} bijlagen, ${res.taken} nieuwe taken, ${res.taakAanpassingen} taken aangepast en ${res.taakNotities} taaknotities geplaatst op project ${plan.projectId}.`
    : `Voorvertoning voor project ${plan.projectId}. Er is niets geschreven; draai opnieuw met --toepassen na akkoord.`;
  return { ...res, uitvoer: [kop, ...regels].join("\n") + "\n" };
}

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export async function hoofd(argv, deps = {}) {
  const lees = deps.lees ?? ((pad) => readFileSync(pad));
  const project = optie(argv, "--project");
  const planPad = optie(argv, "--plan");
  if (!/^\d+$/.test(project ?? "") || !planPad) return { code: 1, uitvoer: GEBRUIK };
  try {
    const invoer = JSON.parse(String(lees(planPad)));
    const at = deps.at ?? maakAt({ fetch: deps.fetch, creds: haalCredentials() });
    const projectId = Number(project);
    // Alleen lezen: bestaande notities, bijlagen, fases en taken ophalen voor de dubbelcontrole.
    const notities = await at.queryProjectNotes(projectId);
    const bijlagen = (await at.get(`Projects/${projectId}/Attachments`)).items ?? [];
    const bestaand = { notities, bijlagen };
    if (invoer.taken?.length) {
      bestaand.fases = await at.getProjectPhases(projectId);
      bestaand.taken = await at.getProjectTasks(projectId);
      // Taaknotities alleen ophalen voor taken die een notitie kunnen krijgen, zodat die niet dubbel komt.
      const metNotitie = ["notitie", "nvt", "omschrijving"];
      const ids = [...new Set(planSchrijfacties(projectId, invoer, bestaand).taken.filter((t) => metNotitie.includes(t.actie) && t.notitie).map((t) => t.taskId))];
      bestaand.taakNotities = [];
      for (const id of ids) bestaand.taakNotities.push(...await at.query("TaskNotes", [{ field: "taskID", op: "eq", value: id }]));
    }
    const plan = planSchrijfacties(projectId, invoer, bestaand);
    const r = await voerUit(at, plan, { toepassen: argv.includes("--toepassen"), lees });
    return { code: r.fouten ? 2 : 0, uitvoer: r.uitvoer };
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
