const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const speechSource = fs.readFileSync(path.join(projectRoot, 'js', 'speech.js'), 'utf8');

function loadSpeech(customCategories = {}, paymentMethods = []) {
  const context = {
    URLSearchParams,
    window: {},
    DB: {
      getCategories(type) {
        return customCategories[type] || [];
      },
      getPaymentMethods() {
        return paymentMethods;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(speechSource, context);
  return context;
}

test('捷徑參數會解碼中文聽寫文字', () => {
  const { getShortcutText } = loadSpeech();
  assert.equal(
    getShortcutText('?shortcut=1&text=%E5%8D%88%E9%A4%90180%E5%85%83'),
    '午餐180元'
  );
  assert.equal(getShortcutText('?shortcut=1&text=%E6%97%A9%E9%A4%90+120%E5%85%83'), '早餐 120元');
});

test('一般網址或空白文字不會觸發捷徑入口', () => {
  const { getShortcutText, getShortcutRequest } = loadSpeech();
  assert.equal(getShortcutText('?text=午餐180元'), '');
  assert.equal(getShortcutText('?shortcut=0&text=午餐180元'), '');
  assert.equal(getShortcutText('?shortcut=1&text=++'), '');
  assert.equal(getShortcutRequest('?shortcut=receipt', '#text=++'), null);
});

test('收據分享捷徑會使用 receipt 模式，觸發旗標放在 query string 才會確保頁面真的重新整理', () => {
  const { getShortcutRequest } = loadSpeech();
  const request = getShortcutRequest('?shortcut=receipt', '#text=%E7%B8%BD%E8%A8%88%20180');
  assert.deepEqual({ ...request }, { mode: 'receipt', text: '總計 180' });
  // 觸發旗標只放在 fragment（舊格式）不該再被辨識，因為 fragment 單獨變化時瀏覽器不會重新整理頁面
  assert.equal(getShortcutRequest('', '#shortcut=receipt&text=總計180'), null);
});

test('捷徑文字沿用既有支出與收入解析', () => {
  const { parseSpeechText } = loadSpeech();
  assert.deepEqual(
    { ...parseSpeechText('午餐180元') },
    { type: 'expense', amount: 180, category: '餐飲', note: '午餐' }
  );
  assert.deepEqual(
    { ...parseSpeechText('薪水入帳50000元') },
    { type: 'income', amount: 50000, category: '薪資', note: '薪水入帳' }
  );
});

test('捷徑文字同樣支援使用者自訂類別', () => {
  const { parseSpeechText } = loadSpeech({
    expense: [{ name: '寵物', builtin: false }],
    income: []
  });
  assert.equal(parseSpeechText('寵物用品560元').category, '寵物');
});

test('收據解析會忽略發票號碼、小計與稅額，優先使用總計', () => {
  const { parseReceiptText } = loadSpeech({}, [
    { name: '信用卡' },
    { name: '現金' }
  ]);
  const receipt = [
    '全聯福利中心',
    '電子發票 AB-20260918',
    '日期 2026/09/18 19:35',
    '便當 2 x 80',
    '小計 160',
    '稅額 8',
    '總計 NT$ 168',
    'VISA 末四碼 1234'
  ].join('\n');
  const parsed = parseReceiptText(receipt);

  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.amount, 168);
  assert.equal(parsed.category, '餐飲');
  assert.equal(parsed.note, '全聯福利中心');
  assert.equal(parsed.paymentMethod, '信用卡');
  const date = new Date(parsed.timestamp);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 18);
  assert.equal(date.getHours(), 19);
  assert.equal(date.getMinutes(), 35);
});

test('收據總計可放在標籤下一行，沒有可信金額時保持空白', () => {
  const { parseReceiptText } = loadSpeech();
  assert.equal(parseReceiptText('商店名稱\n應付金額\n560 元').amount, 560);
  assert.equal(parseReceiptText('商店名稱\n發票號碼 12345678\n日期 2026/09/18').amount, null);
});

test('民國日期與自訂付款方式可帶入確認表單', () => {
  const { parseReceiptText } = loadSpeech({}, [{ name: '街口支付' }]);
  const parsed = parseReceiptText('咖啡小店\n民國 115年9月18日 08:05\n總計 120\n街口支付');
  const date = new Date(parsed.timestamp);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 18);
  assert.equal(parsed.paymentMethod, '街口支付');
});

test('簡訊帳單的備註會標明電話號碼，號碼不會被誤判成日期', () => {
  const { parseReceiptText } = loadSpeech();
  const parsed = parseReceiptText('中華電信通知您：115年\n08月0939006086 帳單\n165元，已於09月22日繳訖');
  assert.equal(parsed.note, '中華電信 電話 0939006086');
  assert.equal(parsed.amount, 165);
  assert.equal(parsed.timestamp, undefined);
  assert.equal(parseReceiptText('全聯福利中心\n總計 168').note, '全聯福利中心');
});

test('捷徑入口只開啟確認表單，不直接寫入交易', () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'js', 'app.js'), 'utf8');
  const start = appSource.indexOf('function handleShortcutEntry()');
  const end = appSource.indexOf('function clearShortcutParams()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const handlerSource = appSource.slice(start, end);
  assert.match(handlerSource, /openConfirmForm\(/);
  assert.doesNotMatch(handlerSource, /DB\.addTransaction\s*\(/);
  assert.doesNotMatch(handlerSource, /saveTransaction\s*\(/);
});
