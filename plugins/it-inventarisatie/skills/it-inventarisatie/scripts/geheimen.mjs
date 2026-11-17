// Geheimenfilter: verwijdert geheime sleutels uit data voordat die het werkbestand,
// rapport.json, een Autotask-notitie of stdout bereikt. Geen npm-deps.

const GEHEIME_WOORDEN = new Set([
  "pass", "password", "passwd", "wachtwoord", "ww", "secret", "psk", "pin", "puk", "token", "apikey", "wpa",
]);
const GEHEIME_DEELSTRINGS = ["licensekey", "licencekey", "productkey"];
// Een geheim-woord met daarna ":" of "=" en een waarde ("PSK: ...", "pincode = ..."), op woordgrenzen.
const VRIJE_TEKST = /\b(wachtwoord|password|passwd|ww|pin(code)?|puk|psk|wpa2?(-?key)?|token|wifi-?key|api-?key)\s*[:=]\s*\S+/i;

function woorden(naam) {
  return String(naam)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function isSecretKey(naam) {
  const delen = woorden(naam);
  // Losse woorden, plus aangrenzende paren zodat "apiKey" als "apikey" telt.
  const kandidaten = [...delen];
  for (let i = 0; i + 1 < delen.length; i++) kandidaten.push(delen[i] + delen[i + 1]);
  if (kandidaten.some((w) => GEHEIME_WOORDEN.has(w))) return true;
  const plat = delen.join("");
  return GEHEIME_DEELSTRINGS.some((s) => plat.includes(s));
}

export function scrubSecrets(value) {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === "object") {
    const uit = {};
    for (const [k, v] of Object.entries(value)) {
      if (!isSecretKey(k)) uit[k] = scrubSecrets(v);
    }
    return uit;
  }
  return value;
}

export function findSecretText(value, pad = []) {
  if (typeof value === "string") return VRIJE_TEKST.test(value) ? [pad.join(".")] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretText(v, [...pad, i]));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => findSecretText(v, [...pad, k]));
  }
  return [];
}
