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

const GEBLOKKEERD_PASSWORD =
  "Geblokkeerd: de individuele password-resource mag niet opgevraagd worden. " +
  "Onze API-key heeft geen password-access. Gebruik het collectie-endpoint om het " +
  "item te vinden en lever de deeplink via passwordDeeplink().";
const GEBLOKKEERD_SHOW_PASSWORD = "Geblokkeerd: de parameter show_password is niet toegestaan.";
const GEBLOKKEERD_ONPARSEERBAAR =
  "Geblokkeerd: het pad kon niet als URL geïnterpreteerd worden en wordt daarom geweigerd " +
  "(fail closed) — een pad dat we niet kunnen beoordelen laten we niet door.";

// Alleen voor de goedkope voorcontrole, niet voor het teruggegeven pad: %2f/%2F en %5c/%5C
// zijn gecodeerde scheidingstekens die de WHATWG URL-parser hieronder NIET decodeert (die
// laat percent-encoding in het pad met rust), maar die IT Glue's eigen server mogelijk wel
// als "/" interpreteert. Dubbele/drievoudige letterlijke slashes horen hier ook bij. Bewust
// geen decodeURIComponent() op het hele pad: dat gooit op een losse "%" (bijv. "100%" in een
// filterwaarde). Alle vervangingen hieronder zijn letterlijke, veilige string-replaces die
// nooit kunnen gooien. Backslash wordt eerst omgezet, vóór de slash-samenvoeging, anders
// glipt "/passwords\/12345" er nog tussendoor.
function padVoorControle(pad) {
  return String(pad ?? "")
    .replace(/\\/g, "/")
    .replace(/%5c/gi, "/")
    .replace(/%2f/gi, "/")
    .replace(/\/{2,}/g, "/");
}

// Vaste, veilige basis om de controle-URL te bouwen — expliciet LOS van BASE_URL/ITGLUE_BASE_URL.
// Die env var komt uit configuratie en zou in theorie iets geks kunnen bevatten (een pad, een
// vreemde host); de blokkade mag daar niet van afhangen. Alleen een geldige absolute basis is
// nodig zodat een relatief pad hetzelfde resolved als tegen een root-basis als BASE_URL. ".invalid"
// is gereserveerd (RFC 2606) en resolved bewust nooit ergens naartoe.
const CONTROLE_BASIS = "https://itglue-guard.invalid/";

// Gezaghebbende controle: bouwt de URL exact zoals de netwerklaag straks doet (new URL(pad, base))
// en toetst op wat fetch() daadwerkelijk gebruikt. Dat vangt automatisch alles wat de WHATWG
// URL-parser normaliseert of stript — tab/newline/CR worden overal uit de invoer verwijderd
// (spec-gedrag, ook midden in "passwords"), en een letterlijke backslash wordt naar "/" omgezet —
// zonder dat wij zelf een zwarte lijst van zulke tekens moeten bijhouden.
function heeftVerbodenPasswordSegment(pathname) {
  const segmenten = pathname.toLowerCase().split("/").filter(Boolean);
  const index = segmenten.indexOf("passwords");
  // Alleen een segment ná "passwords" is verboden: "/passwords", "/passwords/" (collectie) en
  // ".../relationships/passwords" (passwords is dan het laatste segment) blijven toegestaan.
  return index !== -1 && index < segmenten.length - 1;
}

export function assertPathAllowed(path) {
  const p = String(path ?? "");

  // Laag 1: goedkope voorcontrole op de ruwe string (vangt %2f/%5c, zie padVoorControle hierboven).
  const teControleren = padVoorControle(p);
  const padZonderQuery = teControleren.split("?")[0];
  if (VERBODEN_PASSWORD_PAD.test(padZonderQuery)) {
    throw new Error(GEBLOKKEERD_PASSWORD);
  }
  if (/show_password/i.test(teControleren)) {
    throw new Error(GEBLOKKEERD_SHOW_PASSWORD);
  }

  // Laag 2: de gezaghebbende controle op de daadwerkelijk geparseerde URL. Fail closed: een pad
  // dat niet te parsen is, keuren we niet goed.
  let url;
  try {
    url = new URL(p, CONTROLE_BASIS);
  } catch {
    throw new Error(GEBLOKKEERD_ONPARSEERBAAR);
  }
  if (heeftVerbodenPasswordSegment(url.pathname)) {
    throw new Error(GEBLOKKEERD_PASSWORD);
  }
  // Case-insensitief en op de gedecodeerde parameternaam, zodat bijv. show%5Fpassword ook telt.
  for (const sleutel of url.searchParams.keys()) {
    if (sleutel.toLowerCase() === "show_password") {
      throw new Error(GEBLOKKEERD_SHOW_PASSWORD);
    }
  }

  // Beide lagen akkoord: geef het oorspronkelijke, byte-identieke pad terug. De netwerklaag
  // bouwt daar de echte request-URL mee, niet met de genormaliseerde controle-versie.
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
