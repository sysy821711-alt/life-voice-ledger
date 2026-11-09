const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const statsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'stats.js'), 'utf8');

function loadStats() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${statsSource}\nthis.Stats = Stats;`, context);
  return context.Stats;
}

const ts = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const categories = [
  { type: 'expense', name: '餐飲', icon: '🍜' },
  { type: 'expense', name: '交通', icon: '🚗' },
  { type: 'income', name: '薪資', icon: '💰' }
];

test('categoryByMonth 依類別 × 月份彙總，含 12 個月與合計，沒紀錄的類別補 0', () => {
  const Stats = loadStats();
  const tx = [
    { type: 'expense', category: '餐飲', amount: 100, timestamp: ts(2026, 1, 5) },
    { type: 'expense', category: '餐飲', amount: 50, timestamp: ts(2026, 1, 20) },
    { type: 'expense', category: '餐飲', amount: 30, timestamp: ts(2026, 12, 31) },
    { type: 'income', category: '薪資', amount: 9999, timestamp: ts(2026, 1, 1) }
  ];
  const rows = Array.from(Stats.categoryByMonth(tx, 'expense', categories));
  assert.deepEqual(rows.map(r => r.label), ['餐飲', '交通']);
  const food = rows[0];
  assert.equal(food.months.length, 12);
  assert.deepEqual([food.months[0], food.months[11], food.months[5]], [150, 30, 0]);
  assert.equal(food.total, 180);
  assert.equal(rows[1].total, 0);
});

test('categoryByMonth 保留已被刪掉、但歷史紀錄還在用的類別，不會漏算', () => {
  const Stats = loadStats();
  const tx = [{ type: 'expense', category: '舊類別', amount: 70, timestamp: ts(2026, 3, 3) }];
  const rows = Array.from(Stats.categoryByMonth(tx, 'expense', categories));
  const old = rows.find(r => r.label === '舊類別');
  assert.equal(old.total, 70);
  assert.equal(old.months[2], 70);
});
