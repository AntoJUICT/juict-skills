import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const pluginMap = resolve(repoRoot, "plugins/smart-numbers");

test("plugin.json is geldig en heet smart-numbers", () => {
  const plugin = JSON.parse(readFileSync(resolve(pluginMap, ".claude-plugin/plugin.json"), "utf-8"));
  assert.equal(plugin.name, "smart-numbers");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20, "description moet inhoudelijk zijn");
});

test("marketplace.json bevat een smart-numbers entry die naar de plugin-map wijst", () => {
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "smart-numbers");
  assert.ok(entry, "smart-numbers ontbreekt in marketplace.json");
  assert.equal(entry.source, "./plugins/smart-numbers");
  assert.ok(existsSync(pluginMap), "plugin-map bestaat niet");
});

test("README heeft een tabelrij voor elke plugin uit marketplace.json", () => {
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf-8");
  for (const plugin of markt.plugins) {
    assert.ok(readme.includes(`| \`${plugin.name}\` |`), `${plugin.name} staat in marketplace.json maar heeft geen tabelrij in README.md`);
  }
});

test("SKILL.md heeft frontmatter met name en description", () => {
  const inhoud = readFileSync(resolve(pluginMap, "skills/smart-numbers/SKILL.md"), "utf-8");
  assert.match(inhoud, /^---\r?\nname: smart-numbers\r?\n/);
  assert.match(inhoud, /\ndescription: .{40,}/);
});

function bestandenIn(map) {
  return readdirSync(map, { withFileTypes: true }).flatMap((d) => {
    const pad = resolve(map, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : bestandenIn(pad);
    return [pad];
  });
}

// Publieke repo: codes, prijzen en afspraken horen in de directie-vault, niet hier.
test("de plugin bevat geen config, geen Autotask-ID's en geen inkoopprijzen", () => {
  const bestanden = bestandenIn(pluginMap);
  assert.ok(bestanden.length >= 5, "te weinig bestanden gescand");
  assert.ok(!bestanden.some((p) => /[\\/]config\.json$/.test(p)), "config.json hoort in de directie-vault, niet in de plugin");
  for (const pad of bestanden) {
    const rel = pad.slice(repoRoot.length + 1);
    const inhoud = readFileSync(pad, "utf-8");
    assert.doesNotMatch(inhoud, /\b29\d{6}\b/, `${rel} bevat een Autotask-ID (8 cijfers, begint met 29)`);
    assert.doesNotMatch(inhoud, /€\s?\d+[,.]\d{2}\b/, `${rel} bevat een eurobedrag met centen; prijzen horen in config.json in de directie-vault`);
  }
});
