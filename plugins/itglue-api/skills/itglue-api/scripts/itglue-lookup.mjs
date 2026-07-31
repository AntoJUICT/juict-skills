#!/usr/bin/env node
// Standalone read-only IT Glue lookup-CLI. Geen npm-deps; Node 18+ (fetch ingebouwd).
// Key uit Key Vault via `az`, met env-var fallback. Nooit de key of een wachtwoord loggen.
//
// Harde regel: wachtwoordwaarden worden niet opgehaald. Onze API-key heeft geen
// password-access, en een wachtwoord in een transcript is een incident. Bij een
// wachtwoordvraag levert dit script alleen de naam van het item en een deeplink.

export const BASE_URL = process.env.ITGLUE_BASE_URL ?? "https://api.eu.itglue.com";
export const PORTAL_URL = process.env.ITGLUE_PORTAL_URL ?? "https://juict.eu.itglue.com";

const RECHTSVORMEN = /\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|holding|group|groep)\b/g;

export function normalizeOrgName(naam) {
  return String(naam ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(RECHTSVORMEN, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Strikte vergelijking: alleen leestekens/hoofdletters weg, rechtsvorm-woorden (bv, holding, ...)
// blijven staan. Nodig omdat normalizeOrgName() die woorden juist wegstript voor fuzzy-zoeken,
// waardoor "JUICT B.V." en "JUICT Holding B.V." anders ten onrechte identiek normaliseren en
// een echte, onderscheidende naam (Holding) als exacte match zou worden gezien.
function strikteNaam(naam) {
  return String(naam ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function pickExactOrg(orgs, zoekterm) {
  const lijst = orgs ?? [];

  // Eerste, strikte poging: naam op naam, zonder rechtsvorm-woorden weg te strippen.
  const doelStrikt = strikteNaam(zoekterm);
  const exactStrikt = lijst.filter((o) => strikteNaam(o?.attributes?.name) === doelStrikt);
  if (exactStrikt.length === 1) return { match: exactStrikt[0], kandidaten: [] };

  // Terugval: losse vergelijking op de volledig genormaliseerde naam (rechtsvorm eraf).
  const doel = normalizeOrgName(zoekterm);
  const exact = lijst.filter((o) => normalizeOrgName(o?.attributes?.name) === doel);
  if (exact.length === 1) return { match: exact[0], kandidaten: [] };
  return { match: null, kandidaten: exact.length > 1 ? exact : lijst };
}

// Individuele password-resource: /passwords/{id}. Collecties en de relationships-variant
// eindigen op "passwords" en hebben dus geen segment erna.
const VERBODEN_PASSWORD_PAD = /(^|\/)passwords\/[^/#]+/i;

// Alleen voor de blokkade-controle, niet voor het teruggegeven pad: %2f/%2F is een
// gecodeerde slash en dubbele/drievoudige slashes tellen voor een server hetzelfde als één.
// Zonder deze normalisatie is de regex hierboven te omzeilen met "/passwords//12345" of
// "/passwords%2F12345". Bewust geen decodeURIComponent() op het hele pad: dat gooit op een
// losse "%" (bijv. "100%" in een filterwaarde) en kan andere tekens ongewenst veranderen.
// Deze vervanging is een letterlijke, veilige string-replace die nooit kan gooien.
function padVoorControle(pad) {
  return String(pad ?? "")
    .replace(/%2f/gi, "/")
    .replace(/\/{2,}/g, "/");
}

export function assertPathAllowed(path) {
  const p = String(path ?? "");
  const teControleren = padVoorControle(p);
  const padZonderQuery = teControleren.split("?")[0];
  if (VERBODEN_PASSWORD_PAD.test(padZonderQuery)) {
    throw new Error(
      "Geblokkeerd: de individuele password-resource mag niet opgevraagd worden. " +
        "Onze API-key heeft geen password-access. Gebruik het collectie-endpoint om het " +
        "item te vinden en lever de deeplink via passwordDeeplink()."
    );
  }
  if (/show_password/i.test(teControleren)) {
    throw new Error("Geblokkeerd: de parameter show_password is niet toegestaan.");
  }
  return p;
}

export function passwordDeeplink(orgId, passwordId, portal = PORTAL_URL) {
  if (orgId === null || orgId === undefined || orgId === "") {
    throw new Error("passwordDeeplink vereist een orgId");
  }
  if (passwordId === null || passwordId === undefined || passwordId === "") {
    throw new Error("passwordDeeplink vereist een passwordId");
  }
  return `${String(portal).replace(/\/+$/, "")}/${orgId}/passwords/${passwordId}`;
}

// Bewust een whitelist: er komen alleen naam en link uit, wat de input ook bevat.
export function passwordTreffers(items, orgId, zoekterm, portal = PORTAL_URL) {
  const term = String(zoekterm ?? "").toLowerCase();
  return (items ?? [])
    .filter((item) => {
      if (!term) return true;
      return String(item?.attributes?.name ?? "").toLowerCase().includes(term);
    })
    .map((item) => ({
      naam: item?.attributes?.name ?? "(naamloos)",
      link: passwordDeeplink(item?.attributes?.["organization-id"] ?? orgId, item?.id, portal),
    }));
}

export function buildQuery(filters = {}, { pageSize, pageNumber } = {}) {
  const params = new URLSearchParams();
  for (const [sleutel, waarde] of Object.entries(filters ?? {})) {
    if (waarde === undefined || waarde === null || waarde === "") continue;
    params.append(`filter[${sleutel}]`, String(waarde));
  }
  if (pageSize) params.append("page[size]", String(pageSize));
  if (pageNumber) params.append("page[number]", String(pageNumber));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function redactSecrets(tekst, key) {
  if (!key) return String(tekst);
  return String(tekst).split(key).join("[REDACTED]");
}
