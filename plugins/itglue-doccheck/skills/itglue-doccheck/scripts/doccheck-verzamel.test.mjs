import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseArgs, autotaskBase, isAutoType, kortVeld, overzicht, RUIS_TITELS, volgendePagina, controleerVaultNaam } from "./doccheck-verzamel.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

test("parseArgs eist numerieke ids en een datum", () => {
  const ok = parseArgs(["--org", "123", "--company", "45", "--sinds", "2026-05-20", "--uit", "x"]);
  assert.deepEqual(ok, { org: "123", company: "45", sinds: "2026-05-20", uit: "x" });
  assert.throws(() => parseArgs(["--org", "Voorbeeld B.V.", "--company", "45", "--sinds", "2026-05-20", "--uit", "x"]), /numerieke/);
  assert.throws(() => parseArgs(["--org", "1", "--company", "2", "--sinds", "20-05-2026", "--uit", "x"]), /YYYY-MM-DD/);
  assert.throws(() => parseArgs(["--org", "1", "--company", "2", "--sinds", "2026-05-20"]), /--uit is verplicht/);
});

test("autotaskBase zet een kale zone om naar webservicesNN", () => {
  assert.equal(autotaskBase("19"), "https://webservices19.autotask.net/ATServicesRest/V1.0");
  assert.equal(autotaskBase("webservices5.autotask.net"), "https://webservices5.autotask.net/ATServicesRest/V1.0");
  assert.equal(autotaskBase("https://webservices5.autotask.net/ATServicesRest/"), "https://webservices5.autotask.net/ATServicesRest/V1.0");
});

test("auto-sync types vallen buiten de gap-analyse", () => {
  assert.ok(isAutoType("MS365 Users (auto)"));
  assert.ok(isAutoType("Office 365 Licenses"));
  assert.ok(!isAutoType("AVD"));
});

test("kortVeld toont tagnamen en maakt HTML plat", () => {
  assert.equal(kortVeld({ type: "Configurations", values: [{ id: 1, name: "srv-01" }, { id: 2, name: "srv-02" }] }), "srv-01, srv-02");
  assert.equal(kortVeld("<p>Een&nbsp;<b>tekst</b></p>"), "Een tekst");
});

test("overzicht laat ruis-tickets en auto-types weg en toont archived", () => {
  const itglue = {
    flexible_assets: [
      { type: "AVD", name: "AVD", id: "1", archived: false, updated: "2026-08-13T00:00:00Z", traits: { a: "x" } },
      { type: "VPN", name: "Oud", id: "2", archived: true, updated: "2026-08-13T00:00:00Z", traits: {} },
      { type: "MS365 Users (auto)", name: "Jan", id: "3", archived: false, updated: "2026-08-13T00:00:00Z", traits: {} },
    ],
    configurations: [],
    domains: [],
    documents: [],
    passwords: [],
  };
  const tickets = [
    { nr: "T1", created: "2026-06-01", title: "Wachtwoord wijziging Jan", resolution: "", time: [], notes: [] },
    { nr: "T2", created: "2026-06-02", title: "Nieuwe printer", resolution: "Geplaatst", time: [], notes: [] },
  ];
  const txt = overzicht(itglue, tickets, "2026-05-20");
  assert.match(txt, /\[AVD\] AVD/);
  assert.match(txt, /\[VPN\] Oud .*GEARCHIVEERD/);
  assert.doesNotMatch(txt, /MS365 Users/);
  assert.doesNotMatch(txt, /Wachtwoord wijziging/);
  assert.match(txt, /T2 \| 2026-06-02 \| Nieuwe printer \|\| Geplaatst/);
  assert.ok(RUIS_TITELS.test("Halfjaarlijkse documentatiecheck IT Glue"));
});

test("plugin.json, marketplace-entry, README-rij en SKILL-frontmatter kloppen", () => {
  const plugin = JSON.parse(readFileSync(resolve(repoRoot, "plugins/itglue-doccheck/.claude-plugin/plugin.json"), "utf-8"));
  assert.equal(plugin.name, "itglue-doccheck");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "itglue-doccheck");
  assert.equal(entry?.source, "./plugins/itglue-doccheck");
  assert.ok(existsSync(resolve(repoRoot, "plugins/itglue-doccheck")));
  assert.ok(readFileSync(resolve(repoRoot, "README.md"), "utf-8").includes("| `itglue-doccheck` |"));
  const skill = readFileSync(resolve(repoRoot, "plugins/itglue-doccheck/skills/itglue-doccheck/SKILL.md"), "utf-8");
  assert.match(skill, /^---\r?\nname: itglue-doccheck\r?\n/);
  assert.match(skill, /\ndescription: Gebruik bij .{40,}/);
});

test("nextPageUrl wordt alleen gevolgd op dezelfde origin", () => {
  const base = "https://webservices19.autotask.net/ATServicesRest/V1.0";
  assert.equal(volgendePagina(null, base), null);
  assert.equal(
    volgendePagina("https://webservices19.autotask.net/ATServicesRest/V1.0/Tickets/query/next?paging=abc", base),
    "https://webservices19.autotask.net/ATServicesRest/V1.0/Tickets/query/next?paging=abc",
  );
  assert.throws(() => volgendePagina("https://evil.example.com/x", base), /andere host/);
  assert.throws(() => volgendePagina("http://webservices19.autotask.net/x", base), /andere host/);
  assert.throws(() => volgendePagina("niet-een-url", base), /onleesbare/);
});

test("Key Vault-naam wordt gevalideerd voor hij naar az gaat", () => {
  assert.equal(controleerVaultNaam("juict-shared-kv"), "juict-shared-kv");
  assert.throws(() => controleerVaultNaam("kv; rm -rf /"), /Ongeldige/);
  assert.throws(() => controleerVaultNaam("a"), /Ongeldige/);
});
