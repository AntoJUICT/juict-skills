#!/usr/bin/env node
// Werkbestand per klant: %USERPROFILE%\.claude\it-inventarisatie\<slug>\inventarisatie.json
// Schemaversie 1. Alles gaat via scrubSecrets voordat het naar schijf gaat. Nooit in een repo.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { scrubSecrets } from "./geheimen.mjs";

export const STAPPEN = ["offerte", "bronnen", "interview", "uitvraag", "rapport", "autotask", "klaar"];

export function slugify(klant) {
  return String(klant ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function werkmap(slug, root = process.env.IT_INVENTARISATIE_ROOT ?? join(homedir(), ".claude", "it-inventarisatie")) {
  return join(root, slug);
}

const bestandspad = (slug, root) => join(werkmap(slug, root), "inventarisatie.json");

export function laad(slug, root) {
  const pad = bestandspad(slug, root);
  if (!existsSync(pad)) return null;
  return JSON.parse(readFileSync(pad, "utf8"));
}

export function bewaar(slug, data, root) {
  const pad = bestandspad(slug, root);
  mkdirSync(werkmap(slug, root), { recursive: true });
  const schoon = scrubSecrets({ ...data, bijgewerkt: new Date().toISOString() });
  writeFileSync(pad, JSON.stringify(schoon, null, 2) + "\n", "utf8");
  return pad;
}

export function nieuw(klant) {
  const nu = new Date().toISOString();
  return {
    schema: 1,
    klant,
    slug: slugify(klant),
    aangemaakt: nu,
    bijgewerkt: nu,
    stap: "offerte",
    offerte: {
      bestand: null,
      scope: { m365: false, werkplekken: false, server: false, netwerk: false, printers: false, applicaties: false, telefonie: false, beveiliging: false },
      uren: [],
    },
    bronnen: { mail: [], m365: null, itglue: null, autotask: null, dns: [] },
    antwoorden: {},
    openVragen: [],
    laatsteMailcheck: null,
    rapport: { artifactUrl: null, pdfPad: null },
    autotask: { companyId: null, projectId: null, toegepast: false },
  };
}

function cli(args) {
  const [cmd, a, b] = args;
  if (cmd === "nieuw" && a) {
    const w = nieuw(a);
    if (laad(w.slug)) {
      console.error(`Werkbestand voor ${w.slug} bestaat al.`);
      return 1;
    }
    console.log(bewaar(w.slug, w));
    return 0;
  }
  if (cmd === "toon" && a) {
    const w = laad(a);
    if (!w) {
      console.error(`Geen werkbestand voor ${a}.`);
      return 1;
    }
    console.log(JSON.stringify(scrubSecrets(w), null, 2));
    return 0;
  }
  if (cmd === "stap" && a && b) {
    if (!STAPPEN.includes(b)) {
      console.error(`Onbekende stap. Kies uit: ${STAPPEN.join(", ")}.`);
      return 1;
    }
    const w = laad(a);
    if (!w) {
      console.error(`Geen werkbestand voor ${a}.`);
      return 1;
    }
    w.stap = b;
    console.log(bewaar(a, w));
    return 0;
  }
  console.error("Gebruik: werkbestand.mjs nieuw <klant> | toon <slug> | stap <slug> <stap>");
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = cli(process.argv.slice(2));
}
