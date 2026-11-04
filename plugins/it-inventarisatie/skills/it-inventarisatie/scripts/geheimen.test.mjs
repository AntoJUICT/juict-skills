import test from "node:test";
import assert from "node:assert/strict";
import { isSecretKey, scrubSecrets, findSecretText } from "./geheimen.mjs";

test("isSecretKey herkent geheime sleutels", () => {
  for (const k of ["password", "WiFi_PSK", "adminPin", "puk", "apiKey", "licenseKey", "wachtwoord", "ww", "wifiWw", "wifi-token", "Product Key", "productkey"]) {
    assert.equal(isSecretKey(k), true, k);
  }
});

test("isSecretKey laat gewone sleutels met rust", () => {
  for (const k of ["passive", "pinned", "spinner", "typeName", "naam", "opmerking"]) {
    assert.equal(isSecretKey(k), false, k);
  }
});

test("scrubSecrets verwijdert diep en laat de rest intact", () => {
  const invoer = { a: 1, ww: { password: "x" }, lijst: [{ secret: "y", naam: "n" }, 5] };
  const kopie = structuredClone(invoer);
  assert.deepEqual(scrubSecrets(invoer), { a: 1, lijst: [{ naam: "n" }, 5] });
  assert.deepEqual(invoer, kopie);
});

test("findSecretText geeft paden", () => {
  assert.deepEqual(findSecretText({ notitie: "Firewall wachtwoord: abc123" }), ["notitie"]);
  assert.deepEqual(findSecretText({ lijst: [{ tekst: "ww=abc" }], a: { b: "niets" } }), ["lijst.0.tekst"]);
  assert.deepEqual(findSecretText({ x: "wachtwoord staat in de kluis" }), []);
});

test("findSecretText vangt ook pincode, PUK, PSK, WPA, token, wifi-key en API-key in vrije tekst", () => {
  for (const tekst of [
    "Telefoon pin: 1234", "Pincode = 4321", "PUK: 12345678", "Gastnetwerk PSK: Zomer2026", "WPA: Zomer2026", "WPA2-key: Zomer2026",
    "token: abc123", "Wifi-key: Zomer2026", "wifikey=Zomer2026", "API-key: sk-123", "apikey=sk-123",
  ]) {
    assert.deepEqual(findSecretText({ t: tekst }), ["t"], tekst);
  }
});

test("findSecretText: geen valse positieven op gewone woorden", () => {
  for (const tekst of [
    "Opinie: positief", "spinner: 3", "Pinned: ja", "Tokens worden in IT Glue bewaard", "Beveiliging: WPA2 met een gastnetwerk",
    "De pincode staat in IT Glue", "Wifi: twee access points", "Shopping: geen", "Wwise: n.v.t.",
  ]) {
    assert.deepEqual(findSecretText({ t: tekst }), [], tekst);
  }
});

test("de voorbeeldbestanden bevatten geen vrije-tekstgeheimen", async () => {
  const { readFileSync } = await import("node:fs");
  for (const naam of ["rapport.voorbeeld.json", "inventarisatie.voorbeeld.json"]) {
    const data = JSON.parse(readFileSync(new URL(`../voorbeeld/${naam}`, import.meta.url), "utf8"));
    assert.deepEqual(findSecretText(data), [], naam);
  }
});
