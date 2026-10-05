import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

test("plugin.json is geldig en heet netwerk-diagnose", () => {
  const pad = resolve(repoRoot, "plugins/netwerk-diagnose/.claude-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(pad, "utf-8"));
  assert.equal(plugin.name, "netwerk-diagnose");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20, "description moet inhoudelijk zijn");
});

test("marketplace.json bevat een netwerk-diagnose entry die naar de plugin-map wijst", () => {
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "netwerk-diagnose");
  assert.ok(entry, "netwerk-diagnose ontbreekt in marketplace.json");
  assert.equal(entry.source, "./plugins/netwerk-diagnose");
  assert.ok(existsSync(resolve(repoRoot, "plugins/netwerk-diagnose")), "plugin-map bestaat niet");
});

// Op de tabelrij en niet op de naam ergens in het bestand: de naam staat ook in de Vereisten-lijst.
test("README heeft een tabelrij voor elke plugin uit marketplace.json", () => {
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf-8");
  for (const plugin of markt.plugins) {
    assert.ok(
      readme.includes(`| \`${plugin.name}\` |`),
      `${plugin.name} staat in marketplace.json maar heeft geen tabelrij in README.md`
    );
  }
});

test("SKILL.md heeft frontmatter met name en description", () => {
  const inhoud = readFileSync(resolve(repoRoot, "plugins/netwerk-diagnose/skills/netwerk-diagnose/SKILL.md"), "utf-8");
  assert.match(inhoud, /^---\r?\nname: netwerk-diagnose\r?\n/);
  assert.match(inhoud, /\ndescription: .{40,}/);
});

// Publieke repo: geen controller-hostnaam en geen IT Glue-ID's (16 cijfers) in de plugin, spec of plan.
// Een allowlist van generieke hosts in plaats van een blocklist: zo hoeft de echte hostnaam nergens te staan.
const TOEGESTANE_HOSTS = new Set([
  "example.local",
  "controller.voorbeeld",
  "juict-shared-kv.vault.azure.net",
  "github.com",
  "json.schemastore.org",
]);

function bestandenIn(map) {
  return readdirSync(map, { withFileTypes: true }).flatMap((d) => {
    const pad = resolve(map, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : bestandenIn(pad);
    return /\.(md|mjs|py|json)$/.test(d.name) ? [pad] : [];
  });
}

test("plugin, spec en plan bevatten alleen toegestane URL-hosts en geen echte organisatie-ID's", () => {
  const bestanden = [
    ...bestandenIn(resolve(repoRoot, "plugins/netwerk-diagnose")),
    resolve(repoRoot, "docs/superpowers/specs/2026-10-01-netwerk-diagnose-skill-design.md"),
    resolve(repoRoot, "docs/superpowers/plans/2026-10-01-netwerk-diagnose-skill.md"),
  ].filter((pad) => existsSync(pad));
  assert.ok(bestanden.length >= 8, "te weinig bestanden gescand");
  for (const pad of bestanden) {
    const rel = pad.slice(repoRoot.length + 1);
    const inhoud = readFileSync(pad, "utf-8");
    for (const m of inhoud.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      assert.ok(TOEGESTANE_HOSTS.has(m[1].toLowerCase()), `${rel} bevat een URL-host die niet op de allowlist staat (${m[1].length} tekens): voeg alleen generieke hosts toe`);
    }
    assert.doesNotMatch(inhoud, /\b(?!1234567890123456\b)(?!(\d)\1{15}\b)\d{16}\b/, `${rel} bevat een 16-cijferig ID dat geen testwaarde is (toegestaan: 1234567890123456 en herhaalde cijfers)`);
  }
});
