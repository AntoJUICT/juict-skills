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
