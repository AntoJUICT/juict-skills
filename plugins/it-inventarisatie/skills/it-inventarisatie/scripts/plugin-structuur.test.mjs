import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

test("plugin.json is geldig en heet it-inventarisatie", () => {
  const pad = resolve(repoRoot, "plugins/it-inventarisatie/.claude-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(pad, "utf-8"));
  assert.equal(plugin.name, "it-inventarisatie");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20, "description moet inhoudelijk zijn");
});

test("marketplace.json bevat een it-inventarisatie entry die naar de plugin-map wijst", () => {
  const pad = resolve(repoRoot, ".claude-plugin/marketplace.json");
  const markt = JSON.parse(readFileSync(pad, "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "it-inventarisatie");
  assert.ok(entry, "it-inventarisatie ontbreekt in marketplace.json");
  assert.equal(entry.source, "./plugins/it-inventarisatie");
  assert.ok(existsSync(resolve(repoRoot, "plugins/it-inventarisatie")), "plugin-map bestaat niet");
});

// Zelfde controle als bij itglue-api: elke plugin uit marketplace.json heeft een tabelrij in de README.
test("README heeft een tabelrij voor elke plugin uit marketplace.json", () => {
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf-8");
  for (const plugin of markt.plugins) {
    assert.ok(
      readme.includes(`| \`${plugin.name}\` |`),
      `${plugin.name} staat in marketplace.json maar heeft geen tabelrij in README.md: werk de tabel "Skills in deze marketplace" bij`
    );
  }
});

test("README noemt it-inventarisatie onder Vereisten bij Key Vault en bij az login", () => {
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf-8");
  const start = readme.indexOf("\n## Vereisten");
  const eind = readme.indexOf("\n## ", start + 1);
  assert.ok(start >= 0 && eind > start, "sectie Vereisten niet gevonden");
  const sectie = readme.slice(start, eind);
  const regels = sectie.split("\n");
  const keyVault = regels.find((r) => r.includes("**Key Vault**"));
  const azLogin = regels.find((r) => r.includes("**az login**"));
  assert.ok(keyVault?.includes("`it-inventarisatie`"), "it-inventarisatie ontbreekt bij Key Vault onder Vereisten");
  assert.ok(azLogin?.includes("`it-inventarisatie`"), "it-inventarisatie ontbreekt bij az login onder Vereisten");
});

test("SKILL.md heeft frontmatter met name en description", () => {
  const pad = resolve(repoRoot, "plugins/it-inventarisatie/skills/it-inventarisatie/SKILL.md");
  const inhoud = readFileSync(pad, "utf-8");
  assert.match(inhoud, /^---\r?\nname: it-inventarisatie\r?\n/);
  assert.match(inhoud, /\ndescription: .{40,}/);
});
