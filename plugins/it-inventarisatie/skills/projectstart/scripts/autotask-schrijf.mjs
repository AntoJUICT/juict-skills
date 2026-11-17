#!/usr/bin/env node
// Schrijfacties naar het Autotask-project: notities en bijlagen (spec 5.7).
// Zonder --toepassen gebeurt er geen enkele POST. Een tweede run maakt niets dubbel:
// notities worden herkend op titel, bijlagen op fullPath (bestandsnaam).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { haalCredentials, maakAt } from "../../it-inventarisatie/scripts/autotask-project.mjs";
import { findSecretText } from "../../it-inventarisatie/scripts/geheimen.mjs";

const GEBRUIK = [
  "Gebruik:",
  "  autotask-schrijf.mjs --project <id> --plan <pad> [--toepassen]",
  "Het plan is JSON: { notities: [{titel, tekst}], bijlagen: [{titel, bestandsnaam, pad} of {titel, url}] }.",
  "Zonder --toepassen schrijft niets naar Autotask; je krijgt alleen een voorvertoning.",
  "",
].join("\n");

const NOTE_TYPE = 5; // zoals bestaande projectnotities in zone 19 (waargenomen op 12-11-2026)
const isLink = (b) => b.url != null;
const normUrl = (u) => String(u ?? "").trim(); // exact: hoofdlettergevoelig
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function planSchrijfacties(projectId, { notities = [], bijlagen = [] } = {}, bestaand = {}) {
  const titels = new Set((bestaand.notities ?? []).map((n) => norm(n.title)));
  const paden = new Set((bestaand.bijlagen ?? []).map((b) => norm(b.fullPath)));
  const urls = new Set((bestaand.bijlagen ?? []).map((b) => normUrl(b.fullPath)));
  const gezien = (set, sleutel) => (set.has(sleutel) ? true : (set.add(sleutel), false));
  return {
    projectId,
    notities: notities.map((n) => ({ ...n, actie: gezien(titels, norm(n.titel)) ? "overslaan" : "nieuw" })),
    bijlagen: bijlagen.map((b) => ({ ...b, actie: (isLink(b) ? gezien(urls, normUrl(b.url)) : gezien(paden, norm(b.bestandsnaam))) ? "overslaan" : "nieuw" })),
  };
}

export async function voerUit(at, plan, { toepassen = false, lees = (pad) => readFileSync(pad) } = {}) {
  const regels = [];
  const res = { notities: 0, bijlagen: 0, fouten: 0 };
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
  const kop = toepassen
    ? `${res.notities} notities en ${res.bijlagen} bijlagen geplaatst op project ${plan.projectId}.`
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
    // Alleen lezen: bestaande notities en bijlagen ophalen voor de dubbelcontrole.
    const notities = await at.queryProjectNotes(projectId);
    const bijlagen = (await at.get(`Projects/${projectId}/Attachments`)).items ?? [];
    const plan = planSchrijfacties(projectId, invoer, { notities, bijlagen });
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
