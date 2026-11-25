// perf.js: какая видеокарта отдельная — по ней решаем, не рисует ли встроенная вместо мощной
const test = require('node:test');
const assert = require('node:assert');
const { isDiscrete, MODES } = require('../perf.js');

test('отдельные видеокарты узнаются', () => {
  assert.ok(isDiscrete({ vendorId: 0x10de, deviceString: '' }));
  assert.ok(isDiscrete({ deviceString: 'NVIDIA GeForce RTX 3060' }));
  assert.ok(isDiscrete({ vendorId: 0x1002, deviceString: 'AMD Radeon RX 6600' }));
  assert.ok(isDiscrete({ deviceString: 'Intel(R) Arc(TM) A770 Graphics' }));
});

test('встроенные — не отдельные', () => {
  assert.ok(!isDiscrete({ vendorId: 0x8086, deviceString: 'Intel(R) UHD Graphics 770' }));
  assert.ok(!isDiscrete({ vendorId: 0x8086, deviceString: 'Intel(R) Arc(TM) 140V GPU (16GB)' }));
  assert.ok(!isDiscrete({ vendorId: 0x1002, deviceString: 'AMD Radeon(TM) Graphics' })); // Ryzen со встроенной
  assert.ok(!isDiscrete(null));
});

test('режимы', () => {
  assert.deepStrictEqual(MODES, ['auto', 'quality', 'eco']);
});
