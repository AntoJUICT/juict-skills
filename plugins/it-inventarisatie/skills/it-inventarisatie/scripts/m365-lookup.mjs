// Microsoft 365-lookup via GDAP (alleen lezen). Gebruikt het az-token van de ingelogde
// beheerder; het token wordt nooit geprint, gelogd of weggeschreven. Geen npm-deps.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { scrubSecrets } from "./geheimen.mjs";
import { lookupDomein } from "./dns-lookup.mjs";

const GRAPH = "https://graph.microsoft.com/";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REDEN_GEEN_TOEGANG = "Geen GDAP-toegang of az-login voor deze tenant";

export const GRAPH_CALLS = [
  { naam: "organization", url: "v1.0/organization" },
  { naam: "domains", url: "v1.0/domains" },
  { naam: "subscribedSkus", url: "v1.0/subscribedSkus" },
  { naam: "users", url: "v1.0/users?$select=displayName,userPrincipalName,accountEnabled,userType,assignedLicenses,createdDateTime&$top=999" },
  { naam: "signins", url: "beta/users?$select=userPrincipalName,signInActivity&$top=999" },
  { naam: "mfa", url: "beta/reports/authenticationMethods/userRegistrationDetails?$top=999" },
  { naam: "groups", url: "v1.0/groups?$select=displayName,groupTypes,securityEnabled,mailEnabled&$top=999" },
  { naam: "devices", url: "v1.0/devices?$select=displayName,operatingSystem,trustType,isCompliant,approximateLastSignInDateTime&$top=999" },
  { naam: "conditionalAccess", url: "v1.0/identity/conditionalAccess/policies" },
  { naam: "directoryRoles", url: "v1.0/directoryRoles?$expand=members" },
];

export const SKU_NAMEN = {
  SPB: "Microsoft 365 Business Premium",
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  ENTERPRISEPACK: "Office 365 E3",
  EXCHANGESTANDARD: "Exchange Online Plan 1",
  EXCHANGEENTERPRISE: "Exchange Online Plan 2",
  SPE_F1: "Microsoft 365 F3",
  INTUNE_A_D: "Intune-apparaat",
  Microsoft_365_Copilot: "Copilot",
};

const GRATIS_SKUS = new Set(["FLOW_FREE", "POWER_BI_STANDARD", "WINDOWS_STORE", "RMSBASIC"]);

export function haalToken(tenantId, exec = execFileSync) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(tenantId))) throw new Error("ongeldige tenant");
  const args = ["account", "get-access-token", "--tenant", String(tenantId), "--resource-type", "ms-graph", "--query", "accessToken", "-o", "tsv"];
  // Op Windows is az een .cmd-bestand; de tenant is hierboven op tekens gecontroleerd.
  const uit = exec("az", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" });
  const token = String(uit).trim();
  if (!token) throw new Error("leeg token");
  return token;
}

export async function haalRuw(tenantId, { fetch: doFetch = globalThis.fetch, token } = {}) {
  const uit = {};
  for (const { naam, url } of GRAPH_CALLS) {
    try {
      let volgende = GRAPH + url;
      let waarden = [];
      let fout = null;
      for (let pagina = 0; volgende && pagina < 50; pagina++) {
        const res = await doFetch(volgende, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { fout = String(res.status); break; }
        const json = await res.json();
        waarden = waarden.concat(json.value ?? []);
        const nl = json["@odata.nextLink"];
        volgende = typeof nl === "string" && nl.startsWith(GRAPH) ? nl : null;
      }
      uit[naam] = fout ? { fout } : { value: waarden };
    } catch {
      uit[naam] = { fout: "netwerk" };
    }
  }
  return uit;
}

function datum(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const delen = Object.fromEntries(
    new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", day: "2-digit", month: "2-digit", year: "numeric" })
      .formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${delen.day}-${delen.month}-${delen.year}`;
}

const lijst = (x) => (x && !x.fout && Array.isArray(x.value) ? x.value : null);

export function vatSamen(ruw, nu = new Date()) {
  const nietOpgehaald = new Set();
  for (const { naam } of GRAPH_CALLS) if (!ruw[naam]) nietOpgehaald.add(naam);
  for (const [naam, v] of Object.entries(ruw)) if (v?.fout) nietOpgehaald.add(naam);

  const skus = lijst(ruw.subscribedSkus) ?? [];
  const skuNaam = new Map(skus.map((s) => [s.skuId, s.skuPartNumber]));
  const weergave = (code) => SKU_NAMEN[code] ?? code;

  const signins = new Map((lijst(ruw.signins) ?? []).map((s) => [String(s.userPrincipalName).toLowerCase(), s.signInActivity ?? {}]));
  const mfaLijst = lijst(ruw.mfa);
  const mfa = new Map((mfaLijst ?? []).map((m) => [String(m.userPrincipalName).toLowerCase(), m.isMfaRegistered]));

  const apparaten = lijst(ruw.devices) ?? [];
  const grens = nu.getTime() - 180 * 24 * 3600 * 1000;

  return {
    organisatie: lijst(ruw.organization)?.[0]?.displayName ?? null,
    domeinen: (lijst(ruw.domains) ?? []).map((d) => ({ naam: d.id, standaard: d.isDefault === true })),
    licenties: skus
      .filter((s) => !GRATIS_SKUS.has(s.skuPartNumber))
      .map((s) => ({ sku: s.skuPartNumber, naam: weergave(s.skuPartNumber), totaal: s.prepaidUnits?.enabled ?? 0, inGebruik: s.consumedUnits ?? 0 })),
    gebruikers: (lijst(ruw.users) ?? []).map((u) => {
      const sleutel = String(u.userPrincipalName).toLowerCase();
      const act = signins.get(sleutel) ?? {};
      return {
        naam: u.displayName,
        upn: u.userPrincipalName,
        actief: u.accountEnabled === true,
        licenties: (u.assignedLicenses ?? [])
          .map((l) => skuNaam.get(l.skuId))
          .filter((c) => c && !GRATIS_SKUS.has(c))
          .map(weergave),
        laatsteAanmelding: datum(act.lastSignInDateTime ?? act.lastSuccessfulSignInDateTime),
        mfa: typeof mfa.get(sleutel) === "boolean" ? mfa.get(sleutel) : null,
      };
    }),
    apparaten: {
      totaal: apparaten.length,
      entraJoined: apparaten.filter((a) => a.trustType === "AzureAd").length,
      compliant: apparaten.filter((a) => a.isCompliant === true).length,
      verouderd: apparaten.filter((a) => {
        const t = a.approximateLastSignInDateTime ? new Date(a.approximateLastSignInDateTime).getTime() : NaN;
        return Number.isNaN(t) || t < grens;
      }).length,
    },
    conditionalAccess: (lijst(ruw.conditionalAccess) ?? []).map((p) => ({ naam: p.displayName, staat: p.state })),
    beheerders: (lijst(ruw.directoryRoles) ?? []).map((r) => ({ rol: r.displayName, leden: (r.members ?? []).map((m) => m.displayName ?? m.userPrincipalName).filter(Boolean) })),
    nietOpgehaald: [...nietOpgehaald],
  };
}

export function kortOverzicht(s, uitPad) {
  return {
    ok: true,
    uit: uitPad,
    aantallen: {
      domeinen: s.domeinen.length,
      licenties: s.licenties.length,
      gebruikers: s.gebruikers.length,
      apparaten: s.apparaten.totaal,
      conditionalAccess: s.conditionalAccess.length,
      beheerrollen: s.beheerders.length,
    },
    nietOpgehaald: s.nietOpgehaald,
  };
}

export async function hoofd(argv, deps = {}) {
  const i = argv.indexOf("--tenant");
  const tenant = i >= 0 ? argv[i + 1] : undefined;
  const j = argv.indexOf("--uit");
  const uitPad = j >= 0 ? argv[j + 1] : undefined;
  if (!tenant) return { code: 1, uitvoer: JSON.stringify({ ok: false, reden: "Gebruik: m365-lookup.mjs --tenant <guid|domein> [--uit <pad>]" }) };

  const geenToegang = { code: 2, uitvoer: JSON.stringify({ ok: false, reden: REDEN_GEEN_TOEGANG }) };
  let tenantId = tenant;
  if (!GUID.test(tenant)) {
    const res = await (deps.lookupDomein ?? lookupDomein)(tenant);
    tenantId = res?.tenantId;
    if (!tenantId) return { code: 2, uitvoer: JSON.stringify({ ok: false, reden: "Tenant niet gevonden voor dit domein" }) };
  }

  let token;
  try {
    token = haalToken(tenantId, deps.exec);
  } catch {
    return geenToegang;
  }
  const ruw = await haalRuw(tenantId, { fetch: deps.fetch, token });
  const samenvatting = scrubSecrets(vatSamen(ruw, deps.nu));
  const uitvoer = JSON.stringify(samenvatting, null, 2);
  if (!uitPad) return { code: 0, uitvoer };
  (deps.schrijf ?? writeFileSync)(uitPad, uitvoer);
  // Met --uit staat alles in het bestand; op stdout alleen tellingen, zonder namen of adressen.
  return { code: 0, uitvoer: JSON.stringify(kortOverzicht(samenvatting, uitPad), null, 2) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, uitvoer } = await hoofd(process.argv.slice(2));
  console.log(uitvoer);
  process.exitCode = code;
}
