import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const skillDir = resolve(repoRoot, "plugins/datto-rmm-api/skills/datto-rmm-api");

test("plugin.json is geldig en heet datto-rmm-api", () => {
  const pad = resolve(repoRoot, "plugins/datto-rmm-api/.claude-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(pad, "utf-8"));
  assert.equal(plugin.name, "datto-rmm-api");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20, "description moet inhoudelijk zijn");
});

test("marketplace.json bevat een datto-rmm-api entry die naar de plugin-map wijst", () => {
  const pad = resolve(repoRoot, ".claude-plugin/marketplace.json");
  const markt = JSON.parse(readFileSync(pad, "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "datto-rmm-api");
  assert.ok(entry, "datto-rmm-api ontbreekt in marketplace.json");
  assert.equal(entry.source, "./plugins/datto-rmm-api");
  assert.ok(existsSync(resolve(repoRoot, "plugins/datto-rmm-api")), "plugin-map bestaat niet");
});

test("README heeft een tabelrij voor datto-rmm-api", () => {
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf-8");
  assert.ok(
    readme.includes("| `datto-rmm-api` |"),
    'datto-rmm-api heeft geen tabelrij in README.md: werk de tabel "Skills in deze marketplace" bij',
  );
});

test("SKILL.md heeft frontmatter met name en description", () => {
  const inhoud = readFileSync(resolve(skillDir, "SKILL.md"), "utf-8");
  assert.match(inhoud, /^---\r?\nname: datto-rmm-api\r?\n/);
  assert.match(inhoud, /\ndescription: .{40,}/);
});

test("REFERENCE.md en LESSONS.md bestaan en worden vanuit SKILL.md gelinkt", () => {
  const skill = readFileSync(resolve(skillDir, "SKILL.md"), "utf-8");
  for (const bestand of ["REFERENCE.md", "LESSONS.md"]) {
    assert.ok(existsSync(resolve(skillDir, bestand)), `${bestand} ontbreekt`);
    assert.ok(skill.includes(`(${bestand})`), `SKILL.md linkt niet naar ${bestand}`);
  }
});

// De harde blokkade op resetApiKeys is de reden dat deze skill veilig te gebruiken is met
// schrijfrechten. Verdwijnt hij uit de broncode, dan is dat geen refactor maar een gedragswijziging.
test("de resetApiKeys-blokkade staat in zowel de CLI als de client", () => {
  for (const bestand of ["scripts/datto-lookup.mjs", "scripts/datto-client.ts"]) {
    const bron = readFileSync(resolve(skillDir, bestand), "utf-8");
    assert.ok(
      /resetapikeys/i.test(bron),
      `${bestand} bevat geen resetApiKeys-blokkade meer`,
    );
  }
});

// Dry-run-by-default is de tweede rail: zonder --confirm mag geen enkele schrijfactie vertrekken.
test("de CLI voert een schrijfactie alleen uit achter een confirm-vlag", () => {
  const bron = readFileSync(resolve(skillDir, "scripts/datto-lookup.mjs"), "utf-8");
  assert.ok(bron.includes("if (!vlaggen.confirm)"), "de dry-run-poort ontbreekt in voerSchrijfactieUit");
  assert.ok(bron.includes("DRY-RUN"), "de dry-run-melding ontbreekt");
});
