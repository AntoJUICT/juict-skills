#!/usr/bin/env node
// Autotask-project invullen na de inventarisatie (sjabloon Easywork Basic, project 14).
// Plant per taak wat er verandert, toont een voorvertoning en schrijft pas met --toepassen.
// Secrets uit Key Vault via az (juict-shared-kv, dan ju-hermes-emmanuel), met env-fallback.
// Secret-waarden worden nooit geprint of gelogd. Geen npm-deps; Node 18+.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { pathToFileURL } from "node:url";
import { scrubSecrets, findSecretText } from "./geheimen.mjs";
import { slugify } from "./werkbestand.mjs";

// De 29 taken van Easywork Basic, gelezen op 4-11-2026 (per fase, in sjabloonvolgorde).
export const SJABLOON_TAKEN = [
  "Administratieve opstart project",
  "Maken Plan van Aanpak", "Huidige documentatie ontvangen", "Aanschaf benodigde hardware en/of software", "Licentie plan maken",
  "Setup telefonie", "RBAC Opmaken", "Setup netwerk", "Setup Microsoft 365", "Mailmigratie Microsoft 365",
  "Setup standaard applicaties", "Setup Intune", "Initiële datamigratie",
  "Distribueren welkomsbrief", "ICT oplevering op locatie", "Definitieve datamigratie", "Nazorg project oplevering",
  "IT Glue updaten", "Telefonie oplevering op locatie", "Controle licenties en back-up",
  "Ondersteuning bedrijfsapplicaties", "NACALC (Werkzaamheden buiten scope)",
  "Project afsluitingsgesprek", "Tussentijds voortgangsgesprek", "Projectafstemming met verkoop", "Project opstart", "Diverse projectwerkzaamheden",
  "Administratieve oplevering", "After sales",
];

// onderdelen = sleutels in werkbestand.antwoorden; scope = sleutel in werkbestand.offerte.scope.
// Taken die hier niet staan (projectmanagement, oplevering, administratie, NACALC) worden niet aangeraakt.
export const TAAK_KOPPELING = {
  "Huidige documentatie ontvangen": { onderdelen: ["documentatie"] },
  "Licentie plan maken": { onderdelen: ["licenties"], scope: "m365" },
  "Aanschaf benodigde hardware en/of software": { onderdelen: ["netwerk", "werkplekken"] },
  "Setup Microsoft 365": { onderdelen: ["mail", "licenties", "beveiliging"], scope: "m365" },
  "RBAC Opmaken": { onderdelen: ["beveiliging"], scope: "m365" },
  "Mailmigratie Microsoft 365": { onderdelen: ["mail"], scope: "m365" },
  "Setup Intune": { onderdelen: ["werkplekken"], scope: "werkplekken" },
  "Setup standaard applicaties": { onderdelen: ["applicaties"], scope: "applicaties" },
  "Initiële datamigratie": { onderdelen: ["server"], scope: "server" },
  "Definitieve datamigratie": { onderdelen: ["server"], scope: "server" },
  "Setup netwerk": { onderdelen: ["netwerk"], scope: "netwerk" },
  "Setup telefonie": { onderdelen: ["telefonie"], scope: "telefonie" },
  "Telefonie oplevering op locatie": { onderdelen: ["telefonie"], scope: "telefonie" },
  "IT Glue updaten": { onderdelen: ["documentatie"] },
};

// Zo staat een scope-onderdeel midden in een zin ("...: telefonie valt niet in de offerte.").
const SCOPE_IN_ZIN = {
  m365: "Microsoft 365", werkplekken: "werkplekken", server: "server", netwerk: "netwerk",
  printers: "printers", applicaties: "applicaties", telefonie: "telefonie", beveiliging: "beveiliging",
};

const STATUS_COMPLETE = 5;
const MAX_SAMENVATTING = 1000;
const MAX_OMSCHRIJVING = 8000; // Task.description, zone 19
const MAX_NOTITIE = 32000;
const IN_IT_GLUE = "staat in IT Glue";

export function normaliseerTitel(titel) {
  return String(titel ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const SJABLOON_OP_SLEUTEL = new Map(SJABLOON_TAKEN.map((t) => [normaliseerTitel(t), t]));

function formatDatum(datum) {
  if (datum instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(datum.getDate())}-${p(datum.getMonth() + 1)}-${datum.getFullYear()}`;
  }
  return String(datum);
}

function label(sleutel) {
  return String(sleutel)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

const kop = (onderdeel) => {
  const l = label(onderdeel);
  return l.charAt(0).toUpperCase() + l.slice(1);
};

// Een string met een wachtwoord in vrije tekst ("wachtwoord: ...") wordt een verwijzing naar IT Glue.
function waarde(v) {
  if (typeof v === "string") return findSecretText(v).length ? IN_IT_GLUE : v;
  return String(v);
}

const isScalair = (v) => v === null || typeof v !== "object";

// Platte regels "sleutel: waarde" uit een (al geschoonde) antwoordenboom.
function regels(obj, prefix = "") {
  const uit = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const naam = `${prefix}${label(k)}`;
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) {
      if (v.every(isScalair)) uit.push([naam, v.map(waarde).join(", ")]);
      else v.forEach((item, i) => (isScalair(item) ? uit.push([`${naam} ${i + 1}`, waarde(item)]) : uit.push(...regels(item, `${naam} ${i + 1} `))));
    } else if (typeof v === "object") {
      uit.push(...regels(v, `${naam} `));
    } else {
      uit.push([naam, waarde(v)]);
    }
  }
  return uit;
}

function kap(tekst, max) {
  return tekst.length <= max ? tekst : tekst.slice(0, max - 4).trimEnd() + " ...";
}

export function planTaskUpdates(taken, werkbestand, { datum, engineer } = {}) {
  const d = formatDatum(datum ?? new Date());
  const wie = engineer || "onbekende engineer";
  const scope = werkbestand?.offerte?.scope ?? {};
  const uren = werkbestand?.offerte?.uren ?? [];
  const antwoorden = scrubSecrets(werkbestand?.antwoorden ?? {});
  const notitieTitel = `Inventarisatie ${d}`;

  const aanwezig = new Set();
  const wijzigingen = [];
  const onbekend = [];

  for (const taak of taken ?? []) {
    const sleutel = normaliseerTitel(taak.title);
    const sjabloon = SJABLOON_OP_SLEUTEL.get(sleutel);
    if (!sjabloon) {
      onbekend.push(taak.title);
      continue;
    }
    aanwezig.add(sleutel);
    if (taak.status === STATUS_COMPLETE) continue;
    const koppeling = TAAK_KOPPELING[sjabloon];
    if (!koppeling) continue;

    const basis = { taskId: taak.id, titel: taak.title };
    // Alleen een expliciete false is buiten scope; null (onbekend) of een ontbrekende waarde niet.
    if (koppeling.scope && scope[koppeling.scope] === false) {
      wijzigingen.push({
        ...basis,
        actie: "nvt",
        status: STATUS_COMPLETE,
        estimatedHours: 0,
        vorigeUren: taak.estimatedHours ?? null,
        notitie: {
          titel: notitieTitel,
          tekst: `Niet van toepassing volgens de inventarisatie van ${d} (${wie}): ${SCOPE_IN_ZIN[koppeling.scope] ?? koppeling.scope} valt niet in de offerte.`,
        },
      });
      continue;
    }

    const w = { ...basis, actie: "aanvullen" };

    const fase = uren.find((u) => normaliseerTitel(u.fase) === sleutel);
    if (fase && Number.isFinite(Number(fase.uren)) && Number(fase.uren) !== taak.estimatedHours) {
      w.estimatedHours = Number(fase.uren);
      w.vorigeUren = taak.estimatedHours ?? null;
    }

    const blokken = koppeling.onderdelen
      .map((o) => ({ onderdeel: o, regels: regels(antwoorden[o]) }))
      .filter((b) => b.regels.length);

    if (blokken.length) {
      const kopregel = `Inventarisatie ${d} (${wie})`;
      const delen = [kopregel, ""];
      for (const b of blokken) delen.push(kop(b.onderdeel), ...b.regels.map(([k, v]) => `- ${k}: ${v}`), "");
      delen.push("Wachtwoorden en andere geheimen staan in IT Glue, niet in deze notitie.");
      w.notitie = { titel: notitieTitel, tekst: kap(delen.join("\n"), MAX_NOTITIE) };

      // Korte samenvatting in de omschrijving; staat er al een van deze datum, dan niet nog eens.
      const bestaand = String(taak.description ?? "").trim();
      if (!bestaand.includes(`${notitieTitel}:`)) {
        const kort = blokken.map((b) => `${kop(b.onderdeel)}: ${b.regels.map(([k, v]) => `${k} ${v}`).join("; ")}`).join(". ");
        const ruimte = Math.min(MAX_SAMENVATTING, MAX_OMSCHRIJVING - (bestaand ? bestaand.length + 2 : 0));
        if (ruimte > 80) {
          const samenvatting = kap(`${notitieTitel}: ${kort}. Details in de notitie.`, ruimte);
          w.omschrijving = bestaand ? `${bestaand}\n\n${samenvatting}` : samenvatting;
        }
      }
    }

    if (w.estimatedHours !== undefined || w.omschrijving !== undefined || w.notitie) wijzigingen.push(w);
  }

  const projectId = (taken ?? []).find((t) => t.projectID != null)?.projectID ?? werkbestand?.autotask?.projectId ?? null;
  const ontbrekend = SJABLOON_TAKEN.filter((t) => !aanwezig.has(normaliseerTitel(t)));
  return { projectId, wijzigingen, ontbrekend, onbekend };
}

function inspring(tekst, maxRegels = 40) {
  const r = String(tekst).split("\n");
  const getoond = r.slice(0, maxRegels).map((x) => `      ${x}`);
  if (r.length > maxRegels) getoond.push(`      (nog ${r.length - maxRegels} regels)`);
  return getoond.join("\n");
}

export function toonPlan(plan) {
  const uit = [`Project ${plan.projectId}: ${plan.wijzigingen.length} taken wijzigen.`, ""];
  for (const w of plan.wijzigingen) {
    uit.push(`${w.titel} (taak ${w.taskId}): ${w.actie === "nvt" ? "niet van toepassing" : "aanvullen"}`);
    if (w.status !== undefined) uit.push(`  status ${w.status} (Complete)`);
    if (w.estimatedHours !== undefined) uit.push(`  uren: ${w.vorigeUren ?? "leeg"} → ${w.estimatedHours}`);
    if (w.omschrijving !== undefined) uit.push("  omschrijving wordt:", inspring(w.omschrijving, 10));
    if (w.notitie) uit.push(`  notitie "${w.notitie.titel}":`, inspring(w.notitie.tekst));
    uit.push("");
  }
  if (plan.ontbrekend.length) uit.push(`Sjabloontaken die op dit project ontbreken (${plan.ontbrekend.length}): ${plan.ontbrekend.join("; ")}`);
  if (plan.onbekend.length) uit.push(`Eigen taken, niet aangeraakt (${plan.onbekend.length}): ${plan.onbekend.join("; ")}`);
  return uit.join("\n").trimEnd() + "\n";
}

export async function pasToe(plan, { at, bestaandeNotities = [] } = {}) {
  const bestaand = new Set((bestaandeNotities ?? []).map((n) => `${n.taskID}|${n.title}`));
  const res = { taken: 0, notities: 0, overgeslagen: [], fouten: [] };
  for (const w of plan.wijzigingen ?? []) {
    const fout = (melding) => res.fouten.push({ taskId: w.taskId, titel: w.titel, melding });
    // plan.json kan met de hand zijn aangepast: nooit een wachtwoord in vrije tekst naar Autotask.
    if (findSecretText([w.omschrijving ?? "", w.notitie?.tekst ?? ""]).length) {
      fout("Overgeslagen: de tekst bevat iets wat op een wachtwoord lijkt.");
      continue;
    }
    const body = { id: w.taskId };
    if (w.status !== undefined) body.status = w.status;
    if (w.estimatedHours !== undefined) body.estimatedHours = w.estimatedHours;
    if (w.omschrijving !== undefined) body.description = w.omschrijving;
    try {
      // Eerst de notitie, dan de patch. Faalt de patch, dan staat de taak nog open en neemt een volgend
      // plan hem opnieuw mee; de notitie wordt dan op titel herkend en niet dubbel geplaatst. Andersom
      // zou een nvt-taak op Complete staan zonder notitie, en een nieuw plan slaat Complete-taken over.
      if (w.notitie) {
        if (bestaand.has(`${w.taskId}|${w.notitie.titel}`)) {
          res.overgeslagen.push({ taskId: w.taskId, titel: w.titel, reden: `notitie "${w.notitie.titel}" staat er al` });
        } else {
          await at.postTaskNote({ taskID: w.taskId, title: w.notitie.titel, description: w.notitie.tekst, noteType: 3, publish: 2 });
          bestaand.add(`${w.taskId}|${w.notitie.titel}`);
          res.notities++;
        }
      }
      if (Object.keys(body).length > 1) {
        await at.patchTask(plan.projectId, body);
        res.taken++;
      }
    } catch (e) {
      fout(e.message);
    }
  }
  return res;
}

// --- Credentials en HTTP-laag ---

const VAULTS = ["juict-shared-kv", "ju-hermes-emmanuel"];

function azSecret(exec, vault, naam) {
  // vault en naam zijn vaste constanten; op Windows is az een .cmd en is shell nodig.
  const uit = exec("az", ["keyvault", "secret", "show", "--vault-name", vault, "--name", naam, "--query", "value", "-o", "tsv"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32",
  });
  return String(uit).replace(/\r/g, "").trim();
}

export function haalCredentials({ exec = execFileSync, env = process.env } = {}) {
  for (const vault of VAULTS) {
    try {
      const username = azSecret(exec, vault, "AUTOTASK-USERNAME");
      const secret = azSecret(exec, vault, "AUTOTASK-API-KEY");
      const integrationCode = azSecret(exec, vault, "AUTOTASK-INTEGRATION-CODE");
      if (!username || !secret || !integrationCode) continue;
      let zone = "19";
      try { zone = azSecret(exec, vault, "AUTOTASK-ZONE") || "19"; } catch { /* standaard 19 */ }
      return { username, secret, integrationCode, zone };
    } catch { /* volgende vault */ }
  }
  if (env.AUTOTASK_USERNAME && env.AUTOTASK_API_KEY && env.AUTOTASK_INTEGRATION_CODE) {
    return { username: env.AUTOTASK_USERNAME, secret: env.AUTOTASK_API_KEY, integrationCode: env.AUTOTASK_INTEGRATION_CODE, zone: env.AUTOTASK_ZONE || "19" };
  }
  throw new Error("Geen Autotask-gegevens: niet in juict-shared-kv of ju-hermes-emmanuel (az login?) en niet in AUTOTASK_USERNAME, AUTOTASK_API_KEY en AUTOTASK_INTEGRATION_CODE.");
}

function semafoor(max) {
  let bezig = 0;
  const wacht = [];
  return async (fn) => {
    // Een vrijgekomen plek gaat direct naar de eerste wachtende, zodat een nieuwkomer er niet tussen kan.
    if (bezig >= max) await new Promise((r) => wacht.push(r));
    else bezig++;
    try {
      return await fn();
    } finally {
      const volgende = wacht.shift();
      if (volgende) volgende(); else bezig--;
    }
  };
}

export function maakAt({ fetch: doFetch = globalThis.fetch, creds, maxGelijktijdig = 2 } = {}) {
  const base = `https://webservices${creds.zone}.autotask.net/ATServicesRest/V1.0/`;
  const beperk = semafoor(maxGelijktijdig);
  const verberg = (tekst) => [creds.username, creds.secret, creds.integrationCode]
    .filter(Boolean)
    .reduce((t, v) => t.split(v).join("[verborgen]"), String(tekst));

  async function verzoek(method, pad, body) {
    const url = pad.startsWith("https://") ? pad : base + pad;
    if (!url.startsWith(base)) throw new Error("Autotask gaf een vervolg-URL naar een andere host; gestopt.");
    return beperk(async () => {
      const res = await doFetch(url, {
        method,
        headers: { "Content-Type": "application/json", UserName: creds.username, Secret: creds.secret, ApiIntegrationCode: creds.integrationCode },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const tekst = await res.text().catch(() => "");
        throw new Error(`Autotask API fout ${res.status} bij ${method} ${pad.replace(base, "")}: ${verberg(tekst).slice(0, 500)}`);
      }
      return res.json();
    });
  }

  return {
    get: (pad) => verzoek("GET", pad),
    async query(entity, filter) {
      const body = { filter };
      const items = [];
      let volgende = `${entity}/query`;
      for (let pagina = 0; volgende && pagina < 50; pagina++) {
        const data = await verzoek("POST", volgende, body);
        items.push(...(data.items ?? []));
        volgende = data.pageDetails?.nextPageUrl ?? null;
      }
      return items;
    },
    // De drie schrijf-endpoints hieronder: geverifieerd in zone 19 op 4-11-2026 (zie REFERENCE.md).
    patchTask: (projectId, body) => verzoek("PATCH", `Projects/${projectId}/Tasks`, body),
    postTaskNote: (body) => verzoek("POST", "TaskNotes", body),
    postProjectAttachment: (projectId, body) => verzoek("POST", `Projects/${projectId}/Attachments`, body),
  };
}

// --- CLI ---

const GEBRUIK = [
  "Gebruik:",
  "  autotask-project.mjs zoek --company <id>",
  "  autotask-project.mjs plan --project <id> --werkbestand <pad> [--uit plan.json] [--engineer <naam>] [--datum dd-mm-jjjj]",
  "  autotask-project.mjs toepassen --plan plan.json [--toepassen]",
  "  autotask-project.mjs bijlage --project <id> --pdf <pad> (--klant <naam> | --werkbestand <pad>) [--toepassen]",
  "Zonder --toepassen schrijft niets naar Autotask; je krijgt alleen een voorvertoning.",
].join("\n");

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

function id(argv, naam) {
  const v = optie(argv, naam);
  return v && /^\d+$/.test(v) ? Number(v) : undefined;
}

export async function hoofd(argv, deps = {}) {
  const lees = deps.lees ?? ((pad) => readFileSync(pad));
  const schrijf = deps.schrijf ?? ((pad, inhoud) => writeFileSync(pad, inhoud, "utf8"));
  const leesTekst = (pad) => String(lees(pad));
  const at = () => deps.at ?? maakAt({ fetch: deps.fetch, creds: haalCredentials() });
  const [cmd] = argv;
  const toepassen = argv.includes("--toepassen");
  const fout = { code: 1, uitvoer: GEBRUIK };

  try {
    if (cmd === "zoek") {
      const company = id(argv, "--company");
      if (company === undefined) return fout;
      const projecten = await at().query("Projects", [
        { field: "companyID", op: "eq", value: company },
        { field: "projectType", op: "eq", value: 5 },
        { field: "status", op: "noteq", value: 5 },
      ]);
      if (!projecten.length) return { code: 0, uitvoer: "Geen open klantproject gevonden voor dit bedrijf. Er wordt niets ingevuld.\n" };
      return { code: 0, uitvoer: projecten.map((p) => `${p.id}\t${p.projectName}\tstatus ${p.status}`).join("\n") + "\n" };
    }

    if (cmd === "plan") {
      const project = id(argv, "--project");
      const wbPad = optie(argv, "--werkbestand");
      if (project === undefined || !wbPad) return fout;
      const werkbestand = JSON.parse(leesTekst(wbPad));
      const taken = await at().query("Tasks", [{ field: "projectID", op: "eq", value: project }]);
      const plan = planTaskUpdates(taken, werkbestand, {
        datum: optie(argv, "--datum") ?? new Date(),
        engineer: optie(argv, "--engineer") ?? werkbestand.engineer ?? userInfo().username,
      });
      plan.projectId = project;
      const uitPad = optie(argv, "--uit");
      if (uitPad) schrijf(uitPad, JSON.stringify(scrubSecrets(plan), null, 2) + "\n");
      return { code: 0, uitvoer: toonPlan(plan) + (uitPad ? `\nPlan bewaard in ${uitPad}.\n` : "") };
    }

    if (cmd === "toepassen") {
      const planPad = optie(argv, "--plan");
      if (!planPad) return fout;
      const plan = JSON.parse(leesTekst(planPad));
      const voorvertoning = toonPlan(plan);
      if (!toepassen) return { code: 0, uitvoer: `${voorvertoning}\nVoorvertoning. Er is niets geschreven; draai opnieuw met --toepassen na akkoord.\n` };
      const api = at();
      const bestaandeNotities = [];
      for (const taskId of new Set(plan.wijzigingen.filter((w) => w.notitie).map((w) => w.taskId))) {
        bestaandeNotities.push(...await api.query("TaskNotes", [{ field: "taskID", op: "eq", value: taskId }]));
      }
      const r = await pasToe(plan, { at: api, bestaandeNotities });
      const regelsUit = [`${r.taken} taken bijgewerkt, ${r.notities} notities geplaatst.`];
      for (const o of r.overgeslagen) regelsUit.push(`Overgeslagen: ${o.titel}: ${o.reden}.`);
      for (const f of r.fouten) regelsUit.push(`Fout bij ${f.titel}: ${f.melding}`);
      return { code: r.fouten.length ? 2 : 0, uitvoer: regelsUit.join("\n") + "\n" };
    }

    if (cmd === "bijlage") {
      const project = id(argv, "--project");
      const pdfPad = optie(argv, "--pdf");
      const wbPad = optie(argv, "--werkbestand");
      const klant = optie(argv, "--klant") ?? (wbPad ? JSON.parse(leesTekst(wbPad)).klant : undefined);
      if (project === undefined || !pdfPad || !klant) return fout;
      const fullPath = `it-inventarisatie-${slugify(klant)}.pdf`;
      const api = at();
      const bestaand = (await api.get(`Projects/${project}/Attachments`)).items ?? [];
      if (bestaand.some((b) => String(b.fullPath ?? "").toLowerCase() === fullPath)) {
        return { code: 0, uitvoer: `${fullPath} staat al op project ${project}. Er wordt geen tweede bijlage geplaatst.\n` };
      }
      const data = Buffer.from(lees(pdfPad)).toString("base64");
      const body = { parentID: project, attachmentType: "FILE_ATTACHMENT", publish: 1, title: `IT-inventarisatie ${klant}`, fullPath, data };
      const omschrijving = `Bijlage "${body.title}" (${fullPath}, ${Math.round(data.length * 0.75 / 1024)} kB) op project ${project}.`;
      if (!toepassen) return { code: 0, uitvoer: `Voorvertoning: ${omschrijving}\nEr is niets geschreven; draai opnieuw met --toepassen na akkoord.\n` };
      await api.postProjectAttachment(project, body);
      return { code: 0, uitvoer: `Geplaatst: ${omschrijving}\n` };
    }
  } catch (e) {
    return { code: 2, uitvoer: `Mislukt: ${e.message}\n` };
  }
  return fout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(uitvoer);
  process.exitCode = code;
}
