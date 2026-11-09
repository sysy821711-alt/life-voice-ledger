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

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

test('dueOccurrenceDates 從過去的開始日期列出到今天為止每一個應發生的日期', () => {
  const DB = loadDB();
  const { dates, tooMany } = DB.dueOccurrenceDates(daysAgo(30), 'daily', null, null);
  assert.equal(dates.length, 31);
  assert.equal(dates[0], daysAgo(30));
  assert.equal(dates[30], ymd(new Date()));
  assert.equal(tooMany, false);
});

test('開始日期在未來時沒有任何要補記的日期', () => {
  const DB = loadDB();
  const future = new Date();
  future.setDate(future.getDate() + 5);
  assert.equal(DB.dueOccurrenceDates(ymd(future), 'daily', null, null).dates.length, 0);
});

test('補記筆數超過上限時回報 tooMany，不會無限迴圈', () => {
  const DB = loadDB();
  const result = DB.dueOccurrenceDates(daysAgo(365 * 3), 'daily', null, null);
  assert.equal(result.tooMany, true);
  assert.equal(result.dates.length, result.max);
});

test('新增時用 onlyId 補記：一次補完全部，且不動其他定期項目', () => {
  const DB = loadDB();
  const book = DB.addBook({ name: '測試', currency: 'TWD' });
  const base = { bookId: book.id, type: 'expense', amount: 100, category: '其他', note: 'x', frequency: 'daily', dayOfMonth: null, weekday: null };
  const target = DB.addRecurring({ ...base, note: '目標', startDate: daysAgo(40) });
  const other = DB.addRecurring({ ...base, note: '別的', startDate: daysAgo(10) });

  const added = DB.applyDueRecurrings({ maxCatchUp: 41, onlyId: target.id });
  assert.equal(added, 41);
  const notes = Array.from(DB.getTransactions()).map(t => t.note);
  assert.equal(notes.filter(n => n === '目標').length, 41);
  assert.equal(notes.filter(n => n === '別的').length, 0);
  assert.equal(Array.from(DB.getRecurrings(book.id)).find(r => r.id === other.id).nextDate, daysAgo(10));
});

test('不帶參數的啟動補記仍然每個項目最多補 24 筆', () => {
  const DB = loadDB();
  const book = DB.addBook({ name: '測試', currency: 'TWD' });
  DB.addRecurring({ bookId: book.id, type: 'expense', amount: 100, category: '其他', note: 'x', frequency: 'daily', dayOfMonth: null, weekday: null, startDate: daysAgo(60) });
  assert.equal(DB.applyDueRecurrings(), 24);
});

test('補記是以發生日期去重：同一筆不會因為重複執行而重複記帳', () => {
  const DB = loadDB();
  const book = DB.addBook({ name: '測試', currency: 'TWD' });
  const r = DB.addRecurring({ bookId: book.id, type: 'expense', amount: 100, category: '其他', note: 'x', frequency: 'daily', dayOfMonth: null, weekday: null, startDate: daysAgo(5) });
  DB.applyDueRecurrings({ maxCatchUp: 10, onlyId: r.id });
  DB.applyDueRecurrings({ maxCatchUp: 10, onlyId: r.id });
  assert.equal(Array.from(DB.getTransactions()).length, 6);
});
