import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGeheimeSleutel,
  redactUnifi,
  normaliseerPad,
  assertVerzoekToegestaan,
  parseItglueId,
  siteNaam,
  normaliseerNaam,
  siteRij,
  resolveSite,
  tijdNL,
  isDfsKanaal,
  foutmelding,
  beoordeelSignaal,
  samenvattingApparaten,
  samenvattingClients,
  samenvattingWlans,
  eventsPlat,
  matchToestel,
  VAULT,
  SECRETS,
  ENV_VARS,
  KV_ROUTES,
  haalSecretOp,
  haalAlleSecrets,
  EndpointOntbreekt, maakClient, haalSites, snapshot, haalEvents, clientInfo, runCli, SUBCOMMANDS, EVENTS_MAX_PAGES,
} from "./unifi-lookup.mjs";

test("isGeheimeSleutel: x_-velden en bekende geheime namen", () => {
  for (const k of ["x_passphrase", "X_Passphrase", "x_authkey", "password", "passphrase", "radius_secret", "private_preshared_keys", "wpa_psk", "mgmt_password", "ldap_secret"]) {
    assert.equal(isGeheimeSleutel(k), true, k);
  }
  for (const k of ["name", "group_rekey", "security", "wpa_mode", "bss_transition", "secretary"]) {
    assert.equal(isGeheimeSleutel(k), false, k);
  }
});

test("redactUnifi: verwijdert geheimen, ook genest en in arrays, zonder de invoer te muteren", () => {
  const invoer = {
    meta: { rc: "ok" },
    data: [
      { name: "Kantoor", x_passphrase: "geheim1", radius_profile: { x_secret: "geheim2", host: "10.0.0.1" } },
      { name: "Gast", private_preshared_keys: [{ password: "geheim3" }], nested: [[{ x_iapp_key: "geheim4", ok: 1 }]] },
    ],
  };
  const uit = redactUnifi(invoer);
  const tekst = JSON.stringify(uit);
  for (const g of ["geheim1", "geheim2", "geheim3", "geheim4"]) assert.ok(!tekst.includes(g), g);
  assert.equal(uit.data[0].name, "Kantoor");
  assert.equal(uit.data[0].radius_profile.host, "10.0.0.1");
  assert.equal(uit.data[1].nested[0][0].ok, 1);
  assert.equal(invoer.data[0].x_passphrase, "geheim1", "invoer mag niet gemuteerd worden");
});

test("redactUnifi: laat primitieven en null ongemoeid", () => {
  assert.equal(redactUnifi(null), null);
  assert.equal(redactUnifi(5), 5);
  assert.equal(redactUnifi("x_passphrase"), "x_passphrase");
});

test("normaliseerPad: query weg, decodering, lowercase, slashes", () => {
  assert.equal(normaliseerPad("/api/s/abc123/stat/alluser?within=72"), "/api/s/abc123/stat/alluser");
  assert.equal(normaliseerPad("//API//Self//Sites/"), "/api/self/sites");
  assert.equal(normaliseerPad("/api/s/abc%2Fstat/device"), "/api/s/abc/stat/device");
  assert.equal(normaliseerPad("/api/s/abc%252Fstat/device"), "/api/s/abc/stat/device");
  assert.throws(() => normaliseerPad("/api/s/abc/../rest/user"), /\.\./);
  assert.throws(() => normaliseerPad("/api/s/%E0%A4%A"), /Ongeldig pad/);
});

test("assertVerzoekToegestaan: alle toegestane verzoeken", () => {
  assert.equal(assertVerzoekToegestaan("GET", "/api/self/sites"), "/api/self/sites");
  for (const p of ["stat/device", "stat/sta", "stat/alluser?within=24", "rest/wlanconf"]) {
    assertVerzoekToegestaan("get", `/api/s/abc123/${p}`);
  }
  assertVerzoekToegestaan("POST", "/api/login");
  assertVerzoekToegestaan("POST", "/api/logout");
  assertVerzoekToegestaan("POST", "/v2/api/site/abc123/system-log/all");
});

test("assertVerzoekToegestaan: weigert schrijfacties en omwegen", () => {
  const geweigerd = [
    ["PUT", "/api/s/abc123/rest/wlanconf/1"],
    ["POST", "/api/s/abc123/rest/wlanconf"],
    ["DELETE", "/api/s/abc123/rest/wlanconf"],
    ["POST", "/api/s/abc123/cmd/devmgr"],
    ["GET", "/api/s/abc123/rest/wlanconf/1"],
    ["GET", "/api/s/abc123/rest/wlanconf.json"],
    ["GET", "/api/s/abc123/rest/user"],
    ["GET", "/api/s/abc123%2F..%2Fdefault/cmd/devmgr"],
    ["GET", "/api/s/ABC123/stat/device/../../cmd/devmgr"],
    ["GET", "/api/s/abc-123/stat/device"],
    ["POST", "/v2/api/site/abc123/system-log/all/delete"],
    ["GET", "/v2/api/site/abc123/system-log/all"],
  ];
  for (const [m, p] of geweigerd) {
    assert.throws(() => assertVerzoekToegestaan(m, p), /Geweigerd|\.\./, `${m} ${p}`);
  }
});

const SITES = [
  { name: "aaa11111", desc: "Bakkerij Voorbeeld (1234567890123456)", device_count: 4 },
  { name: "bbb22222", desc: "Voorbeeld Makelaars Almelo B.V. (9999999999999999)", device_count: 2 },
  { name: "ccc33333", desc: "Voorbeeld Makelaars Hengelo B.V. (5555555555555555)", device_count: 3 },
  { name: "ddd44444", desc: "Garage Test(4444444444444444)", device_count: 1 },
  { name: "eee55555", desc: "Heel Lange Klantnaam Met Vestiging Oost Nederland B.V.(12345678", device_count: 5 },
  { name: "default", desc: "Default", device_count: 0 },
];

test("parseItglueId: haalt het ID uit de sitenaam, ook zonder spatie; afgekapt geeft null", () => {
  assert.equal(parseItglueId("Bakkerij Voorbeeld (1234567890123456)"), "1234567890123456");
  assert.equal(parseItglueId("Garage Test(4444444444444444)"), "4444444444444444");
  assert.equal(parseItglueId("Naam (12345) (1234567890123456)"), "1234567890123456");
  assert.equal(parseItglueId("Heel Lange Klantnaam B.V.(12345678"), null);
  assert.equal(parseItglueId("Default"), null);
  assert.equal(parseItglueId(undefined), null);
});

test("siteNaam: verwijdert volledige en afgekapte ID's", () => {
  assert.equal(siteNaam("Bakkerij Voorbeeld (1234567890123456)"), "Bakkerij Voorbeeld");
  assert.equal(siteNaam("Garage Test(4444444444444444)"), "Garage Test");
  assert.equal(siteNaam("Heel Lange Klantnaam B.V.(12345678"), "Heel Lange Klantnaam B.V.");
});

test("normaliseerNaam: rechtsvorm en leestekens weg", () => {
  assert.equal(normaliseerNaam("Voorbeeld Makelaars Almelo B.V."), "voorbeeld makelaars almelo");
  assert.equal(normaliseerNaam("Bakkerij  Voorbeeld"), "bakkerij voorbeeld");
  assert.equal(normaliseerNaam("Test V.O.F."), "test");
});

test("resolveSite: op IT Glue-ID, exact één", () => {
  const r = resolveSite(SITES, "1234567890123456");
  assert.equal(r.via, "itglue-id");
  assert.equal(r.match.site, "aaa11111");
  assert.equal(r.match.naam, "Bakkerij Voorbeeld");
});

test("resolveSite: IT Glue-ID zonder site geeft geen match en geen kandidaten", () => {
  const r = resolveSite(SITES, "7777777777777777");
  assert.equal(r.via, "itglue-id");
  assert.equal(r.match, null);
  assert.deepEqual(r.kandidaten, []);
});

test("resolveSite: afgekapt ID matcht niet gedeeltelijk, de naamroute vindt hem wel", () => {
  assert.equal(resolveSite(SITES, "12345678").match, null);
  assert.equal(resolveSite(SITES, "123456789012345").match, null);
  const r = resolveSite(SITES, "Heel Lange Klantnaam");
  assert.equal(r.via, "naam");
  assert.equal(r.match.site, "eee55555");
});

test("resolveSite: op korte site-ID", () => {
  const r = resolveSite(SITES, "ddd44444");
  assert.equal(r.via, "site-id");
  assert.equal(r.match.naam, "Garage Test");
});

test("resolveSite: naam met meerdere vestigingen geeft kandidaten, geen gok", () => {
  const r = resolveSite(SITES, "Voorbeeld Makelaars");
  assert.equal(r.via, "naam");
  assert.equal(r.match, null);
  assert.deepEqual(r.kandidaten.map((k) => k.site).sort(), ["bbb22222", "ccc33333"]);
});

test("resolveSite: exacte naam wint van deelmatches", () => {
  const r = resolveSite(SITES, "voorbeeld makelaars almelo bv");
  assert.equal(r.match.site, "bbb22222");
});

test("resolveSite: lege zoekterm gooit", () => {
  assert.throws(() => resolveSite(SITES, "  "), /Geef een site op/);
});

test("normaliseerNaam: curly quotes en straight quotes normaliseren naar hetzelfde", () => {
  assert.equal(normaliseerNaam("Bakker’s B.V."), "bakkers");
  assert.equal(normaliseerNaam("‘Bakker’s’"), "bakkers");
  assert.equal(normaliseerNaam("Bakker's"), "bakkers");
});

test("resolveSite: all-digit short site-ID fallthrough na geen itglue-id match", () => {
  const sitesMetCijfer = [
    { name: "12345678", desc: "Cijfer Site (9999999999999999)", device_count: 1 },
    { name: "abc11111", desc: "Ander Site (1111111111111111)", device_count: 2 },
  ];
  const r = resolveSite(sitesMetCijfer, "12345678");
  assert.equal(r.via, "site-id");
  assert.equal(r.match.site, "12345678");
  assert.deepEqual(r.kandidaten, []);
});

const DEVICES = [
  {
    type: "uap", name: "AP-01", model: "U7PG2", mac: "aa:aa:aa:00:00:01", version: "6.8.2", upgradable: false,
    uptime: 8035200, state: 1, num_sta: 3,
    radio_table: [
      { name: "wifi0", radio: "ng", ht: "20", max_txpower: 22, min_txpower: 6 },
      { name: "wifi1", radio: "na", ht: "40", max_txpower: 22, min_txpower: 6, min_rssi_enabled: true, min_rssi: -75 },
    ],
    radio_table_stats: [
      { name: "wifi0", radio: "ng", channel: 1, tx_power: 17, num_sta: 1, cu_total: 14, bw: 20, tx_retries_pct: 3.5 },
      { name: "wifi1", radio: "na", channel: 100, tx_power: 20, num_sta: 2, cu_total: 9, bw: 40, tx_retries_pct: 1.2 },
    ],
  },
  { type: "usw", name: "SW-01", model: "USL8LP", mac: "aa:aa:aa:00:00:09", version: "7.5", upgradable: true, uptime: 86400, state: 1, num_sta: 0 },
];

test("tijdNL: Europe/Amsterdam, zomer- en wintertijd", () => {
  assert.equal(tijdNL(Date.UTC(2026, 9, 1, 6, 55, 30)), "01-10-2026 08:55:30");
  assert.equal(tijdNL(Date.UTC(2026, 11, 1, 6, 55, 30)), "01-12-2026 07:55:30");
});

test("tijdNL: undefined, null, NaN geven null terug", () => {
  assert.equal(tijdNL(undefined), null);
  assert.equal(tijdNL(null), null);
  assert.equal(tijdNL(NaN), null);
});

test("isDfsKanaal", () => {
  for (const k of [52, 100, 144]) assert.equal(isDfsKanaal(k), true, String(k));
  for (const k of [1, 6, 11, 36, 48, 149, 165, null]) assert.equal(isDfsKanaal(k), false, String(k));
});

test("beoordeelSignaal: drempels uit de spec", () => {
  assert.equal(beoordeelSignaal(-60), "goed");
  assert.equal(beoordeelSignaal(-67), "goed");
  assert.equal(beoordeelSignaal(-68), "krap");
  assert.equal(beoordeelSignaal(-75), "krap");
  assert.equal(beoordeelSignaal(-76), "slecht");
  assert.equal(beoordeelSignaal(-80), "slecht");
  assert.equal(beoordeelSignaal(-81), "onbruikbaar");
  assert.equal(beoordeelSignaal(null), "onbekend");
});

test("samenvattingApparaten: radio's met breedte, DFS en ruimte in zendvermogen", () => {
  const [ap, sw] = samenvattingApparaten(DEVICES);
  assert.equal(ap.naam, "AP-01");
  assert.equal(ap.uptimeDagen, 93);
  assert.equal(ap.online, true);
  assert.deepEqual(ap.radios[0], {
    radio: "ng", band: "2,4 GHz", kanaal: 1, breedte: 20, dfs: false, zendvermogen: 17, maxZendvermogen: 22,
    ruimte: 5, clients: 1, kanaalbezetting: 14, retriesPct: 3.5, minRssi: null,
  });
  assert.equal(ap.radios[1].dfs, true);
  assert.equal(ap.radios[1].minRssi, -75);
  assert.equal(sw.upgradeBeschikbaar, true);
  assert.deepEqual(sw.radios, []);
});

test("samenvattingClients: alleen wifi, AP-naam, MAC als naam als er niets anders is", () => {
  const stas = [
    { mac: "bb:bb:bb:00:00:01", hostname: "Telefoon-A", ip: "10.0.0.5", ap_mac: "aa:aa:aa:00:00:01", radio: "na", channel: 100, signal: -82, essid: "Kantoor", uptime: 3600, roam_count: 4, wifi_tx_retries_percentage: 12.5, satisfaction: 40, is_wired: false },
    { mac: "bb:bb:bb:00:00:02", ip: "10.0.0.6", ap_mac: "ff:ff:ff:ff:ff:ff", radio: "ng", signal: -60, is_wired: false },
    { mac: "bb:bb:bb:00:00:03", hostname: "Printer", is_wired: true },
  ];
  const rijen = samenvattingClients(stas, DEVICES);
  assert.equal(rijen.length, 2);
  assert.equal(rijen[0].naam, "Telefoon-A");
  assert.equal(rijen[0].ap, "AP-01");
  assert.equal(rijen[0].band, "5 GHz");
  assert.equal(rijen[0].beoordeling, "onbruikbaar");
  assert.equal(rijen[0].uptimeMin, 60);
  assert.equal(rijen[1].naam, "bb:bb:bb:00:00:02");
  assert.equal(rijen[1].ap, "ff:ff:ff:ff:ff:ff");
});

test("samenvattingWlans: alleen een whitelist van velden, nooit het wachtwoord", () => {
  const [w] = samenvattingWlans([{
    name: "Kantoor", enabled: true, security: "wpapsk", wpa_mode: "wpa2", wlan_band: "both", x_passphrase: "geheim",
    bss_transition: true, roaming_assistant_na_enabled: false, roaming_assistant_na_rssi: -75,
    minrate_ng_enabled: true, minrate_ng_data_rate_kbps: 6000, minrate_na_enabled: false, minrate_na_data_rate_kbps: 12000, pmf_mode: "disabled",
  }]);
  assert.deepEqual(w, {
    ssid: "Kantoor", aan: true, beveiliging: "wpapsk/wpa2", band: "both", fastRoaming80211r: false, bssTransition80211v: true,
    roamingAssistant5: null, minRate24: 6, minRate5: null, pmf: "disabled", uapsd: false,
  });
  assert.ok(!JSON.stringify(w).includes("geheim"));
});

test("eventsPlat: roam, verbreken en verbinden worden rijen, gesorteerd op tijd", () => {
  const events = [
    { event: "CLIENT_ROAMED", timestamp: Date.UTC(2026, 9, 1, 7, 0, 0), parameters: {
      CLIENT: { id: "bb:bb:bb:00:00:01", name: "Telefoon-A", hostname: "tel-a" },
      DEVICE_FROM: { name: "AP-01" }, DEVICE_TO: { name: "AP-02" },
      PREVIOUS_SIGNAL_STRENGTH: { name: "-84" }, SIGNAL_STRENGTH: { name: "-71" }, RADIO_BAND: { name: "5 GHz" }, WLAN: { name: "Kantoor" } } },
    { event: "CLIENT_DISCONNECTED_WIRELESS", timestamp: Date.UTC(2026, 9, 1, 6, 0, 0), parameters: {
      CLIENT: { id: "bb:bb:bb:00:00:02", hostname: "tel-b" }, DEVICE: { name: "AP-01" },
      SIGNAL_STRENGTH: { name: "-88 dBm" }, DURATION: { name: "2h 3m" }, WLAN: { name: "Kantoor" } } },
    { event: "IETS_ONBEKENDS", timestamp: Date.UTC(2026, 9, 1, 8, 0, 0), parameters: {} },
  ];
  const rijen = eventsPlat(events);
  assert.deepEqual(rijen.map((r) => r.soort), ["verbroken", "roam", "IETS_ONBEKENDS"]);
  assert.equal(rijen[0].toestel, "tel-b");
  assert.equal(rijen[0].signaal, -88);
  assert.equal(rijen[0].naarAp, "AP-01");
  assert.equal(rijen[0].duur, "2h 3m");
  assert.equal(rijen[1].tijd, "01-10-2026 09:00:00");
  assert.equal(rijen[1].vanAp, "AP-01");
  assert.equal(rijen[1].naarAp, "AP-02");
  assert.equal(rijen[1].signaalVoor, -84);
  assert.equal(rijen[1].signaal, -71);
  assert.equal(rijen[2].toestel, null);
});

test("eventsPlat: event zonder timestamp crasht niet, staat achteraan, tijd=null", () => {
  const events = [
    { event: "CLIENT_ROAMED", timestamp: Date.UTC(2026, 9, 1, 7, 0, 0), parameters: {
      CLIENT: { id: "bb:bb:bb:00:00:01" }, DEVICE_FROM: { name: "AP-01" }, DEVICE_TO: { name: "AP-02" } } },
    { event: "CLIENT_DISCONNECTED_WIRELESS", parameters: {
      CLIENT: { id: "bb:bb:bb:00:00:02" }, DEVICE: { name: "AP-01" } } },
    { event: "CLIENT_CONNECTED_WIRELESS", timestamp: Date.UTC(2026, 9, 1, 6, 0, 0), parameters: {
      CLIENT: { id: "bb:bb:bb:00:00:03" }, DEVICE: { name: "AP-01" } } },
  ];
  const rijen = eventsPlat(events);
  assert.equal(rijen.length, 3);
  assert.equal(rijen[0].ts, Date.UTC(2026, 9, 1, 6, 0, 0));
  assert.equal(rijen[1].ts, Date.UTC(2026, 9, 1, 7, 0, 0));
  assert.equal(rijen[2].ts, undefined);
  assert.equal(rijen[2].tijd, null);
});

test("matchToestel: hoofdletterongevoelig op naam, MAC, IP en deel van de naam", () => {
  const rijen = [
    { naam: "S23-van-Yvonne", mac: "bb:bb:bb:00:00:01", ip: "10.0.0.5" },
    { naam: "bb:bb:bb:00:00:02", mac: "bb:bb:bb:00:00:02", ip: null },
  ];
  assert.equal(matchToestel(rijen, "BB:BB:BB:00:00:02").length, 1);
  assert.equal(matchToestel(rijen, "yvonne")[0].mac, "bb:bb:bb:00:00:01");
  assert.equal(matchToestel(rijen, "10.0.0.5").length, 1);
  assert.equal(matchToestel(rijen, "10.0.0.50").length, 0);
});

function nepRun(antwoorden) {
  const aanroepen = [];
  const run = (cmd, args) => {
    aanroepen.push([cmd, ...args].join(" "));
    const a = antwoorden[cmd];
    if (a instanceof Error) {
      const e = new Error(a.message);
      if (a.stdout !== undefined) e.stdout = a.stdout;
      throw e;
    }
    return a ?? "";
  };
  return { run, aanroepen };
}

test("haalSecretOp: az eerst, met vaste vault en secretnaam", () => {
  const { run, aanroepen } = nepRun({ az: "https://example.local:8443\n" });
  assert.equal(haalSecretOp("url", { env: {}, run, python: "python", platform: "linux" }), "https://example.local:8443");
  assert.equal(aanroepen.length, 1);
  assert.match(aanroepen[0], new RegExp(`^az keyvault secret show --vault-name ${VAULT} --name ${SECRETS.url} `));
});

test("haalSecretOp: zonder az valt hij terug op de env var", () => {
  const { run, aanroepen } = nepRun({ az: new Error("geweigerd") });
  assert.equal(haalSecretOp("user", { env: { [ENV_VARS.user]: "lezer" }, run, python: "python", platform: "linux" }), "lezer");
  assert.equal(aanroepen.length, 1);
});

test("haalSecretOp: zonder az en env valt hij terug op kv-secret.py", () => {
  const { run, aanroepen } = nepRun({ az: new Error("geweigerd"), python: "waarde-uit-sdk" });
  assert.equal(haalSecretOp("pass", { env: {}, run, python: "python", platform: "linux" }), "waarde-uit-sdk");
  assert.match(aanroepen[1], /^python .*kv-secret\.py UNIFI-PASS$/);
});

test("haalSecretOp: alles mislukt geeft een melding met alle drie de routes en geen waarden", () => {
  const azError = new Error("Connection failed");
  azError.stdout = "nep-geheim-123";
  const pythonError = new Error("Import error: nep-geheim-123");
  const { run } = nepRun({ az: azError, python: pythonError });
  assert.throws(
    () => haalSecretOp("pass", { env: {}, run, python: "python", platform: "linux" }),
    (e) => {
      const hasRoutes = /az login/.test(e.message) && /UNIFI_PASS/.test(e.message) && /kv-secret\.py/.test(e.message);
      const noLeak = !e.message.includes("nep-geheim-123");
      return hasRoutes && noLeak;
    }
  );
});

test("haalSecretOp: lege az-uitvoer telt als mislukt", () => {
  const { run } = nepRun({ az: "  \n", python: "" });
  assert.throws(() => haalSecretOp("url", { env: {}, run, python: "python", platform: "linux" }), /UNIFI-URL/);
});

test("haalSecretOp: route python slaat az over", () => {
  const { run, aanroepen } = nepRun({ az: "mag-niet", python: "uit-sdk" });
  assert.equal(haalSecretOp("url", { env: {}, run, python: "python", route: "python", platform: "linux" }), "uit-sdk");
  assert.equal(aanroepen.length, 1);
  assert.doesNotMatch(aanroepen[0], /^az /);
  assert.deepEqual(KV_ROUTES, ["auto", "python"]);
});

test("haalSecretOp: onbekende route gooit", () => {
  assert.throws(() => haalSecretOp("url", { env: {}, run: () => "x", route: "cli" }), /--kv/);
});

test("haalAlleSecrets: haalt alle drie op", () => {
  const { run } = nepRun({ az: "x" });
  assert.deepEqual(haalAlleSecrets({ env: {}, run, python: "python", platform: "linux" }), { url: "x", user: "x", pass: "x" });
});

test("haalSecretOp: op Windows roept az via cmd.exe aan", () => {
  const { run, aanroepen } = nepRun({ "cmd.exe": "https://example.local:8443\n" });
  assert.equal(haalSecretOp("url", { env: {}, run, python: "python", platform: "win32" }), "https://example.local:8443");
  assert.equal(aanroepen.length, 1);
  assert.match(aanroepen[0], /^cmd\.exe \/d \/s \/c az keyvault secret show --vault-name juict-shared-kv --name UNIFI-URL/);
});

// Nep-controller: routes "METHODE /pad" → (body, verzoek) => [status, json]. Houdt alle verzoeken bij.
function nepController(routes) {
  const verzoeken = [];
  const fetchFn = async (url, init = {}) => {
    const pad = new URL(url).pathname + new URL(url).search;
    const sleutel = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    verzoeken.push({ sleutel, pad, body, headers: init.headers ?? {} });
    const route = routes[sleutel];
    const [status, json, headers] = route ? route(body) : [404, { fout: "niet gevonden" }];
    // Een eigen object i.p.v. new Response(): zo hangt de test niet af van hoe de runtime set-cookie filtert.
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers({ "content-type": "application/json", ...(headers ?? {}) }),
      json: async () => json,
    };
  };
  return { fetchFn, verzoeken };
}

const BASIS = "https://controller.voorbeeld:8443";
const LOGIN_OK = { "POST /api/login": () => [200, { meta: { rc: "ok" } }, { "set-cookie": "unifises=abc; Path=/; HttpOnly", "x-csrf-token": "tok" }], "POST /api/logout": () => [200, {}] };
const SITE_API = {
  "GET /api/self/sites": () => [200, { data: [
    { name: "aaa11111", desc: "Bakkerij Voorbeeld (1234567890123456)", device_count: 2 },
    { name: "bbb22222", desc: "Voorbeeld Makelaars Almelo B.V. (9999999999999999)", device_count: 2 },
  ] }],
  "GET /api/s/aaa11111/stat/device": () => [200, { data: DEVICES }],
  "GET /api/s/aaa11111/stat/sta": () => [200, { data: [
    { mac: "bb:bb:bb:00:00:01", hostname: "Telefoon-A", ap_mac: "aa:aa:aa:00:00:01", radio: "na", signal: -82, is_wired: false },
  ] }],
  "GET /api/s/aaa11111/rest/wlanconf": () => [200, { data: [{ name: "Kantoor", x_passphrase: "geheim", bss_transition: true }] }],
  "GET /api/s/aaa11111/stat/alluser": () => [200, { data: [{ mac: "bb:bb:bb:00:00:01", hostname: "Telefoon-A", last_ip: "10.0.0.5", last_seen: 1790841600, is_wired: false }] }],
};
const geenSecrets = () => ({ url: BASIS, user: "lezer", pass: "GeheimWachtwoord!" });

test("maakClient: login zet cookie en csrf, verzoeken buiten de allowlist worden niet verstuurd", async () => {
  const { fetchFn, verzoeken } = nepController({ ...LOGIN_OK, ...SITE_API });
  const c = maakClient({ baseUrl: BASIS + "/", user: "lezer", pass: "pw", fetchFn });
  await c.login();
  await c.get("/api/self/sites");
  assert.equal(verzoeken[1].headers.Cookie, "unifises=abc");
  assert.equal(verzoeken[1].headers["X-Csrf-Token"], "tok");
  await assert.rejects(() => c.post("/api/s/aaa11111/cmd/devmgr", { cmd: "restart" }), /Geweigerd/);
  assert.equal(verzoeken.length, 2, "geweigerd verzoek mag niet verstuurd zijn");
});

test("maakClient: respons gaat door redactUnifi", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK, ...SITE_API });
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const j = await c.get("/api/s/aaa11111/rest/wlanconf");
  assert.ok(!JSON.stringify(j).includes("geheim"));
});

test("maakClient: mislukte login geeft melding zonder wachtwoord", async () => {
  const { fetchFn, verzoeken } = nepController({ "POST /api/login": () => [401, { meta: { rc: "error", msg: "api.err.Invalid" } }] });
  const c = maakClient({ baseUrl: BASIS, user: "lezer", pass: "GeheimWachtwoord!", fetchFn });
  await assert.rejects(
    () => c.login(),
    (e) => /Inloggen .* mislukt \(HTTP 401\)/.test(e.message) && /2FA/.test(e.message) && !e.message.includes("GeheimWachtwoord!")
  );
  assert.equal(verzoeken.length, 1);
});

test("maakClient: 404 wordt EndpointOntbreekt", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK });
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  await assert.rejects(() => c.get("/api/s/aaa11111/stat/device"), EndpointOntbreekt);
});

test("snapshot: ontbrekend wlanconf-endpoint levert de rest wel en meldt wat ontbreekt", async () => {
  const routes = { ...LOGIN_OK, ...SITE_API };
  delete routes["GET /api/s/aaa11111/rest/wlanconf"];
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const s = await snapshot(c, "aaa11111");
  assert.equal(s.apparaten.length, 2);
  assert.equal(s.clients[0].ap, "AP-01");
  assert.deepEqual(s.wifi, []);
  assert.equal(s.ontbreekt.length, 1);
  assert.match(s.ontbreekt[0], /wifi.*rest\/wlanconf.*LESSONS\.md/);
});

test("haalEvents: pagineert, stopt bij het maximum en meldt afkappen", async () => {
  let paginas = 0;
  const routes = { ...LOGIN_OK, "POST /v2/api/site/aaa11111/system-log/all": (body) => {
    paginas++;
    assert.deepEqual(body.categories, ["CLIENT_DEVICES"]);
    return [200, { data: [{ event: "CLIENT_ROAMED", timestamp: 1790841600000 + body.pageNumber, parameters: {} }], total_page_count: 50 }];
  } };
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const r = await haalEvents(c, "aaa11111", { dagen: 14, nu: 1790841600000 });
  assert.equal(paginas, EVENTS_MAX_PAGES);
  assert.equal(r.events.length, EVENTS_MAX_PAGES);
  assert.equal(r.afgekapt, true);
});

test("haalEvents: periode loopt van nu min dagen tot nu", async () => {
  let gezien;
  const routes = { ...LOGIN_OK, "POST /v2/api/site/aaa11111/system-log/all": (body) => { gezien = body; return [200, { data: [], total_page_count: 0 }]; } };
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const r = await haalEvents(c, "aaa11111", { dagen: 3, nu: 1000 * 86400000 });
  assert.equal(gezien.timestampTo - gezien.timestampFrom, 3 * 86400000);
  assert.equal(r.afgekapt, false);
});

test("clientInfo: vindt toestel op MAC in hoofdletters, met events van dat toestel", async () => {
  const routes = { ...LOGIN_OK, ...SITE_API, "POST /v2/api/site/aaa11111/system-log/all": () => [200, { data: [
    { event: "CLIENT_DISCONNECTED_WIRELESS", timestamp: 1790841600000, parameters: { CLIENT: { id: "bb:bb:bb:00:00:01", hostname: "Telefoon-A" } } },
    { event: "CLIENT_DISCONNECTED_WIRELESS", timestamp: 1790841600001, parameters: { CLIENT: { id: "cc:cc:cc:00:00:09", hostname: "Ander" } } },
  ], total_page_count: 1 }] };
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const r = await clientInfo(c, "aaa11111", "BB:BB:BB:00:00:01", { dagen: 14, nu: 1790841700000 });
  assert.equal(r.actueel.length, 1);
  assert.equal(r.bekend[0].ip, "10.0.0.5");
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].mac, "bb:bb:bb:00:00:01");
});

test("runCli: onbekend subcommando faalt vóór het ophalen van secrets", async () => {
  let opgehaald = false;
  await assert.rejects(() => runCli(["bogus"], { secrets: () => { opgehaald = true; return geenSecrets(); }, log: () => {} }), /Onbekend subcommando/);
  assert.equal(opgehaald, false);
});

test("runCli: ongeldige site-ID en --dagen worden geweigerd vóór login", async () => {
  await assert.rejects(() => runCli(["snapshot", "Bakkerij Voorbeeld"], { secrets: geenSecrets, log: () => {} }), /korte site-ID/);
  await assert.rejects(() => runCli(["events", "aaa11111", "--dagen", "0"], { secrets: geenSecrets, log: () => {} }), /--dagen/);
  await assert.rejects(() => runCli(["client", "aaa11111"], { secrets: geenSecrets, log: () => {} }), /toestel/);
});

test("runCli: site op naam meldt dat bevestiging nodig is; logout volgt altijd", async () => {
  const { fetchFn, verzoeken } = nepController({ ...LOGIN_OK, ...SITE_API });
  const uit = [];
  await runCli(["site", "Bakkerij Voorbeeld"], { secrets: geenSecrets, fetchFn, log: (s) => uit.push(s) });
  const tekst = uit.join("\n");
  assert.match(tekst, /aaa11111/);
  assert.match(tekst, /op naam gevonden.*bevestig/i);
  assert.equal(verzoeken.at(-1).sleutel, "POST /api/logout");
});

test("runCli: snapshot --json bevat geen wifi-wachtwoord en geen login-wachtwoord", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK, ...SITE_API });
  const uit = [];
  await runCli(["snapshot", "aaa11111", "--json"], { secrets: geenSecrets, fetchFn, log: (s) => uit.push(s) });
  const tekst = uit.join("\n");
  const j = JSON.parse(tekst);
  assert.equal(j.apparaten[0].naam, "AP-01");
  assert.ok(!tekst.includes("geheim"));
  assert.ok(!tekst.includes("GeheimWachtwoord!"));
});

test("runCli: --kv python wordt doorgegeven aan secrets; ongeldige waarde faalt vóór secrets", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK, ...SITE_API });
  let gekregen;
  await runCli(["sites", "--kv", "python"], { secrets: (o) => { gekregen = o; return geenSecrets(); }, fetchFn, log: () => {} });
  assert.deepEqual(gekregen, { route: "python" });
  let opgehaald = false;
  await assert.rejects(() => runCli(["sites", "--kv", "cli"], { secrets: () => { opgehaald = true; return geenSecrets(); }, log: () => {} }), /--kv/);
  assert.equal(opgehaald, false);
});

test("runCli: zonder argumenten toont gebruik; SUBCOMMANDS klopt", async () => {
  const uit = [];
  await runCli([], { secrets: geenSecrets, log: (s) => uit.push(s) });
  assert.match(uit.join("\n"), /Gebruik/);
  assert.deepEqual(SUBCOMMANDS, ["sites", "site", "snapshot", "events", "client"]);
});

test("maakClient: verzoek gebruikt het genormaliseerde pad plus de originele query", async () => {
  const { fetchFn, verzoeken } = nepController({ ...LOGIN_OK, ...SITE_API });
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  await c.get("//API//self//sites/");
  assert.equal(verzoeken.at(-1).pad, "/api/self/sites");
  await c.get("/api/s/aaa11111/stat/alluser?within=336");
  assert.equal(verzoeken.at(-1).pad, "/api/s/aaa11111/stat/alluser?within=336");
});

test("maakClient: http-URL wordt geweigerd vóór er iets wordt verstuurd, zonder de URL te noemen", async () => {
  let aanroepen = 0;
  const fetchFn = async () => { aanroepen++; throw new Error("mag niet"); };
  const melding = (e) => /https:\/\//.test(e.message) && !e.message.includes("controller.voorbeeld");
  const c = maakClient({ baseUrl: "http://controller.voorbeeld:8443", user: "u", pass: "p", fetchFn });
  await assert.rejects(() => c.login(), melding);
  await assert.rejects(async () => maakClient({ baseUrl: "geen url", user: "u", pass: "p", fetchFn }).login(), /https:\/\//);
  assert.equal(aanroepen, 0);
});

test("clientInfo: rijen zonder mac laten niet alle events zonder mac matchen", async () => {
  const routes = { ...LOGIN_OK, ...SITE_API,
    "GET /api/s/aaa11111/stat/alluser": () => [200, { data: [{ hostname: "Telefoon-A", last_ip: "10.0.0.5", last_seen: 1790841600 }] }],
    "POST /v2/api/site/aaa11111/system-log/all": () => [200, { data: [
      { event: "CLIENT_DISCONNECTED_WIRELESS", timestamp: 1790841600000, parameters: {} },
    ], total_page_count: 1 }] };
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const r = await clientInfo(c, "aaa11111", "Telefoon-A", { dagen: 14, nu: 1790841700000 });
  assert.ok(r.bekend.length >= 1 && r.bekend.some((b) => b.mac === null));
  assert.equal(r.events.length, 0);
});

test("runCli: onbekende optie wordt geweigerd vóór secrets", async () => {
  let opgehaald = false;
  const secrets = () => { opgehaald = true; return geenSecrets(); };
  await assert.rejects(() => runCli(["events", "aaa11111", "--dagen=7"], { secrets, log: () => {} }), /Onbekende optie "--dagen=7"/);
  await assert.rejects(() => runCli(["client", "aaa11111", "--foo"], { secrets, log: () => {} }), /Onbekende optie/);
  assert.equal(opgehaald, false);
});

test("isDfsKanaal: houdt rekening met de band; zonder band geldt het kanaalbereik", () => {
  assert.equal(isDfsKanaal(100, "na"), true);
  assert.equal(isDfsKanaal(100), true);
  assert.equal(isDfsKanaal(53, "6e"), false);
  assert.equal(isDfsKanaal(101, "6e"), false);
  assert.equal(isDfsKanaal(100, "ng"), false);
  const [ap] = samenvattingApparaten([{ name: "AP-6", mac: "m", radio_table_stats: [{ name: "wifi6", radio: "6e", channel: 101 }], radio_table: [] }]);
  assert.equal(ap.radios[0].dfs, false);
});

test("samenvattingWlans: minRate is null (niet NaN) als de kbps-waarde ontbreekt of ongeldig is", () => {
  const [w] = samenvattingWlans([{ name: "X", minrate_ng_enabled: true, minrate_na_enabled: true, minrate_na_data_rate_kbps: "abc" }]);
  assert.equal(w.minRate24, null);
  assert.equal(w.minRate5, null);
});

function eventsRoute(data) {
  return { ...LOGIN_OK, "POST /v2/api/site/aaa11111/system-log/all": () => [200, { data, total_page_count: 1 }] };
}

test("haalEvents: oudsteEvent is de vroegste tijd, null zonder events, en negeert events zonder tijd", async () => {
  const mk = async (data) => {
    const { fetchFn } = nepController(eventsRoute(data));
    const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
    await c.login();
    return haalEvents(c, "aaa11111", { nu: 1790841600000 });
  };
  const met = await mk([
    { event: "CLIENT_ROAMED", timestamp: Date.UTC(2026, 9, 1, 7, 0, 0), parameters: {} },
    { event: "CLIENT_ROAMED", timestamp: Date.UTC(2026, 9, 1, 5, 0, 0), parameters: {} },
  ]);
  assert.equal(met.oudsteEvent, "01-10-2026 07:00:00");
  assert.equal((await mk([])).oudsteEvent, null);
  const zonder = await mk([
    { event: "CLIENT_ROAMED", parameters: {} },
    { event: "CLIENT_ROAMED", timestamp: Date.UTC(2026, 9, 1, 6, 0, 0), parameters: {} },
  ]);
  assert.equal(zonder.oudsteEvent, "01-10-2026 08:00:00");
});

test("runCli: events en client tonen vanaf wanneer events beschikbaar zijn, of dat er geen zijn", async () => {
  const run = async (cmd, data) => {
    const { fetchFn } = nepController({ ...LOGIN_OK, ...SITE_API, ...eventsRoute(data) });
    const uit = [];
    await runCli(cmd, { secrets: geenSecrets, fetchFn, log: (s) => uit.push(s) });
    return uit.join("\n");
  };
  const ev = [{ event: "CLIENT_ROAMED", timestamp: Date.UTC(2026, 9, 1, 5, 0, 0), parameters: {} }];
  const regel = "Events beschikbaar vanaf 01-10-2026 07:00:00 (UniFi bewaart de system-log kort; historie via Grafana).";
  assert.ok((await run(["events", "aaa11111"], ev)).includes(regel));
  assert.ok((await run(["client", "aaa11111", "Telefoon-A"], ev)).includes(regel));
  assert.ok((await run(["events", "aaa11111"], [])).includes("Geen events in de system-log."));
  assert.ok((await run(["client", "aaa11111", "Telefoon-A"], [])).includes("Geen events in de system-log."));
});

test("foutmelding: voegt err.cause.code toe zonder URL of geheimen", async () => {
  const oorzaak = Object.assign(new Error("getaddrinfo mag niet getoond"), { code: "ENOTFOUND" });
  const err = new TypeError("fetch failed", { cause: oorzaak });
  assert.equal(foutmelding(err), "fetch failed (ENOTFOUND)");
  assert.equal(foutmelding(new Error("gewoon")), "gewoon");
  const fetchFn = async () => { throw err; };
  await assert.rejects(() => runCli(["sites"], { secrets: geenSecrets, fetchFn, log: () => {} }), (e) => foutmelding(e).includes("ENOTFOUND") && !foutmelding(e).includes("controller.voorbeeld"));
});
