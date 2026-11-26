// Controleert of JUICT via GDAP bij de Microsoft 365-omgeving van een klant kan (alleen lezen).
// Gebruikt het az-token van de ingelogde beheerder, net als m365-lookup; het token wordt nooit geprint.
// De GDAP-relaties zelf zijn met dat token niet te lezen, dus dit is een toegangsproef per onderdeel.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { haalToken as azToken } from "./m365-lookup.mjs";
import { lookupDomein } from "./dns-lookup.mjs";

const GRAPH = "https://graph.microsoft.com/";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Alleen wat met de az-token kan lukken (zie REFERENCE.md, Microsoft 365 via GDAP). Intune, SharePoint en
// security defaults lukken nooit met die token en zouden GDAP altijd als beperkt laten zien.
export const PROEVEN = [
  { naam: "organisatie", onderdeel: "Organisatie", url: "v1.0/organization?$select=id" },
  { naam: "gebruikers", onderdeel: "Gebruikers", url: "v1.0/users?$select=id&$top=1" },
  { naam: "licenties", onderdeel: "Licenties", url: "v1.0/subscribedSkus?$select=skuId" },
  { naam: "multifactor", onderdeel: "Multifactor-registratie", url: "beta/reports/authenticationMethods/userRegistrationDetails?$top=1" },
  { naam: "conditionalAccess", onderdeel: "Conditional Access", url: "v1.0/identity/conditionalAccess/policies?$select=id" },
  { naam: "beheerrollen", onderdeel: "Beheerrollen", url: "v1.0/directoryRoles?$select=id" },
];

const MELDING = {
  "actief": () => "GDAP-toegang werkt: de Microsoft 365-omgeving is uit te lezen.",
  "beperkt": (r) => `GDAP-toegang werkt, maar deze onderdelen zijn niet leesbaar: ${r.ontbreekt.join(", ")}. Vul de rollen in de GDAP-relatie aan.`,
  "geen-rechten": () => "Er is een relatie met de tenant, maar dit account kan niets uitlezen. Controleer of het account in de juiste GDAP-groep zit en welke rollen de relatie geeft.",
  "geen-toegang": () => "Geen GDAP-toegang: het verzoek is nog niet goedgekeurd door een beheerder van de klant, of nog niet verstuurd.",
  "geen-tenant": () => "Geen Microsoft 365-omgeving gevonden voor dit domein. GDAP volgt zodra de omgeving er is.",
  "niet-gecontroleerd": () => "Niet gecontroleerd: geen az-login. Log in met az login op de JUICT-tenant en draai de controle opnieuw.",
};

function vandaag(nu) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(nu);
}

function standaardAzIngelogd() {
  try {
    execFileSync("az", ["account", "show", "-o", "none"], { stdio: "ignore", shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
}

// Een token voor de klant-tenant krijg je alleen als er een relatie is. Is daarna niets leesbaar, dan geeft de
// relatie dit account geen leesrechten (niet in de juiste GDAP-groep of geen passende rollen).
export function bepaalStatus(proeven) {
  const ontbreekt = proeven.filter((p) => !p.ok).map((p) => p.onderdeel);
  if (ontbreekt.length === proeven.length) return { status: "geen-rechten", ontbreekt };
  return { status: ontbreekt.length ? "beperkt" : "actief", ontbreekt };
}

export async function controleer(tenantId, deps = {}) {
  const nu = deps.nu ?? new Date();
  const basis = { ok: true, tenantId, gecontroleerd: vandaag(nu) };
  const klaar = (status, extra = {}) => {
    const r = { ...basis, status, ontbreekt: [], proeven: [], ...extra };
    return { ...r, melding: MELDING[status](r) };
  };

  let token;
  try {
    token = (deps.haalToken ?? azToken)(tenantId);
  } catch {
    const ingelogd = (deps.azIngelogd ?? standaardAzIngelogd)();
    return klaar(ingelogd ? "geen-toegang" : "niet-gecontroleerd");
  }

  const doFetch = deps.fetch ?? globalThis.fetch;
  const proeven = [];
  for (const p of PROEVEN) {
    try {
      const res = await doFetch(GRAPH + p.url, { headers: { Authorization: `Bearer ${token}` } });
      proeven.push(res.ok ? { naam: p.naam, onderdeel: p.onderdeel, ok: true } : { naam: p.naam, onderdeel: p.onderdeel, ok: false, fout: String(res.status) });
    } catch {
      proeven.push({ naam: p.naam, onderdeel: p.onderdeel, ok: false, fout: "netwerk" });
    }
  }
  const { status, ontbreekt } = bepaalStatus(proeven);
  return klaar(status, { ontbreekt, proeven });
}

export async function hoofd(argv, deps = {}) {
  const i = argv.indexOf("--tenant");
  const tenant = i >= 0 ? argv[i + 1] : undefined;
  if (!tenant) return { code: 1, uitvoer: JSON.stringify({ ok: false, reden: "Gebruik: gdap-check.mjs --tenant <guid|domein>" }) };

  let tenantId = tenant;
  let domein = null;
  if (!GUID.test(tenant)) {
    domein = tenant;
    const res = await (deps.lookupDomein ?? lookupDomein)(tenant);
    tenantId = res?.tenantId ?? null;
    if (!tenantId) {
      const nu = deps.nu ?? new Date();
      const r = { ok: true, tenantId: null, domein, gecontroleerd: vandaag(nu), status: "geen-tenant", ontbreekt: [], proeven: [] };
      return { code: 0, uitvoer: JSON.stringify({ ...r, melding: MELDING["geen-tenant"](r) }, null, 2) };
    }
  }
  const r = await controleer(tenantId, deps);
  return { code: 0, uitvoer: JSON.stringify(domein ? { ...r, domein } : r, null, 2) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  console.log(uitvoer);
  process.exitCode = code;
}
