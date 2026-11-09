import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupDomein, tenantIdUitOpenId } from './dns-lookup.mjs';

const GUID = '11111111-2222-3333-4444-555555555555';
const openidOk = async () => ({
  ok: true,
  json: async () => ({ token_endpoint: `https://login.microsoftonline.com/${GUID}/oauth2/v2.0/token` }),
});
const maak = (mx, extra = {}) => ({
  resolveMx: async () => mx,
  resolveNs: async () => ['ns1.voorbeeldtechniek.nl'],
  fetch: openidOk,
  ...extra,
});

test('Exchange Online MX geeft m365Mail true en tenantId', async () => {
  const r = await lookupDomein('voorbeeldtechniek.nl', maak([{ exchange: 'voorbeeldtechniek-nl.mail.protection.outlook.com', priority: 0 }]));
  assert.equal(r.m365Mail, true);
  assert.equal(r.tenantId, GUID);
  assert.deepEqual(r.ns, ['ns1.voorbeeldtechniek.nl']);
  assert.deepEqual(r.reserveMx, []);
});

test('eigen mailserver geeft m365Mail false', async () => {
  const r = await lookupDomein('voorbeeldtechniek.nl', maak([{ exchange: 'mail.voorbeeldtechniek.nl', priority: 10 }]));
  assert.equal(r.m365Mail, false);
  assert.deepEqual(r.reserveMx, []);
});

test('alle MX-records blijven, gesorteerd, met reserve en verificatie', async () => {
  const r = await lookupDomein('voorbeeldtechniek.nl', maak([
    { exchange: 'ms12345678.msv1.invalid', priority: 50 },
    { exchange: 'mail.voorbeeldtechniek.nl', priority: 10 },
    { exchange: 'voorbeeldtechniek-nl.mail.protection.outlook.com', priority: 0 },
  ]));
  assert.equal(r.m365Mail, true);
  assert.equal(r.mx.length, 3);
  assert.deepEqual(r.mx.map((m) => m.priority), [0, 10, 50]);
  assert.deepEqual(r.reserveMx, ['mail.voorbeeldtechniek.nl']);
  assert.deepEqual(r.verificatieMx, ['ms12345678.msv1.invalid']);
});

test('host met lagere of gelijke prioriteit dan Exchange Online is geen reserve', async () => {
  const r = await lookupDomein('voorbeeldtechniek.nl', maak([
    { exchange: 'oud.voorbeeldtechniek.nl', priority: 5 },
    { exchange: 'voorbeeldtechniek-nl.mail.protection.outlook.com', priority: 10 },
  ]));
  assert.deepEqual(r.reserveMx, []);
});

test('tenantIdUitOpenId pakt de GUID', () => {
  assert.equal(tenantIdUitOpenId({ token_endpoint: `https://login.microsoftonline.com/${GUID}/oauth2/v2.0/token` }), GUID);
  assert.equal(tenantIdUitOpenId({}), null);
  assert.equal(tenantIdUitOpenId(null), null);
});

test('openid 400 geeft tenantId null', async () => {
  const r = await lookupDomein('voorbeeldtechniek.nl', maak(
    [{ exchange: 'mail.voorbeeldtechniek.nl', priority: 10 }],
    { fetch: async () => ({ ok: false, status: 400, json: async () => ({}) }) },
  ));
  assert.equal(r.tenantId, null);
});

test('fetch die gooit geeft tenantId null', async () => {
  const r = await lookupDomein('voorbeeldtechniek.nl', maak([], { fetch: async () => { throw new Error('netwerk'); } }));
  assert.equal(r.tenantId, null);
});

test('resolveMx fout geeft lege lijst en fout', async () => {
  const r = await lookupDomein('voorbeeldtechniek.nl', maak([], {
    resolveMx: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); },
  }));
  assert.deepEqual(r.mx, []);
  assert.equal(r.fout, 'ENOTFOUND');
  assert.equal(r.m365Mail, false);
});
