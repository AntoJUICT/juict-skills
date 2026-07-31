import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

test("plugin.json is geldig en heet itglue-api", () => {
  const pad = resolve(repoRoot, "plugins/itglue-api/.claude-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(pad, "utf-8"));
  assert.equal(plugin.name, "itglue-api");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20, "description moet inhoudelijk zijn");
});

test("marketplace.json bevat een itglue-api entry die naar de plugin-map wijst", () => {
  const pad = resolve(repoRoot, ".claude-plugin/marketplace.json");
  const markt = JSON.parse(readFileSync(pad, "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "itglue-api");
  assert.ok(entry, "itglue-api ontbreekt in marketplace.json");
  assert.equal(entry.source, "./plugins/itglue-api");
  assert.ok(existsSync(resolve(repoRoot, "plugins/itglue-api")), "plugin-map bestaat niet");
});

test("SKILL.md heeft frontmatter met name en description", () => {
  const pad = resolve(repoRoot, "plugins/itglue-api/skills/itglue-api/SKILL.md");
  const inhoud = readFileSync(pad, "utf-8");
  assert.match(inhoud, /^---\r?\nname: itglue-api\r?\n/);
  assert.match(inhoud, /\ndescription: .{40,}/);
});
