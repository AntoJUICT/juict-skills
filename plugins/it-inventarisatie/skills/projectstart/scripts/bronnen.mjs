#!/usr/bin/env node
// Bronnen van een Autotask-project ophalen: bijlagen (naar schijf) en notities (in het manifest).
// Alleen lezen. Credentials via haalCredentials (Key Vault) en worden nooit geprint of opgeslagen.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { haalCredentials, maakAt } from "../../it-inventarisatie/scripts/autotask-project.mjs";
import { scrubSecrets } from "../../it-inventarisatie/scripts/geheimen.mjs";

const GEBRUIK = "Gebruik: bronnen.mjs --project <id> [--uit <map>]\nStandaard map: %USERPROFILE%\\.claude\\projectstart\\<id>\\\n";

// Letters (ook accenten) en en-dash blijven staan; alleen tekens die Windows niet toestaat worden "_".
export function veiligeBestandsnaam(naam) {
  return String(naam ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
}

const eerste = (antwoord) => antwoord?.item ?? antwoord?.items?.[0] ?? null;

export async function haalBronnen(at, projectId, uitMap) {
  const project = eerste(await at.get(`Projects/${projectId}`));
  if (!project) throw new Error(`Project ${projectId} niet gevonden in Autotask.`);
  const bedrijf = project.companyID != null ? eerste(await at.get(`Companies/${project.companyID}`)) : null;

  const lijst = (await at.get(`Projects/${projectId}/Attachments`)).items ?? [];
  const bronnenMap = join(uitMap, "bronnen");
  mkdirSync(bronnenMap, { recursive: true });

  // Links, mappen en lege bijlagen breken de run niet af: ze komen in het manifest onder "overgeslagen".
  const overgeslagen = [];
  const sla = (rij, reden) => { overgeslagen.push({ id: rij.id, titel: rij.title ?? rij.fullPath ?? `bijlage-${rij.id}`, reden }); return null; };

  // De semafoor in maakAt houdt het bij maximaal 2 gelijktijdige downloads.
  const resultaten = await Promise.all(lijst.map(async (rij) => {
    if (rij.attachmentType && rij.attachmentType !== "FILE_ATTACHMENT") return sla(rij, "geen bestandsbijlage");
    const volledig = eerste(await at.getProjectAttachment(projectId, rij.id));
    if (!volledig?.data) return sla(rij, "geen inhoud");
    let naam = String(rij.title ?? volledig.title ?? rij.fullPath ?? `bijlage-${rij.id}`);
    const ext = extname(String(rij.fullPath ?? volledig.fullPath ?? ""));
    if (ext && !extname(naam)) naam += ext;
    const bestand = `bronnen/${rij.id}-${veiligeBestandsnaam(naam)}`;
    writeFileSync(join(uitMap, bestand), Buffer.from(volledig.data, "base64"));
    return { id: rij.id, titel: rij.title ?? naam, bestand, type: rij.contentType ?? volledig.contentType ?? null, datum: rij.attachDate ?? null };
  }));
  const bijlagen = resultaten.filter(Boolean);
  overgeslagen.sort((x, y) => lijst.findIndex((r) => r.id === x.id) - lijst.findIndex((r) => r.id === y.id));

  const notities = (await at.queryProjectNotes(projectId)).map((n) => ({
    id: n.id, titel: n.title ?? "", tekst: n.description ?? "", datum: n.createDateTime ?? null,
  }));

  const manifest = scrubSecrets({
    projectId, companyId: project.companyID ?? null, projectNaam: project.projectName ?? "",
    bedrijfsnaam: bedrijf?.companyName ?? "", bijlagen, overgeslagen, notities,
  });
  writeFileSync(join(uitMap, "bronnen.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

export async function hoofd(argv, deps = {}) {
  const project = optie(argv, "--project");
  if (!project || !/^\d+$/.test(project)) return { code: 1, uitvoer: GEBRUIK };
  const uitMap = optie(argv, "--uit") ?? join(homedir(), ".claude", "projectstart", project);
  try {
    const at = deps.at ?? maakAt({ fetch: deps.fetch, creds: haalCredentials() });
    const m = await haalBronnen(at, Number(project), uitMap);
    // Alleen het manifest zonder notitietekst: inhoud blijft op schijf.
    const zonderTekst = { ...m, notities: m.notities.map(({ tekst, ...rest }) => rest) };
    return { code: 0, uitvoer: JSON.stringify(zonderTekst, null, 2) + "\n" };
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
