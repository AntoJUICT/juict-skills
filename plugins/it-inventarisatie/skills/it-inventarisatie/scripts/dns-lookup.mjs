#!/usr/bin/env node
// DNS- en tenant-lookup voor een domein. Alleen lezen.
import { resolveMx as dnsMx, resolveNs as dnsNs } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { scrubSecrets } from './geheimen.mjs';

const EXO = '.mail.protection.outlook.com';
const VERIFICATIE = '.msv1.invalid';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const eindigtOp = (host, suffix) => String(host).toLowerCase().replace(/\.$/, '').endsWith(suffix);

export function tenantIdUitOpenId(json) {
  const endpoint = json && typeof json.token_endpoint === 'string' ? json.token_endpoint : '';
  const m = endpoint.match(/^https:\/\/login\.microsoftonline\.com\/([^/]+)\//i);
  return m && GUID.test(m[1]) ? m[1].toLowerCase() : null;
}

export async function lookupDomein(domein, deps = {}) {
  const resolveMx = deps.resolveMx ?? dnsMx;
  const resolveNs = deps.resolveNs ?? dnsNs;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const uit = { domein, mx: [], ns: [], m365Mail: false, reserveMx: [], verificatieMx: [], tenantId: null };

  try {
    uit.mx = (await resolveMx(domein))
      .map(({ exchange, priority }) => ({ exchange, priority }))
      .sort((a, b) => a.priority - b.priority);
  } catch (e) {
    uit.fout = e?.code ?? e?.message ?? 'onbekende fout';
  }
  try {
    uit.ns = (await resolveNs(domein)).slice().sort();
  } catch (e) {
    uit.fout ??= e?.code ?? e?.message ?? 'onbekende fout';
  }

  const exo = uit.mx.filter((m) => eindigtOp(m.exchange, EXO));
  uit.m365Mail = exo.length > 0;
  uit.verificatieMx = uit.mx.filter((m) => eindigtOp(m.exchange, VERIFICATIE)).map((m) => m.exchange);
  if (exo.length) {
    const laagste = Math.min(...exo.map((m) => m.priority));
    uit.reserveMx = uit.mx
      .filter((m) => !eindigtOp(m.exchange, EXO) && !eindigtOp(m.exchange, VERIFICATIE) && m.priority > laagste)
      .map((m) => m.exchange);
  }

  try {
    const res = await doFetch(`https://login.microsoftonline.com/${domein}/v2.0/.well-known/openid-configuration`);
    if (res.ok) uit.tenantId = tenantIdUitOpenId(await res.json());
  } catch {
    uit.tenantId = null;
  }
  return uit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const domeinen = process.argv.slice(2);
  if (!domeinen.length) {
    console.error('Gebruik: dns-lookup.mjs <domein> [<domein>...]');
    process.exitCode = 1;
  } else {
    const resultaat = [];
    for (const d of domeinen) resultaat.push(await lookupDomein(d));
    console.log(JSON.stringify(scrubSecrets(resultaat), null, 2));
  }
}
