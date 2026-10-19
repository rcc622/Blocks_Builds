// Prueba minima de app/check.js (la que decide "tienes todas" / "faltan N"). Uso: node scripts/check.test.mjs
import assert from 'node:assert/strict';
import { checkBom, sumBoms } from '../app/check.js';

const inv = { parts: [{ part: '3001', colors: { Blacks: 3, Reds: 5 } }, { part: '3004', colors: { Whites: 2 } }] };
const bom = [{ part: '3001', family: 'Blacks', qty: 4 }, { part: '3004', family: 'Whites', qty: 2 }, { part: '9999', family: 'Blues', qty: 1 }];

const r = checkBom(bom, inv);
assert.equal(r.ok, false);
assert.equal(r.total, 7);
assert.equal(r.available, 5);
const black = r.missing.find(m => m.part === '3001');
assert.deepEqual([black.need, black.have, black.short], [4, 3, 1]);
assert.equal(black.alts[0].family, 'Reds');                 // sustituto: rojas sobran
assert.equal(r.missing.find(m => m.part === '9999').unknown, true);

const reserved = sumBoms([[{ part: '3004', family: 'Whites', qty: 1 }]]); // otro modelo armado usa 1 blanca
assert.equal(checkBom([{ part: '3004', family: 'Whites', qty: 2 }], inv, reserved).missing[0].have, 1);
assert.equal(checkBom([{ part: '3001', family: 'Reds', qty: 5 }], inv).ok, true);
console.log('check.test: OK');
