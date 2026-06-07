import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';

import { mintCode, verifyHmac, timingSafeEqual } from '../backend/worker.js';

const require = createRequire(import.meta.url);
const { isCaught } = require('../calibration/run.js');

test('mintCode: format CS-XXXX-XXXX with unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const c = mintCode();
    assert.match(c, /^CS-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    // No ambiguous 0/O/1/I/L characters.
    assert.ok(!/[0O1IL]/.test(c.slice(3)));
  }
});

test('mintCode: codes are not trivially repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(mintCode());
  assert.ok(seen.size > 90, 'expected mostly-unique codes, got ' + seen.size);
});

test('timingSafeEqual: equal vs different', () => {
  assert.equal(timingSafeEqual('abc123', 'abc123'), true);
  assert.equal(timingSafeEqual('abc123', 'abc124'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false); // length mismatch
});

test('verifyHmac: accepts a correct signature, rejects tampering', async () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ meta: { event_name: 'order_created' }, data: { id: 'o1' } });
  const good = createHmac('sha256', secret).update(payload).digest('hex');

  assert.equal(await verifyHmac(secret, payload, good), true);
  assert.equal(await verifyHmac(secret, payload, good.toUpperCase()), true); // case-insensitive hex
  assert.equal(await verifyHmac(secret, payload + 'x', good), false);        // tampered body
  assert.equal(await verifyHmac(secret, payload, good.slice(0, -2) + '00'), false); // wrong sig
  assert.equal(await verifyHmac('', payload, good), false);                  // no secret
  assert.equal(await verifyHmac(secret, payload, ''), false);               // no signature
});

test('isCaught: recall matcher needs at least half the keywords', () => {
  const findings = [
    { title: 'Unlimited liability exposure', category: 'Liability', section_reference: '8.2',
      explanation: 'You are liable for unlimited damages.' }
  ];
  // 2/2 keywords present -> caught
  assert.equal(isCaught({ keywords: ['unlimited', 'liability'] }, findings), true);
  // 1/2 present (>= ceil(2/2)=1) -> caught
  assert.equal(isCaught({ keywords: ['unlimited', 'arbitration'] }, findings), true);
  // 0/2 present -> missed
  assert.equal(isCaught({ keywords: ['arbitration', 'renewal'] }, findings), false);
  // case-insensitive
  assert.equal(isCaught({ keywords: ['UNLIMITED'] }, findings), true);
  // empty findings -> missed
  assert.equal(isCaught({ keywords: ['unlimited'] }, []), false);
});
