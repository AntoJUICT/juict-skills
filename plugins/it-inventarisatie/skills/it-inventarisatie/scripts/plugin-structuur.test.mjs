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

test("CLI's zetten process.exitCode in plaats van process.exit(), zodat stdout volledig wordt geschreven", async () => {
  const { readdirSync } = await import("node:fs");
  const mappen = [here, resolve(here, "rapport")];
  for (const map of mappen) {
    for (const naam of readdirSync(map).filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs"))) {
      const inhoud = readFileSync(resolve(map, naam), "utf-8");
      assert.ok(!inhoud.includes("process.exit("), `${naam} gebruikt process.exit()`);
    }
  }
});

test("projectstart-skill bestaat met geldige frontmatter", () => {
  const skill = readFileSync(resolve(repoRoot, "plugins/it-inventarisatie/skills/projectstart/SKILL.md"), "utf-8");
  assert.match(skill, /^---\r?\nname: projectstart\r?\ndescription: .{40,}\r?\n---/);
});

test("plugin-versie is minstens 0.3.0", () => {
  const plugin = JSON.parse(readFileSync(resolve(repoRoot, "plugins/it-inventarisatie/.claude-plugin/plugin.json"), "utf-8"));
  const [maj, min] = plugin.version.split(".").map(Number);
  assert.ok(maj > 0 || min >= 3);
});

// Een YAML-waarde is veilig als hij gequote is, of geen ': ' of '#' bevat.
const isYamlVeilig = (regel) => {
  const gequote = /^"[^"]*"$/.test(regel) || /^'[^']*'$/.test(regel);
  return gequote || !/: |#/.test(regel);
};

test("isYamlVeilig herkent gequote en kale waarden", () => {
  assert.equal(isYamlVeilig('"abc: def"'), true);
  assert.equal(isYamlVeilig("'abc: def'"), true);
  assert.equal(isYamlVeilig("abc def"), true);
  assert.equal(isYamlVeilig("abc: def"), false);
  assert.equal(isYamlVeilig('"abc" en "def: x"'), false);
});

test("projectstart: description in de frontmatter is YAML-veilig en REFERENCE.md bestaat", () => {
  const map = resolve(repoRoot, "plugins/it-inventarisatie/skills/projectstart");
  const skill = readFileSync(resolve(map, "SKILL.md"), "utf-8");
  const regel = /\ndescription: (.*)\r?\n/.exec(skill)[1];
  assert.ok(isYamlVeilig(regel), "description bevat ': ' of '#' zonder aanhalingstekens");
  assert.ok(existsSync(resolve(map, "REFERENCE.md")), "REFERENCE.md ontbreekt");
  const plugin = JSON.parse(readFileSync(resolve(repoRoot, "plugins/it-inventarisatie/.claude-plugin/plugin.json"), "utf-8"));
  assert.ok(plugin.keywords.includes("projectstart"), "keyword projectstart ontbreekt in plugin.json");
});

test("projectstart: elk script dat SKILL.md en REFERENCE.md noemen bestaat", () => {
  const map = resolve(repoRoot, "plugins/it-inventarisatie/skills/projectstart");
  const tekst = ["SKILL.md", "REFERENCE.md"].map((n) => readFileSync(resolve(map, n), "utf-8")).join("\n");
  const paden = new Set([...tekst.matchAll(/<(skill|it)>\/(scripts\/[\w/.-]+\.(?:mjs|ps1))/g)].map((m) => `${m[1]}|${m[2]}`));
  for (const m of tekst.matchAll(/`(scripts\/[\w/.-]+\.(?:mjs|ps1))`/g)) paden.add(`skill|${m[1]}`);
  assert.ok(paden.size >= 8, "te weinig scriptverwijzingen gevonden");
  for (const p of paden) {
    const [basis, rel] = p.split("|");
    const pad = basis === "it" ? resolve(map, "../it-inventarisatie", rel) : resolve(map, rel);
    assert.ok(existsSync(pad), `${basis}/${rel} bestaat niet`);
  }
});
