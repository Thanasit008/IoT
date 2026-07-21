const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFoodStatus } = require('../server/foodStatus');

test('returns green status when food lasts more than 7 days', () => {
  const result = calculateFoodStatus(1500, 100);
  assert.equal(result.level, 'green');
  assert.equal(result.label, 'ปกติ');
  assert.equal(result.daysRemaining, 15);
});

test('returns yellow status when food lasts less than 7 days', () => {
  const result = calculateFoodStatus(600, 100);
  assert.equal(result.level, 'yellow');
  assert.equal(result.label, 'เตือน');
  assert.equal(result.daysRemaining, 6);
});

test('returns red status when food lasts less than 3 days', () => {
  const result = calculateFoodStatus(200, 100);
  assert.equal(result.level, 'red');
  assert.equal(result.label, 'วิกฤต');
  assert.equal(result.daysRemaining, 2);
});

test('handles zero daily usage safely', () => {
  const result = calculateFoodStatus(500, 0);
  assert.equal(result.level, 'green');
  assert.equal(result.daysRemaining, Infinity);
});
