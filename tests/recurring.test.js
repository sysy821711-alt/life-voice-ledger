const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');

function loadDB() {
  const store = new Map();
  const context = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    },
    Date,
    console
  };
  vm.createContext(context);
  vm.runInContext(`${dbSource}\nthis.DB = DB;`, context);
  return context.DB;
}

function occurrenceDates(frequency, startDate, count) {
  const DB = loadDB();
  const book = DB.addBook({ name: '測試', currency: 'TWD' });
  const day = Number(startDate.slice(8, 10));
  DB.addRecurring({
    bookId: book.id, type: 'expense', amount: 100, category: '其他', note: 'x',
    frequency, dayOfMonth: frequency === 'daily' ? null : day, weekday: null, startDate
  });
  DB.applyDueRecurrings();
  return Array.from(DB.getTransactions())
    .map(t => new Date(t.timestamp))
    .sort((a, b) => a - b)
    .slice(0, count)
    .map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

test('每日週期逐日遞增', () => {
  assert.deepEqual(occurrenceDates('daily', '2024-02-27', 4), ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
});

test('每月週期月底會夾在該月天數內，且不會永久卡在 28 號', () => {
  assert.deepEqual(occurrenceDates('monthly', '2024-01-31', 4), ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
});

test('每季週期每次加三個月，月底日期夾在該月天數內', () => {
  assert.deepEqual(occurrenceDates('quarterly', '2024-01-31', 5), ['2024-01-31', '2024-04-30', '2024-07-31', '2024-10-31', '2025-01-31']);
});

test('每年週期逐年遞增，2/29 在平年落在 2/28、閏年回到 2/29', () => {
  assert.deepEqual(occurrenceDates('yearly', '2016-02-29', 5), ['2016-02-29', '2017-02-28', '2018-02-28', '2019-02-28', '2020-02-29']);
});
