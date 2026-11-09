// SMART Numbers: alles wat uit Autotask komt, voor één maand.
// Gebruik: node bereken.mjs JJJJ-MM [--json]
//
// Codes, prijzen en indelingsregels staan NIET in deze publieke repo. Ze komen uit
// de directie-vault: financien/smart-numbers/config.json (of SMART_NUMBERS_CONFIG).
// Autotask-credentials komen via `az` uit de shared Key Vault en worden nooit geprint.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DAG = 864e5;
const PERIODE_RE = /(\d\d)-(\d\d)-(\d{4}) - (\d\d)-(\d\d)-(\d{4})/;

export function configPad(env = process.env) {
  if (env.SMART_NUMBERS_CONFIG) return env.SMART_NUMBERS_CONFIG;
  const home = env.USERPROFILE || env.HOME || "";
  return join(home, "JUICT-Brain", "vault-juict-directie", "financien", "smart-numbers", "config.json");
}

export function laadConfig(pad) {
  if (!existsSync(pad)) {
    throw new Error(`Config niet gevonden (${pad}). Deze skill heeft de directie-vault nodig; zonder die vault zijn er geen cijfers.`);
  }
  return JSON.parse(readFileSync(pad, "utf-8"));
}

// Zet de config om naar sets en lookups waar de rekenfuncties mee werken.
export function bouwRegels(C) {
  const getallen = (o) => new Set(Object.keys(o).filter((k) => /^\d+$/.test(k)).map(Number));
  return {
    mrr: getallen(C.mrrCodes), orr: getallen(C.orrCodes), prod: getallen(C.productCodes),
    addonCode: C.addonCode, addonMrr: getallen(C.addonMrrServices), easywork: C.easyworkCode,
    shift: Object.fromEntries(Object.entries(C.licentieVerschuiving).filter(([k]) => /^\d+$/.test(k)).map(([k, v]) => [Number(k), v])),
    seatUit: getallen(C.seatServicesUitgesloten),
    liteRe: new RegExp(C.alleenLitePatroon || "Lite", "i"),
    ps: new Set(C.psWorkTypes), machine: new Set(C.machineBronnen),
    dienst: C.dienstOnderProductcode.map((p) => new RegExp(p, "i")),
    overigCode: C.overigCode, overigRegels: C.overigRegels.map((r) => ({ re: new RegExp(r.patroon, "i"), categorie: r.categorie })),
    goToMarket: C.goToMarket,
  };
}

export function maandGrenzen(y, m) { return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)]; }

// Factuurperiode uit de regelomschrijving, als [start, eind) in ms. Null als er geen periode in staat.
export function periode(item) {
  const p = (item.lineItemFullDescription || "").match(PERIODE_RE);
  if (!p) return null;
  return [Date.UTC(+p[3], +p[2] - 1, +p[1]), Date.UTC(+p[6], +p[5] - 1, +p[4]) + DAG];
}

// Genormaliseerde MRR en ORR per klant, seats en de licentieverschuiving voor maand (y, m).
// Elke abonnementsregel telt naar rato van de dagen van zijn factuurperiode die in de maand vallen.
// Regels zonder periode tellen alleen als ORR (verbruik), op hun boekdatum.
export function normaliseer(items, y, m, R) {
  const [ms, me] = maandGrenzen(y, m);
  const mrr = {}, orr = {}, seatsPerVariant = {}, beheerd = new Set();
  let shift = 0, seats = 0;
  for (const b of items) {
    const c = b.billingCodeID, p = periode(b);
    let f;
    if (p) { const ov = Math.min(p[1], me) - Math.max(p[0], ms); if (ov <= 0) continue; f = ov / (p[1] - p[0]); }
    else { if (!R.orr.has(c)) continue; const d = Date.parse(b.itemDate); if (d < ms || d >= me) continue; f = 1; }
    const maanden = p ? (p[1] - p[0]) / DAG / 30.44 : 1;
    let cat = null;
    if (R.mrr.has(c)) cat = "MRR";
    else if (c === R.addonCode) cat = R.addonMrr.has(b.serviceID) ? "MRR" : "ORR";
    else if (R.orr.has(c)) cat = "ORR";
    if (!cat) continue;
    const doel = cat === "MRR" ? mrr : orr;
    doel[b.companyID] = (doel[b.companyID] || 0) + (b.extendedPrice || 0) * f;
    if (R.mrr.has(c) && !(c === R.easywork && R.liteRe.test(b.itemName || "")) && (b.quantity || 0) > 0) beheerd.add(b.companyID);
    if (c === R.easywork) {
      if (R.shift[b.serviceID]) {
        const s = R.shift[b.serviceID] * (b.quantity || 0) * maanden * f;
        shift += s; mrr[b.companyID] -= s; orr[b.companyID] = (orr[b.companyID] || 0) + s;
      }
      if (!R.seatUit.has(b.serviceID) && (b.extendedPrice || 0) !== 0) {
        seats += b.quantity || 0;
        const n = b.itemName || String(b.serviceID);
        seatsPerVariant[n] = (seatsPerVariant[n] || 0) + (b.quantity || 0);
      }
    }
  }
  return { mrr, orr, shift, seats, seatsPerVariant, beheerd };
}

export const som = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// MRR-mutaties per klant tussen twee genormaliseerde maanden.
export function mutaties(was, nu, drempel = 0.5) {
  let groei = 0, daling = 0, nieuwBedrag = 0, verlorenBedrag = 0;
  const nieuw = [], verloren = [];
  for (const k of new Set([...Object.keys(was), ...Object.keys(nu)])) {
    const a = was[k] || 0, b = nu[k] || 0;
    if (a <= drempel) { if (b > drempel) { nieuwBedrag += b; nieuw.push([Number(k), b]); } }
    else if (b <= drempel) { verlorenBedrag += a; verloren.push([Number(k), a]); }
    else if (b > a) groei += b - a; else daling += a - b;
  }
  return { groei, daling, nieuwBedrag, verlorenBedrag, nieuw, verloren };
}

// Geboekte omzet buiten de abonnementen: NRR, Product Sales, Misc en wat niet meetelt.
export function deelGeboektIn(items, R) {
  // ORR hier = losse charges die als licentie tellen (bv. een afkoop), geboekt in de factuurmaand.
  const t = { NRR: 0, SALES: 0, MISC: 0, ORR: 0, EXCL: 0 };
  const beoordelen = [], onbekend = [], overig = [];
  for (const b of items) {
    const c = b.billingCodeID, n = b.itemName || "", a = b.extendedPrice || 0;
    if (R.mrr.has(c) || R.orr.has(c) || c === R.addonCode) continue;
    let cat;
    if (b.billingItemType === 1) cat = "NRR";
    else if (R.prod.has(c)) cat = R.dienst.some((r) => r.test(n)) ? "NRR" : "SALES";
    else if (c === R.overigCode) {
      const r = R.overigRegels.find((r) => r.re.test(n));
      cat = r ? r.categorie : "NRR";
      overig.push({ regel: n, bedrag: a, categorie: cat, zekerheid: r ? "regel" : "BEOORDELEN" });
      if (!r) beoordelen.push(`${n} (${a.toFixed(2)}) staat voorlopig op NRR`);
    }
    else if (b.billingItemType === 3) cat = "NRR";
    else { cat = "NRR"; onbekend.push(`billing code ${c} "${n}" ${a.toFixed(2)}`); }
    t[cat] += a;
  }
  return { t, beoordelen, onbekend, overig };
}

// Reactief: geen change, geen alert of machinebron, geen PS-work type, niet intern, alleen managed klanten.
export function isReactief(ticket, msa, R) {
  return ticket.companyID !== 0 && msa.has(ticket.companyID) && ticket.ticketType !== 4 && ticket.ticketType !== 5
    && !R.machine.has(ticket.source) && !R.ps.has(ticket.billingCodeID);
}

// Eenmalige omzet telt op factuurdatum, zodat hij aansluit op Exact: alle BillingItems op de
// (niet-vervallen) facturen met een factuurdatum in de maand. Terugkerende regels filtert
// deelGeboektIn er zelf uit. `query` is de Autotask-query (in tests een nep).
export async function gefactureerdeRegels(query, FROM, TO) {
  const facturen = (await query("Invoices", [{ field: "invoiceDateTime", op: "gte", value: FROM }, { field: "invoiceDateTime", op: "lt", value: TO }]))
    .filter((x) => !x.isVoided);
  const regels = [];
  for (let i = 0; i < facturen.length; i += 200)
    regels.push(...await query("BillingItems", [{ field: "invoiceID", op: "in", value: facturen.slice(i, i + 200).map((x) => x.id) }]));
  return { facturen: facturen.length, regels };
}

// ---- Autotask ----
function autotask() {
  const kv = (n) => execSync(`az keyvault secret show --vault-name juict-shared-kv -n ${n} --query value -o tsv`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  const H = { UserName: kv("AUTOTASK-USERNAME"), Secret: kv("AUTOTASK-API-KEY"), ApiIntegrationCode: kv("AUTOTASK-INTEGRATION-CODE"), "Content-Type": "application/json" };
  const BASE = `https://webservices${kv("AUTOTASK-ZONE")}.autotask.net/ATServicesRest/V1.0`;
  async function req(url, opt = {}) {
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(url, { headers: H, ...opt });
        const t = await r.text();
        if (!r.ok) { const e = new Error(`${url.replace(BASE, "")} ${r.status} ${t.slice(0, 200)}`); e.http = true; throw e; }
        return JSON.parse(t);
      } catch (e) { if (i === 3 || e.http) throw e; await new Promise((s) => setTimeout(s, 2000 * (i + 1))); }
    }
  }
  // Paginering: de next-URL van een query moet ook met POST en dezelfde body.
  return async function query(entity, filter) {
    const body = JSON.stringify({ filter: [{ op: "and", items: filter }] });
    const out = [];
    let j = await req(`${BASE}/${entity}/query`, { method: "POST", body });
    out.push(...j.items);
    while (j.pageDetails && j.pageDetails.nextPageUrl) { j = await req(j.pageDetails.nextPageUrl, { method: "POST", body }); out.push(...j.items); }
    return out;
  };
}

const iso = (y, m) => `${y}-${String(m).padStart(2, "0")}-01`;

export async function bereken(maand, R, query) {
  const [Y, M] = maand.split("-").map(Number);
  const vorige = M === 1 ? [Y - 1, 12] : [Y, M - 1];
  const volgende = M === 12 ? [Y + 1, 1] : [Y, M + 1];
  const FROM = iso(Y, M), TO = iso(...volgende);
  // 14 maanden terug, zodat kwartaal- en jaarfacturen die deze of de vorige maand dekken meetellen
  const start = iso(...(M <= 2 ? [Y - 2, M + 10] : [Y - 1, M - 2]));
  const abo = await query("BillingItems", [{ field: "itemDate", op: "gte", value: start }, { field: "itemDate", op: "lt", value: TO },
    { field: "billingCodeID", op: "in", value: [...R.mrr, ...R.orr, R.addonCode] }]);
  const nu = normaliseer(abo, Y, M, R), was = normaliseer(abo, ...vorige, R);
  const msa = new Set(Object.entries(nu.mrr).filter(([k, v]) => v > 0.5 && nu.beheerd.has(Number(k))).map(([k]) => Number(k)));

  const gefactureerd = await gefactureerdeRegels(query, FROM, TO);
  const { t, beoordelen, onbekend, overig } = deelGeboektIn(gefactureerd.regels, R);
  const mut = mutaties(was.mrr, nu.mrr);

  const f = FROM + "T00:00:00", e = TO + "T00:00:00";
  const aangemaakt = await query("Tickets", [{ field: "createDate", op: "gte", value: f }, { field: "createDate", op: "lt", value: e }]);
  const gesloten = await query("Tickets", [{ field: "completedDate", op: "gte", value: f }, { field: "completedDate", op: "lt", value: e }]);
  const te = await query("TimeEntries", [{ field: "dateWorked", op: "gte", value: f }, { field: "dateWorked", op: "lt", value: e }]);
  const tk = {};
  [...aangemaakt, ...gesloten].forEach((x) => (tk[x.id] = x));
  const ontbrekend = [...new Set(te.filter((x) => x.ticketID && !tk[x.ticketID]).map((x) => x.ticketID))];
  for (let i = 0; i < ontbrekend.length; i += 200)
    (await query("Tickets", [{ field: "id", op: "in", value: ontbrekend.slice(i, i + 200) }])).forEach((x) => (tk[x.id] = x));
  const reactief = (x) => isReactief(x, msa, R);
  const reactieveUren = te.reduce((s, x) => s + (x.ticketID && tk[x.ticketID] && reactief(tk[x.ticketID]) ? x.hoursWorked || 0 : 0), 0);
  const urenTotaal = te.reduce((s, x) => s + (x.hoursWorked || 0), 0);

  const namen = {};
  const ids = [...new Set([...mut.nieuw, ...mut.verloren].map(([k]) => k))];
  if (ids.length) (await query("Companies", [{ field: "id", op: "in", value: ids }])).forEach((c) => (namen[c.id] = c.companyName));
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    maand,
    general: { seatsManaged: nu.seats, managedServicesAgreements: msa.size, seatsPerVariant: nu.seatsPerVariant },
    operations: { reactiveTicketsCreated: aangemaakt.filter(reactief).length, reactiveTicketsClosed: gesloten.filter(reactief).length,
      totalTimeReactiveHours: r2(reactieveUren), controle_urenGeregistreerdTotaal: r2(urenTotaal) },
    revenue: { NRR: r2(t.NRR), MRR: r2(som(nu.mrr)), ORR: r2(som(nu.orr) + t.ORR), productSales: r2(t.SALES), misc: r2(t.MISC),
      nietMeegenomen: r2(t.EXCL), licentieVerschuivingNaarORR: r2(nu.shift), controle_losseChargeORR: r2(t.ORR), controle_facturen: gefactureerd.facturen },
    sales: { newAgreements: mut.nieuw.length, newLogoMRR: r2(mut.nieuwBedrag),
      goToMarketSeatPrice: Math.round(R.goToMarket.verkoop - R.goToMarket.licentieInkoop) },
    mrrChanges: { existingGrowth: r2(mut.groei), existingDecrease: r2(mut.daling), lostMRR: r2(mut.verlorenBedrag),
      lostAgreements: mut.verloren.length, controle_mrrVorigeMaand: r2(som(was.mrr)) },
    details: {
      nieuw: mut.nieuw.map(([k, v]) => ({ klant: namen[k] || k, mrr: r2(v) })),
      verloren: mut.verloren.map(([k, v]) => ({ klant: namen[k] || k, mrr: r2(v) })),
      losseChargeOverig: overig, beoordelen, onbekendeBillingCodes: onbekend,
    },
  };
}

async function main() {
  const maand = process.argv[2];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(maand || "")) { console.error("Gebruik: node bereken.mjs JJJJ-MM [--json]"); process.exit(1); }
  const R = bouwRegels(laadConfig(configPad()));
  const out = await bereken(maand, R, autotask());
  if (process.argv.includes("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
  const eur = (x) => "€ " + Math.round(x).toLocaleString("nl-NL");
  const regels = [
    ["1", "Seats Managed", out.general.seatsManaged], ["2", "Managed Services Agreements", out.general.managedServicesAgreements],
    ["11", "Reactive Tickets Created", out.operations.reactiveTicketsCreated], ["12", "Reactive Tickets Closed", out.operations.reactiveTicketsClosed],
    ["13", "Total Time Reactive (u)", out.operations.totalTimeReactiveHours.toLocaleString("nl-NL")],
    ["21", "NRR", eur(out.revenue.NRR)], ["22", "MRR", eur(out.revenue.MRR)], ["24", "ORR", eur(out.revenue.ORR)],
    ["25", "Product Sales", eur(out.revenue.productSales)], ["26", "Misc", eur(out.revenue.misc)],
    ["42", "New Agreements", out.sales.newAgreements], ["43", "New Logo MRR", eur(out.sales.newLogoMRR)],
    ["44", "Go To Market Seat Price", `€ ${out.sales.goToMarketSeatPrice}`],
    ["49", "Existing MRR Growth", eur(out.mrrChanges.existingGrowth)], ["50", "Existing MRR Decrease", eur(out.mrrChanges.existingDecrease)],
    ["51", "Lost MRR", eur(out.mrrChanges.lostMRR)], ["52", "Lost Agreements", out.mrrChanges.lostAgreements],
  ];
  console.log(`SMART Numbers ${maand} (Autotask)\n`);
  for (const [n, naam, w] of regels) console.log(`${n.padEnd(3)}${naam.padEnd(30)}${w}`);
  console.log("\nDetails:", JSON.stringify(out.details, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("FOUT:", e.message); process.exit(1); });
}
