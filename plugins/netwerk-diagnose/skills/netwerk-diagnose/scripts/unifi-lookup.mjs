#!/usr/bin/env node
// Standalone read-only UniFi-lookup voor netwerkdiagnose. Geen npm-deps; Node 18+ (fetch ingebouwd).
// Secrets uit Key Vault (az, env, of de Python-SDK-helper). Nooit een secret of wifi-wachtwoord loggen.
//
// Twee harde regels, in code afgedwongen:
// 1. Alleen lezen. Elk verzoek gaat langs assertVerzoekToegestaan(); wat niet op de allowlist staat,
//    wordt geweigerd voordat het verstuurd wordt.
// 2. Geheimen eruit. Elke respons gaat door redactUnifi() voordat iets wordt teruggegeven of geprint.
//    Een readonly-account krijgt x_passphrase nu niet terug, maar een ander account of een andere
//    controllerversie wel; daar rekenen we niet op.

import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

export const SITE_ID_RE = /^[a-z0-9]{1,64}$/;

const GEHEIME_SLEUTELS = new Set([
  "password",
  "passphrase",
  "secret",
  "psk",
  "wpa_psk",
  "radius_secret",
  "shared_secret",
  "private_preshared_keys",
]);

export function isGeheimeSleutel(sleutel) {
  const k = String(sleutel).toLowerCase();
  return k.startsWith("x_") || GEHEIME_SLEUTELS.has(k) || k.endsWith("_secret") || k.endsWith("_password");
}

export function redactUnifi(waarde) {
  if (Array.isArray(waarde)) return waarde.map(redactUnifi);
  if (waarde && typeof waarde === "object") {
    const uit = {};
    for (const [k, v] of Object.entries(waarde)) {
      if (!isGeheimeSleutel(k)) uit[k] = redactUnifi(v);
    }
    return uit;
  }
  return waarde;
}

export function normaliseerPad(pad) {
  let p = String(pad ?? "");
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  // Herhaald decoderen tot het pad niet meer verandert, zodat %252F niet als omweg werkt.
  let vorige;
  do {
    vorige = p;
    try {
      p = decodeURIComponent(p);
    } catch {
      throw new Error(`Ongeldig pad (codering): ${pad}`);
    }
  } while (p !== vorige);
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (p.split("/").some((s) => s === ".." || s === ".")) {
    throw new Error(`Pad met '..' of '.' geweigerd: ${pad}`);
  }
  return p;
}

const SITE = "[a-z0-9]{1,64}";
const TOEGESTAAN = [
  ["GET", new RegExp("^/api/self/sites$")],
  ["GET", new RegExp(`^/api/s/${SITE}/stat/(device|sta|alluser)$`)],
  ["GET", new RegExp(`^/api/s/${SITE}/rest/wlanconf$`)],
  ["POST", new RegExp("^/api/login$")],
  ["POST", new RegExp("^/api/logout$")],
  ["POST", new RegExp(`^/v2/api/site/${SITE}/system-log/all$`)],
];

export function assertVerzoekToegestaan(methode, pad) {
  const m = String(methode ?? "").toUpperCase();
  const p = normaliseerPad(pad);
  if (!TOEGESTAAN.some(([tm, re]) => tm === m && re.test(p))) {
    throw new Error(`Geweigerd: ${m} ${pad} staat niet op de read-only allowlist van unifi-lookup.`);
  }
  return p;
}

// Sitenamen hebben het formaat "<Klantnaam> (<IT Glue-organisatie-ID>)". UniFi kapt de omschrijving af
// op 64 tekens; dan valt het ID (deels) weg en is alleen de naamroute bruikbaar. Een afgekapt ID mag
// nooit gedeeltelijk matchen, daarom alleen volledige "(cijfers)" met sluithaakje.
export function parseItglueId(desc) {
  const treffers = [...String(desc ?? "").matchAll(/\((\d{6,})\)/g)];
  return treffers.length ? treffers[treffers.length - 1][1] : null;
}

export function siteNaam(desc) {
  return String(desc ?? "")
    .replace(/\s*\(\d{6,}\)/g, "")
    .replace(/\s*\(\d*$/, "")
    .trim();
}

const RECHTSVORMEN = /(^|\s)(b\.?\s?v\.?|n\.?\s?v\.?|v\.?\s?o\.?\s?f\.?)(?=\s|$)/g;

export function normaliseerNaam(naam) {
  return String(naam ?? "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(RECHTSVORMEN, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function siteRij(site) {
  return {
    site: site.name,
    naam: siteNaam(site.desc),
    itglueId: parseItglueId(site.desc),
    apparaten: site.device_count ?? null,
  };
}

export function resolveSite(sites, zoekterm) {
  const term = String(zoekterm ?? "").trim();
  if (!term) throw new Error("Geef een site op: IT Glue-organisatie-ID, korte site-ID of (deel van de) naam.");
  const lijst = (sites ?? []).map(siteRij);

  if (/^\d+$/.test(term)) {
    const m = lijst.filter((s) => s.itglueId === term);
    if (m.length === 1) return { via: "itglue-id", match: m[0], kandidaten: [] };
    if (m.length > 1) return { via: "itglue-id", match: null, kandidaten: m };
    // Geen IT Glue ID match; probeer short site-ID fallthrough
    const opId = lijst.filter((s) => s.site === term.toLowerCase());
    if (opId.length === 1) return { via: "site-id", match: opId[0], kandidaten: [] };
    return { via: "itglue-id", match: null, kandidaten: [] };
  }

  const opId = lijst.filter((s) => s.site === term.toLowerCase());
  if (opId.length === 1) return { via: "site-id", match: opId[0], kandidaten: [] };

  const doel = normaliseerNaam(term);
  const exact = lijst.filter((s) => normaliseerNaam(s.naam) === doel);
  if (exact.length === 1) return { via: "naam", match: exact[0], kandidaten: [] };
  if (exact.length > 1) return { via: "naam", match: null, kandidaten: exact };

  const deel = lijst.filter((s) => normaliseerNaam(s.naam).includes(doel));
  if (deel.length === 1) return { via: "naam", match: deel[0], kandidaten: [] };
  return { via: "naam", match: null, kandidaten: deel };
}

const NL_TIJD = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

export function tijdNL(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return null;
  return NL_TIJD.format(new Date(ms)).replace(",", "");
}

// DFS bestaat alleen op 5 GHz ("na"). Zonder opgegeven band (radio undefined) geldt alleen het
// kanaalbereik, zodat aanroepers die enkel het kanaal doorgeven hetzelfde gedrag houden.
export function isDfsKanaal(kanaal, radio) {
  if (radio !== undefined && radio !== "na") return false;
  const k = Number(kanaal);
  return Number.isFinite(k) && k >= 52 && k <= 144;
}

export function beoordeelSignaal(dbm) {
  if (dbm === null || dbm === undefined || !Number.isFinite(Number(dbm))) return "onbekend";
  const s = Number(dbm);
  if (s >= -67) return "goed";
  if (s >= -75) return "krap";
  if (s >= -80) return "slecht";
  return "onbruikbaar";
}

const BAND = { ng: "2,4 GHz", na: "5 GHz", "6e": "6 GHz" };

function breedte(stat, radio) {
  if (Number.isFinite(stat?.bw)) return stat.bw;
  const n = Number(String(radio?.ht ?? "").replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function samenvattingApparaten(devices) {
  return (devices ?? []).map((d) => {
    const radios = (d.radio_table_stats ?? []).map((st) => {
      const rt = (d.radio_table ?? []).find((r) => r.name === st.name) ?? {};
      const max = rt.max_txpower ?? null;
      const tx = st.tx_power ?? null;
      return {
        radio: st.radio,
        band: BAND[st.radio] ?? st.radio,
        kanaal: st.channel ?? null,
        breedte: breedte(st, rt),
        dfs: isDfsKanaal(st.channel, st.radio),
        zendvermogen: tx,
        maxZendvermogen: max,
        ruimte: max !== null && tx !== null ? max - tx : null,
        clients: st.num_sta ?? null,
        kanaalbezetting: st.cu_total ?? null,
        retriesPct: st.tx_retries_pct ?? null,
        minRssi: rt.min_rssi_enabled ? rt.min_rssi ?? null : null,
      };
    });
    return {
      naam: d.name ?? d.mac,
      type: d.type ?? null,
      model: d.model ?? null,
      mac: d.mac ?? null,
      firmware: d.version ?? null,
      upgradeBeschikbaar: Boolean(d.upgradable),
      uptimeDagen: Number.isFinite(d.uptime) ? Math.round(d.uptime / 86400) : null,
      online: d.state === 1,
      clients: d.num_sta ?? 0,
      radios,
    };
  });
}

export function samenvattingClients(stas, devices) {
  const apNaam = new Map((devices ?? []).map((d) => [d.mac, d.name]));
  return (stas ?? [])
    .filter((c) => !c.is_wired)
    .map((c) => ({
      naam: c.name || c.hostname || c.mac,
      mac: c.mac ?? null,
      ip: c.ip ?? null,
      ap: apNaam.get(c.ap_mac) ?? c.ap_mac ?? null,
      band: BAND[c.radio] ?? c.radio ?? null,
      kanaal: c.channel ?? null,
      signaal: c.signal ?? null,
      beoordeling: beoordeelSignaal(c.signal),
      ssid: c.essid ?? null,
      uptimeMin: Number.isFinite(c.uptime) ? Math.round(c.uptime / 60) : null,
      roams: c.roam_count ?? null,
      retriesPct: c.wifi_tx_retries_percentage ?? null,
      satisfaction: c.satisfaction ?? null,
    }));
}

function minRateMbps(aan, kbps) {
  const n = typeof kbps === "number" ? kbps : Number.NaN;
  return aan && Number.isFinite(n) ? n / 1000 : null;
}

// Bewust een whitelist van velden: wat hier niet genoemd wordt, komt ook niet in de uitvoer.
export function samenvattingWlans(wlans) {
  return (wlans ?? []).map((w) => ({
    ssid: w.name ?? null,
    aan: w.enabled !== false,
    beveiliging: [w.security, w.wpa_mode].filter(Boolean).join("/") || null,
    band: w.wlan_band ?? null,
    fastRoaming80211r: Boolean(w.fast_roaming_enabled),
    bssTransition80211v: Boolean(w.bss_transition),
    roamingAssistant5: w.roaming_assistant_na_enabled ? w.roaming_assistant_na_rssi ?? null : null,
    minRate24: minRateMbps(w.minrate_ng_enabled, w.minrate_ng_data_rate_kbps),
    minRate5: minRateMbps(w.minrate_na_enabled, w.minrate_na_data_rate_kbps),
    pmf: w.pmf_mode ?? null,
    uapsd: Boolean(w.uapsd_enabled),
  }));
}

const EVENT_SOORT = {
  CLIENT_ROAMED: "roam",
  CLIENT_CONNECTED_WIRELESS: "verbonden",
  CLIENT_DISCONNECTED_WIRELESS: "verbroken",
  CLIENT_CONNECTED_WIRED: "verbonden (kabel)",
  CLIENT_DISCONNECTED_WIRED: "verbroken (kabel)",
};

function getal(param) {
  const n = parseFloat(String(param?.name ?? ""));
  return Number.isFinite(n) ? n : null;
}

export function eventsPlat(events) {
  return (events ?? [])
    .map((e) => {
      const p = e.parameters ?? {};
      const roam = e.event === "CLIENT_ROAMED";
      return {
        ts: e.timestamp,
        tijd: tijdNL(e.timestamp),
        soort: EVENT_SOORT[e.event] ?? e.event,
        toestel: p.CLIENT?.name || p.CLIENT?.hostname || p.CLIENT?.id || null,
        mac: p.CLIENT?.id ?? null,
        vanAp: roam ? p.DEVICE_FROM?.name ?? null : null,
        naarAp: roam ? p.DEVICE_TO?.name ?? null : p.DEVICE?.name ?? null,
        signaalVoor: roam ? getal(p.PREVIOUS_SIGNAL_STRENGTH) : null,
        signaal: getal(p.SIGNAL_STRENGTH),
        band: p.RADIO_BAND?.name ?? null,
        ssid: p.WLAN?.name ?? null,
        duur: p.DURATION?.name ?? null,
      };
    })
    .sort((a, b) => {
      const aFinite = Number.isFinite(a.ts);
      const bFinite = Number.isFinite(b.ts);
      if (aFinite && !bFinite) return -1;
      if (!aFinite && bFinite) return 1;
      if (aFinite && bFinite) return a.ts - b.ts;
      return 0;
    });
}

export function matchToestel(rijen, zoek) {
  const z = String(zoek ?? "").trim().toLowerCase();
  if (!z) return [];
  return (rijen ?? []).filter(
    (r) =>
      [r.naam, r.mac, r.ip].some((v) => v != null && String(v).toLowerCase() === z) ||
      String(r.naam ?? "").toLowerCase().includes(z)
  );
}

export const VAULT = "juict-shared-kv";
export const SECRETS = { url: "UNIFI-URL", user: "UNIFI-USER", pass: "UNIFI-PASS" };
export const ENV_VARS = { url: "UNIFI_URL", user: "UNIFI_USER", pass: "UNIFI_PASS" };
const KV_HELPER = resolve(dirname(fileURLToPath(import.meta.url)), "kv-secret.py");
const STANDAARD_PYTHON = process.platform === "win32" ? "python" : "python3";
const STIL = { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 };

// Volgorde: az (zoals de andere juict-skills), dan env var, dan de Python-SDK-helper voor omgevingen
// waar de az keyvault-route niet beschikbaar is. Foutmeldingen bevatten nooit een waarde, alleen welke
// route faalde.
export const KV_ROUTES = ["auto", "python"];

// route "python" slaat az over. Bedoeld voor omgevingen waar de az keyvault-opdracht bewust geblokkeerd
// is: dan roepen we hem ook niet via een subproces aan.
export function haalSecretOp(soort, { env = process.env, run = execFileSync, python = STANDAARD_PYTHON, route = "auto", platform = process.platform } = {}) {
  const naam = SECRETS[soort];
  const envNaam = ENV_VARS[soort];
  if (!naam) throw new Error(`Onbekend secret-soort: ${soort}`);
  if (!KV_ROUTES.includes(route)) throw new Error(`--kv moet een van ${KV_ROUTES.join(", ")} zijn.`);
  const fouten = [];

  if (route === "auto") {
    try {
      const args = ["keyvault", "secret", "show", "--vault-name", VAULT, "--name", naam, "--query", "value", "-o", "tsv"];
      const v = String(
        platform === "win32"
          ? run("cmd.exe", ["/d", "/s", "/c", "az", ...args], STIL)
          : run("az", args, STIL)
      ).trim();
      if (v) return v;
      fouten.push("az gaf een lege waarde");
    } catch {
      fouten.push("az keyvault lukte niet");
    }
  }

  if (env[envNaam]) return env[envNaam];
  fouten.push(`env var ${envNaam} is niet gezet`);

  try {
    const v = String(run(python, [KV_HELPER, naam], STIL)).trim();
    if (v) return v;
    fouten.push("kv-secret.py gaf een lege waarde");
  } catch {
    fouten.push("kv-secret.py lukte niet");
  }

  throw new Error(
    `Secret ${naam} niet op te halen (${fouten.join("; ")}). Routes: ` +
      `(1) az login met leesrechten op Key Vault ${VAULT}; ` +
      `(2) env var ${envNaam}; ` +
      `(3) Python 3 met azure-identity en azure-keyvault-secrets voor scripts/kv-secret.py.`
  );
}

export function haalAlleSecrets(opts = {}) {
  return { url: haalSecretOp("url", opts), user: haalSecretOp("user", opts), pass: haalSecretOp("pass", opts) };
}

export class EndpointOntbreekt extends Error {
  constructor(pad) {
    super(`Endpoint ${pad} geeft 404 op deze controller. UniFi wijzigt endpoints tussen versies; zie LESSONS.md.`);
    this.name = "EndpointOntbreekt";
    this.pad = pad;
  }
}

async function leesJson(r, pad) {
  if (r.status === 404) throw new EndpointOntbreekt(pad);
  if (!r.ok) throw new Error(`HTTP ${r.status} op ${pad}`);
  return redactUnifi(await r.json());
}

function lijst(j) {
  if (Array.isArray(j)) return j;
  return Array.isArray(j?.data) ? j.data : [];
}

function cookiesUit(headers) {
  const ruw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return ruw.map((c) => c.split(";")[0]).join("; ");
}

// TLS-verificatie staat aan via de standaard fetch; er is bewust geen optie om dat uit te zetten.
export function maakClient({ baseUrl, user, pass, fetchFn = fetch }) {
  const basis = String(baseUrl ?? "").replace(/\/+$/, "");
  let cookie = null;
  let csrf = null;

  async function verzoek(methode, pad, body) {
    let protocol;
    try {
      protocol = new URL(basis).protocol;
    } catch {
      protocol = null;
    }
    if (protocol !== "https:") throw new Error("De controller-URL moet met https:// beginnen; inloggen over http is geweigerd.");
    const gecontroleerd = assertVerzoekToegestaan(methode, pad);
    // Wat de poort valideert is precies wat over de lijn gaat: genormaliseerd pad + originele query.
    const q = pad.indexOf("?");
    const query = q >= 0 ? pad.slice(q) : "";
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-Csrf-Token"] = csrf;
    return fetchFn(basis + gecontroleerd + query, {
      method: methode,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "error",
    });
  }

  return {
    async login() {
      const r = await verzoek("POST", "/api/login", { username: user, password: pass });
      if (!r.ok) {
        throw new Error(
          `Inloggen bij de UniFi-controller mislukt (HTTP ${r.status}). Mogelijke oorzaken: verkeerde ` +
            `gebruikersnaam of wachtwoord in Key Vault, 2FA aan op het account, of account geblokkeerd.`
        );
      }
      cookie = cookiesUit(r.headers);
      csrf = r.headers.get("x-csrf-token");
    },
    async logout() {
      try {
        await verzoek("POST", "/api/logout", {});
      } catch {
        // afmelden is beleefdheid; een fout hier mag de uitkomst niet verpesten
      }
    },
    async get(pad) {
      return leesJson(await verzoek("GET", pad), pad);
    },
    async post(pad, body) {
      return leesJson(await verzoek("POST", pad, body), pad);
    },
  };
}

export const EVENTS_PAGE_SIZE = 200;
export const EVENTS_MAX_PAGES = 20;

export async function haalSites(client) {
  return lijst(await client.get("/api/self/sites"));
}

export async function snapshot(client, site) {
  const ruw = {};
  const ontbreekt = [];
  const onderdelen = [
    ["apparaten", `/api/s/${site}/stat/device`],
    ["clients", `/api/s/${site}/stat/sta`],
    ["wifi", `/api/s/${site}/rest/wlanconf`],
  ];
  for (const [naam, pad] of onderdelen) {
    try {
      ruw[naam] = lijst(await client.get(pad));
    } catch (e) {
      if (!(e instanceof EndpointOntbreekt)) throw e;
      ruw[naam] = [];
      ontbreekt.push(`${naam}: ${e.message}`);
    }
  }
  return {
    apparaten: samenvattingApparaten(ruw.apparaten),
    clients: samenvattingClients(ruw.clients, ruw.apparaten),
    wifi: samenvattingWlans(ruw.wifi),
    ontbreekt,
  };
}

export async function haalEvents(client, site, { dagen = 14, nu = Date.now(), pageSize = EVENTS_PAGE_SIZE, maxPaginas = EVENTS_MAX_PAGES } = {}) {
  const van = nu - dagen * 86400000;
  const alle = [];
  let pagina = 0;
  let totaal = 1;
  while (pagina < totaal && pagina < maxPaginas) {
    const j = await client.post(`/v2/api/site/${site}/system-log/all`, {
      timestampFrom: van,
      timestampTo: nu,
      pageSize,
      pageNumber: pagina,
      categories: ["CLIENT_DEVICES"],
    });
    alle.push(...lijst(j));
    totaal = Number(j?.total_page_count ?? 0);
    pagina++;
  }
  const events = eventsPlat(alle);
  const tijden = events.map((e) => e.ts).filter(Number.isFinite);
  const oudsteEvent = tijden.length ? tijdNL(Math.min(...tijden)) : null;
  return { events, afgekapt: totaal > maxPaginas, oudsteEvent };
}

export async function clientInfo(client, site, zoek, opts = {}) {
  const dagen = opts.dagen ?? 14;
  const snap = await snapshot(client, site);
  const { events, afgekapt, oudsteEvent } = await haalEvents(client, site, opts);
  let bekendRuw = [];
  const ontbreekt = [...snap.ontbreekt];
  try {
    bekendRuw = lijst(await client.get(`/api/s/${site}/stat/alluser?within=${dagen * 24}`));
  } catch (e) {
    if (!(e instanceof EndpointOntbreekt)) throw e;
    ontbreekt.push(`bekende toestellen: ${e.message}`);
  }
  const bekendAlle = bekendRuw.map((u) => ({
    naam: u.name || u.hostname || u.mac,
    mac: u.mac ?? null,
    ip: u.last_ip ?? null,
    laatstGezien: Number.isFinite(u.last_seen) ? tijdNL(u.last_seen * 1000) : null,
    bekabeld: Boolean(u.is_wired),
  }));
  const actueel = matchToestel(snap.clients, zoek);
  const bekend = matchToestel(bekendAlle, zoek);
  const macs = new Set([...actueel, ...bekend].filter((r) => r.mac).map((r) => String(r.mac).toLowerCase()));
  const z = String(zoek).toLowerCase();
  return {
    actueel,
    bekend,
    events: events.filter((e) => (e.mac && macs.has(String(e.mac).toLowerCase())) || String(e.toestel ?? "").toLowerCase().includes(z)),
    afgekapt,
    oudsteEvent,
    ontbreekt,
  };
}

export const SUBCOMMANDS = ["sites", "site", "snapshot", "events", "client"];

const GEBRUIK = `Gebruik: node unifi-lookup.mjs <subcommando> [argumenten] [--json] [--dagen N]

  sites [zoekterm]                  Sites met naam, IT Glue-ID en korte site-ID
  site <itglue-id|site-id|naam>     Koppelt naar precies één site, of toont kandidaten
  snapshot <site-id>                Apparaten, radio's, wifi-clients en wifi-instellingen
  events <site-id> [--dagen N]      Verbinden, verbreken en roamen (standaard 14 dagen, max 90)
  client <site-id> <naam|mac|ip>    Eén toestel: actuele stand, laatst gezien en zijn events

  --json         gestructureerde uitvoer voor verdere analyse
  --kv python    secrets zonder az ophalen (env var, dan scripts/kv-secret.py)

Read-only. Wifi-wachtwoorden en andere geheimen worden nooit getoond. Tijden in Europe/Amsterdam.
Events: UniFi bewaart de system-log kort (vaak slechts uren); historie via Grafana.
snapshot, events en client verwachten de korte site-ID uit "site"; zo wordt er nooit stil een site gegokt.`;

export function formatTabel(rijen, kolommen) {
  if (!rijen?.length) return "Geen resultaten.";
  const cel = (v) => (v === null || v === undefined ? "-" : typeof v === "boolean" ? (v ? "ja" : "nee") : String(v));
  const breedtes = kolommen.map((k) => Math.max(k.length, ...rijen.map((r) => cel(r[k]).length)));
  const regel = (vals) => vals.map((v, i) => v.padEnd(breedtes[i])).join("  ").trimEnd();
  return [regel(kolommen), regel(breedtes.map((b) => "-".repeat(b))), ...rijen.map((r) => regel(kolommen.map((k) => cel(r[k]))))].join("\n");
}

function radioRijen(apparaten) {
  return apparaten.flatMap((a) => a.radios.map((r) => ({ ap: a.naam, ...r })));
}

function formatteer(cmd, u) {
  if (cmd === "sites") return formatTabel(u, ["naam", "itglueId", "site", "apparaten"]);
  if (cmd === "site") {
    if (u.match) {
      const regel = `Site: ${u.match.naam} (site-id ${u.match.site}, IT Glue ${u.match.itglueId ?? "-"})`;
      return u.via === "naam" ? `${regel}\nOp naam gevonden: laat de gebruiker bevestigen dat dit de juiste site is.` : regel;
    }
    if (u.kandidaten.length) return `Meerdere sites gevonden, laat de gebruiker kiezen:\n${formatTabel(u.kandidaten, ["naam", "itglueId", "site", "apparaten"])}`;
    return u.via === "itglue-id"
      ? "Geen site met dit IT Glue-ID. Probeer de naam (de sitenaam kan zijn afgekapt) en laat de gebruiker bevestigen."
      : "Geen site gevonden op deze naam.";
  }
  const ontbreekt = (u.ontbreekt ?? []).map((o) => `Let op, ontbreekt: ${o}`);
  const afgekapt = u.afgekapt ? [`Let op: meer dan ${EVENTS_MAX_PAGES} pagina's events; de lijst is afgekapt. Kies minder dagen.`] : [];
  if (cmd === "snapshot") {
    return [
      "APPARATEN", formatTabel(u.apparaten, ["naam", "type", "model", "firmware", "upgradeBeschikbaar", "uptimeDagen", "online", "clients"]),
      "", "RADIO'S", formatTabel(radioRijen(u.apparaten), ["ap", "band", "kanaal", "breedte", "dfs", "zendvermogen", "maxZendvermogen", "ruimte", "clients", "kanaalbezetting", "retriesPct", "minRssi"]),
      "", "WIFI-CLIENTS", formatTabel(u.clients, ["naam", "mac", "ip", "ap", "band", "kanaal", "signaal", "beoordeling", "uptimeMin", "roams", "retriesPct"]),
      "", "WIFI-INSTELLINGEN", formatTabel(u.wifi, ["ssid", "aan", "beveiliging", "band", "fastRoaming80211r", "bssTransition80211v", "roamingAssistant5", "minRate24", "minRate5", "pmf", "uapsd"]),
      ...ontbreekt,
    ].join("\n");
  }
  const eventsRegel = u.oudsteEvent
    ? `Events beschikbaar vanaf ${u.oudsteEvent} (UniFi bewaart de system-log kort; historie via Grafana).`
    : "Geen events in de system-log.";
  const eventKolommen = ["tijd", "soort", "toestel", "vanAp", "naarAp", "signaalVoor", "signaal", "band", "duur"];
  if (cmd === "events") return [formatTabel(u.events, eventKolommen), eventsRegel, ...afgekapt].join("\n");
  return [
    "ACTUEEL", formatTabel(u.actueel, ["naam", "mac", "ip", "ap", "band", "signaal", "beoordeling", "uptimeMin", "roams"]),
    "", "BEKEND (LAATST GEZIEN)", formatTabel(u.bekend, ["naam", "mac", "ip", "laatstGezien", "bekabeld"]),
    "", "EVENTS", formatTabel(u.events, eventKolommen), eventsRegel,
    ...afgekapt, ...ontbreekt,
  ].join("\n");
}

function leesOpties(argvIn) {
  const alsJson = argvIn.includes("--json");
  let dagen = 14;
  const i = argvIn.indexOf("--dagen");
  if (i >= 0) {
    dagen = Number(argvIn[i + 1]);
    if (!Number.isInteger(dagen) || dagen < 1 || dagen > 90) throw new Error("--dagen moet een geheel getal van 1 t/m 90 zijn.");
  }
  let route = "auto";
  const k = argvIn.indexOf("--kv");
  if (k >= 0) {
    route = argvIn[k + 1];
    if (!KV_ROUTES.includes(route)) throw new Error(`--kv moet een van ${KV_ROUTES.join(", ")} zijn.`);
  }
  const overslaan = new Set([i, i + 1, k, k + 1].filter((n, idx) => (idx < 2 ? i >= 0 : k >= 0)));
  const argv = argvIn.filter((a, j) => a !== "--json" && !overslaan.has(j));
  const onbekend = argv.find((a, j) => a.startsWith("--") && !(j === 0 && a === "--help"));
  if (onbekend) throw new Error(`Onbekende optie "${onbekend}". Toegestaan: --json, --dagen N, --kv auto|python.`);
  return { argv, alsJson, dagen, route };
}

function eisSiteId(site) {
  if (!SITE_ID_RE.test(String(site ?? ""))) {
    throw new Error(`"${site ?? ""}" is geen korte site-ID. Zoek die eerst op met: node unifi-lookup.mjs site <itglue-id|naam>`);
  }
  return site;
}

// Validatie staat vóór het ophalen van secrets en het inloggen: een tikfout kost dan geen Key
// Vault-aanroep en geen sessie op de controller.
export async function runCli(argvIn, { secrets = haalAlleSecrets, fetchFn = fetch, log = console.log } = {}) {
  const { argv, alsJson, dagen, route } = leesOpties(argvIn);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    log(GEBRUIK);
    return;
  }
  const [cmd, a1, a2] = argv;
  if (!SUBCOMMANDS.includes(cmd)) throw new Error(`Onbekend subcommando "${cmd}". Kies uit: ${SUBCOMMANDS.join(", ")}.`);
  if (cmd === "site" && !a1) throw new Error("Geef een IT Glue-ID, site-ID of naam op.");
  if (["snapshot", "events", "client"].includes(cmd)) eisSiteId(a1);
  if (cmd === "client" && !a2) throw new Error("Geef een toestel op: naam, MAC of IP.");

  const { url, user, pass } = await secrets({ route });
  const client = maakClient({ baseUrl: url, user, pass, fetchFn });
  await client.login();
  try {
    let uitkomst;
    if (cmd === "sites") {
      const rijen = (await haalSites(client)).map(siteRij);
      uitkomst = a1 ? rijen.filter((r) => `${r.naam} ${r.itglueId ?? ""} ${r.site}`.toLowerCase().includes(String(a1).toLowerCase())) : rijen;
    } else if (cmd === "site") {
      uitkomst = resolveSite(await haalSites(client), argv.slice(1).join(" "));
    } else if (cmd === "snapshot") {
      uitkomst = await snapshot(client, a1);
    } else if (cmd === "events") {
      uitkomst = await haalEvents(client, a1, { dagen });
    } else {
      uitkomst = await clientInfo(client, a1, argv.slice(2).join(" "), { dagen });
    }
    log(alsJson ? JSON.stringify(uitkomst, null, 2) : formatteer(cmd, uitkomst));
  } finally {
    await client.logout();
  }
}

// Node's fetch geeft alleen "fetch failed"; de echte oorzaak zit in err.cause.code. Nooit URL's of geheimen.
export function foutmelding(err) {
  const code = err?.cause?.code;
  return code ? `${err.message} (${code})` : String(err?.message ?? err);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(foutmelding(err));
    process.exitCode = 1;
  });
}
