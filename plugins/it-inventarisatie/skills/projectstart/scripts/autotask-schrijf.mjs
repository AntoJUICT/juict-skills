#!/usr/bin/env node
// Schrijfacties naar het Autotask-project: notities, bijlagen en technische taken (spec 5.7).
// Zonder --toepassen gebeurt er geen enkele POST. Een tweede run maakt niets dubbel:
// notities worden herkend op titel, bijlagen op fullPath (bestandsnaam), taken op titel binnen het project.
// Een bestaande taak wordt nooit overschreven: wijkt het dossier af, dan komt er een notitie bij de taak.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { haalCredentials, maakAt, normaliseerTitel } from "../../it-inventarisatie/scripts/autotask-project.mjs";
import { findSecretText } from "../../it-inventarisatie/scripts/geheimen.mjs";

const GEBRUIK = [
  "Gebruik:",
  "  autotask-schrijf.mjs --project <id> --plan <pad> [--toepassen]",
  "Het plan is JSON: { notities: [{titel, tekst}], bijlagen: [{titel, bestandsnaam, pad} of {titel, url}],",
  "  taken: [{titel, fase, uren, omschrijving}] }.",
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

// Notitie bij een bestaande taak: alleen wat afwijkt. De taak zelf blijft zoals de engineers hem hebben.
function aanvulling(t, bestaand) {
  const delen = ["Volgens de offerte en de mails hoort bij deze taak het volgende. De taak zelf is niet aangepast; neem over wat klopt.", ""];
  if (isUren(t.uren) && t.uren !== (bestaand.estimatedHours ?? 0)) {
    delen.push(`Uren volgens de offerte: ${uurTekst(t.uren)} (nu in de taak: ${uurTekst(bestaand.estimatedHours ?? 0)})`, "");
  }
  if (normTekst(t.omschrijving) !== normTekst(bestaand.description)) delen.push("Omschrijving volgens het dossier:", String(t.omschrijving).trim());
  return delen.join("\n").trim();
}

function planTaken(taken, bestaand) {
  const fases = new Map((bestaand.fases ?? []).map((f) => [normFase(f.title), f]));
  const opTitel = new Map((bestaand.taken ?? []).map((t) => [normaliseerTitel(t.title), t]));
  const notities = bestaand.taakNotities ?? [];
  const inPlan = new Set();
  return taken.map((t) => {
    const sleutel = normaliseerTitel(t.titel);
    const fase = fases.get(normFase(t.fase));
    if (fase) t = { ...t, fase: fase.title }; // de schrijfwijze uit Autotask
    if (inPlan.has(sleutel)) return { ...t, actie: "overslaan" };
    inPlan.add(sleutel);
    const er = opTitel.get(sleutel);
    if (er) {
      const urenAnders = isUren(t.uren) && t.uren !== (er.estimatedHours ?? 0);
      if (!urenAnders && normTekst(t.omschrijving) === normTekst(er.description)) return { ...t, actie: "overslaan", taskId: er.id };
      const notitie = { titel: TAAK_NOTITIE, tekst: aanvulling(t, er) };
      const al = notities.some((n) => n.taskID === er.id && norm(n.title) === norm(TAAK_NOTITIE) && normTekst(n.description) === normTekst(notitie.tekst));
      return { ...t, actie: al ? "overslaan" : "notitie", taskId: er.id, notitie };
    }
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

async function voerTakenUit(at, plan, toepassen, res, regels) {
  for (const t of plan.taken ?? []) {
    const kop = `Taak "${t.titel}" in ${t.fase}, ${uurTekst(t.uren)}`;
    if (t.actie === "overslaan") { regels.push(`${kop}: staat er al; overgeslagen.`); continue; }
    if (t.actie === "faseOnbekend") {
      res.fouten++;
      regels.push(`Taak "${t.titel}", ${uurTekst(t.uren)}: fase "${t.fase}" niet gevonden; niet aangemaakt. Fases op het project: ${t.bekend?.length ? t.bekend.join("; ") : "geen"}.`);
      continue;
    }
    const tekst = t.actie === "notitie" ? t.notitie.tekst : t.omschrijving;
    if (findSecretText(`${t.titel}\n${tekst}`).length) { res.fouten++; regels.push(`${kop}: overgeslagen, de tekst lijkt een wachtwoord te bevatten.`); continue; }
    if (t.actie === "notitie") {
      if (!toepassen) { regels.push(`${kop}: staat er al met andere uren of omschrijving; notitie bij bestaande taak "${t.notitie.titel}":`, t.notitie.tekst, ""); continue; }
      try {
        await at.postTaskNote({ taskID: t.taskId, title: t.notitie.titel, description: t.notitie.tekst, noteType: TASK_NOTE_TYPE, publish: 2 });
        res.taakNotities++;
        regels.push(`${kop}: notitie bij bestaande taak geplaatst.`);
      } catch (e) { res.fouten++; regels.push(`${kop}: notitie bij bestaande taak mislukt: ${e.message}`); }
      continue;
    }
    if (!toepassen) { regels.push(`${kop}: nieuw, omschrijving:`, t.omschrijving, ""); continue; }
    try {
      await at.postProjectTask(plan.projectId, {
        projectID: plan.projectId, phaseID: t.phaseID, title: t.titel, description: t.omschrijving,
        taskType: TASK_TYPE_FIXED_WORK, status: TASK_STATUS_NEW, estimatedHours: isUren(t.uren) ? t.uren : 0,
      });
      res.taken++;
      regels.push(`${kop}: aangemaakt.`);
    } catch (e) { res.fouten++; regels.push(`${kop}: mislukt: ${e.message}`); }
  }
}

export async function voerUit(at, plan, { toepassen = false, lees = (pad) => readFileSync(pad) } = {}) {
  const regels = [];
  const res = { notities: 0, bijlagen: 0, taken: 0, taakNotities: 0, fouten: 0 };
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
    ? `${res.notities} notities, ${res.bijlagen} bijlagen, ${res.taken} taken en ${res.taakNotities} taaknotities geplaatst op project ${plan.projectId}.`
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
      // Taaknotities alleen ophalen voor taken die een aanvulling krijgen, zodat die niet dubbel komt.
      const ids = [...new Set(planSchrijfacties(projectId, invoer, bestaand).taken.filter((t) => t.actie === "notitie").map((t) => t.taskId))];
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
