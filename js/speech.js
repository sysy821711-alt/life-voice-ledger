// 語音辨識包裝 (Web Speech API) + 中文語音文字解析成金額／類別／收支類型

const EXPENSE_CATEGORY_KEYWORDS = {
  '居住': ['房租', '水電', '電費', '水費', '瓦斯', '管理費', '房貸', '網路費', '電話費', '房屋'],
  '醫療': ['看醫生', '藥局', '藥錢', '診所', '醫院', '掛號', '健保', '牙醫'],
  '教育': ['學費', '補習', '課程', '教材', '書錢', '買書'],
  '交通': ['電車', '地鐵', '計程車', 'uber', '公車', '巴士', '機票', '高鐵', '火車', '捷運', '油錢', '加油', '租車', '停車', '車票', '交通'],
  '娛樂': ['電影', '門票', '樂園', '展覽', 'spa', '按摩', '溫泉', '表演', '演唱會', '景點', '遊戲', '訂閱', 'netflix', 'ktv'],
  '人情': ['禮金', '紅包', '送禮', '禮物', '聚餐', '奠儀'],
  '餐飲': ['早餐', '午餐', '晚餐', '宵夜', '吃', '喝', '咖啡', '拉麵', '餐廳', '小吃', '飲料', '零食', '火鍋', '壽司', '燒烤', '麥當勞', '星巴克', '甜點', '冰淇淋', '啤酒', '便當'],
  '購物': ['買', '購物', '衣服', '鞋子', '包包', '網購', '蝦皮', '日用品', '生活用品']
};

// 依此順序比對：越具體、越不易與其他類別的字混淆的類別排越前面
const EXPENSE_MATCH_ORDER = ['居住', '醫療', '教育', '交通', '娛樂', '人情', '餐飲', '購物'];

const INCOME_CATEGORY_KEYWORDS = {
  '薪資': ['薪水', '薪資', '工資', '月薪', '薪水入帳'],
  '獎金': ['獎金', '紅包', '年終', '分紅', '業績獎金'],
  '投資': ['股息', '股利', '利息', '投資收益', '配息'],
  '退款': ['退款', '退費', '退錢', '退貨']
};
const INCOME_MATCH_ORDER = ['薪資', '獎金', '投資', '退款'];

// 用來判斷這句話整體是收入還支出的觸發詞（沒命中細分類別，但明確表示是收入時使用）
const INCOME_TRIGGER_WORDS = ['收入', '收到', '入帳', '進帳'];

function guessFromKeywords(text, keywordMap, matchOrder) {
  const lower = (text || '').toLowerCase();
  for (const cat of matchOrder) {
    if (keywordMap[cat].some(kw => lower.includes(kw.toLowerCase()))) {
      return cat;
    }
  }
  return null;
}

// 金額後面常見的單位詞，把金額拿掉時一併清掉，避免備註留下「花了元」這種尾巴
const CURRENCY_UNIT_WORDS = ['元整', '元', '塊錢', '塊', '圓'];
// 金額前面常見的貨幣符號（例如口述聽寫常把「元」誤判成 $），一併從備註拿掉
const CURRENCY_PREFIX_PATTERN = /(?:NT\$|NTD|US\$|\$|＄)\s*$/i;

// 從語音文字裡抓出金額，同時回傳「拿掉金額數字（含前後貨幣符號／單位）後」的備註文字
function extractAmountAndNote(text) {
  const trimmed = (text || '').trim();
  // 順便支援千分位逗號（例如 1,184），計算金額時再拿掉逗號
  const match = trimmed.match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!match) {
    return { amount: null, note: trimmed };
  }
  const before = trimmed.slice(0, match.index).replace(CURRENCY_PREFIX_PATTERN, '');
  let after = trimmed.slice(match.index + match[0].length);
  for (const unit of CURRENCY_UNIT_WORDS) {
    if (after.startsWith(unit)) {
      after = after.slice(unit.length);
      break;
    }
  }
  const note = (before + after).replace(/\s+/g, ' ').trim();
  return { amount: Number(match[0].replace(/,/g, '')), note: note || trimmed };
}

// 使用者自訂類別也直接用「名稱是否出現在原文裡」來比對，讓自訂類別一樣能被語音辨識抓到
function guessCustomCategory(text, type) {
  const lower = (text || '').toLowerCase();
  const customCats = DB.getCategories(type).filter(c => !c.builtin);
  const matched = customCats.find(c => lower.includes(c.name.toLowerCase()));
  return matched ? matched.name : null;
}

function parseSpeechText(text) {
  const trimmed = (text || '').trim();
  const lower = trimmed.toLowerCase();
  const { amount, note } = extractAmountAndNote(trimmed);

  const incomeCategory = guessCustomCategory(trimmed, 'income') || guessFromKeywords(trimmed, INCOME_CATEGORY_KEYWORDS, INCOME_MATCH_ORDER);
  if (incomeCategory) {
    return { type: 'income', amount, category: incomeCategory, note };
  }
  if (INCOME_TRIGGER_WORDS.some(w => lower.includes(w))) {
    return { type: 'income', amount, category: '其他收入', note };
  }
  const expenseCategory = guessCustomCategory(trimmed, 'expense') || guessFromKeywords(trimmed, EXPENSE_CATEGORY_KEYWORDS, EXPENSE_MATCH_ORDER);
  return { type: 'expense', amount, category: expenseCategory || '其他', note };
}

const RECEIPT_TOTAL_PATTERNS = [
  /實付金額|應付金額|交易金額|支付金額/i,
  /總計|合計|總額/i,
  /grand\s*total|amount\s*due|total\s*amount|\btotal\b/i
];
const RECEIPT_NON_TOTAL_PATTERN = /小計|折扣|找零|稅額|服務費|subtotal|discount|change|tax/i;
const RECEIPT_MERCHANT_SKIP_PATTERN = /電子發票|統一發票|發票號碼|交易明細|消費明細|收據|invoice|receipt|統一編號|日期|時間|店號|機號|感謝光臨|謝謝惠顧/i;

function receiptLines(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function numbersInLine(line) {
  const matches = (line || '').match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/g) || [];
  return matches
    .map(value => Number(value.replace(/,/g, '')))
    .filter(value => Number.isFinite(value) && value > 0);
}

// 收據上常有發票號碼、日期、品項數量、小計與稅額；不能像口述記帳一樣拿第一個數字。
// 先找「實付／總計」附近的最後一個數字，找不到時才退回有貨幣符號或「元」的最大值。
function extractReceiptAmount(text) {
  const lines = receiptLines(text);
  for (const pattern of RECEIPT_TOTAL_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!pattern.test(line) || RECEIPT_NON_TOTAL_PATTERN.test(line)) continue;
      const sameLine = numbersInLine(line);
      if (sameLine.length) return sameLine[sameLine.length - 1];
      const nextLine = numbersInLine(lines[i + 1] || '');
      if (nextLine.length) return nextLine[nextLine.length - 1];
    }
  }

  const currencyCandidates = [];
  const currencyPattern = /(?:NT\$|NTD|TWD|\$|＄)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:元|圓)/gi;
  for (const match of (text || '').matchAll(currencyPattern)) {
    const value = Number((match[1] || match[2]).replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) currencyCandidates.push(value);
  }
  return currencyCandidates.length ? Math.max(...currencyCandidates) : null;
}

function guessReceiptMerchant(text) {
  const lines = receiptLines(text);
  return lines.find(line => {
    if (line.length < 2 || line.length > 60) return false;
    if (RECEIPT_MERCHANT_SKIP_PATTERN.test(line)) return false;
    if (RECEIPT_TOTAL_PATTERNS.some(pattern => pattern.test(line))) return false;
    if (!/[\p{L}\p{Script=Han}]/u.test(line)) return false;
    return true;
  }) || '';
}

// 電信帳單等簡訊會把電話號碼夾在文字裡，抓出來寫進備註才看得出是哪一支號碼。
// 手機號碼可帶或不帶連字號；市話一定要有連字號，避免把發票號碼之類的長數字誤認成電話。
function extractPhoneNumber(text) {
  const match = (text || '').match(/(?:^|\D)(09\d{2}-?\d{3}-?\d{3}|0[2-8]-\d{6,8})(?!\d)/);
  return match ? match[1] : '';
}

function receiptNote(merchant, phone) {
  if (!phone) return merchant || '收據';
  const name = (merchant || '').split(/通知您|提醒您|[:：]/)[0].trim();
  return `${name ? `${name} ` : ''}電話 ${phone}`;
}

function parseReceiptTimestamp(text) {
  // 日的後面不能緊接數字，否則「08月0939006086」會把電話號碼前兩碼 09 當成日期
  const match = (text || '').match(/(?:民國\s*)?(\d{2,4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})(?!\d)\s*日?/);
  if (!match) return undefined;

  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 100) year += 2000;
  else if (year < 1911) year += 1911;

  const timeMatch = (text || '').match(/(?:時間|交易時間)?\s*(\d{1,2}):([0-5]\d)/);
  const hour = timeMatch ? Number(timeMatch[1]) : 12;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    hour > 23
  ) return undefined;
  return date.getTime();
}

function guessReceiptPaymentMethod(text) {
  const lower = (text || '').toLowerCase();
  const methods = DB.getPaymentMethods ? DB.getPaymentMethods() : [];
  const direct = methods.find(method => lower.includes(method.name.toLowerCase()));
  if (direct) return direct.name;

  const aliases = [
    { name: 'Apple Pay', words: ['apple pay'] },
    { name: 'Line Pay', words: ['line pay', 'linepay'] },
    { name: '悠遊卡', words: ['悠遊卡', 'easycard'] },
    { name: '金融卡', words: ['金融卡', 'debit'] },
    { name: '信用卡', words: ['信用卡', 'visa', 'mastercard', 'master card', 'jcb', 'amex', '卡號'] },
    { name: '現金', words: ['現金', 'cash'] },
    { name: '銀行轉帳', words: ['銀行轉帳', '轉帳'] }
  ];
  const matched = aliases.find(alias => alias.words.some(word => lower.includes(word.toLowerCase())));
  if (!matched) return null;
  const available = methods.find(method => method.name === matched.name);
  return available ? available.name : null;
}

function parseReceiptText(text) {
  const trimmed = (text || '').trim();
  const merchant = guessReceiptMerchant(trimmed);
  const customCategory = guessCustomCategory(trimmed, 'expense');
  let category = customCategory || guessFromKeywords(trimmed, EXPENSE_CATEGORY_KEYWORDS, EXPENSE_MATCH_ORDER);
  if (!category && /全聯|家樂福|好市多|costco|便利商店|7-11|統一超商|全家|萊爾富|ok mart|寶雅/i.test(trimmed)) {
    category = '購物';
  }
  return {
    type: 'expense',
    amount: extractReceiptAmount(trimmed),
    category: category || '其他',
    note: receiptNote(merchant, extractPhoneNumber(trimmed)),
    timestamp: parseReceiptTimestamp(trimmed),
    paymentMethod: guessReceiptPaymentMethod(trimmed)
  };
}

// iPhone「捷徑」支援口述模式（shortcut=1）與收據 OCR 模式（shortcut=receipt）。
// 觸發旗標「shortcut=」一定要放在網址列的 query string（? 後面），不能只放在 fragment
// （# 後面）：瀏覽器對「只有 # 後面不同」的網址視為同一頁的內部跳轉，如果那個分頁
// 或已加入主畫面的 App 剛好還開著，並不會真的重新整理頁面，代表這支程式根本不會
// 重新執行，捷徑等於完全沒反應。query string 有變化才保證瀏覽器一定會重新載入頁面。
// 收據的 OCR 原文本身還是放在 fragment（#text=...），fragment 不會隨網頁請求送到主機。
function getShortcutRequest(search, hash) {
  const searchParams = new URLSearchParams(search || '');
  const shortcut = searchParams.get('shortcut');
  if (shortcut !== '1' && shortcut !== 'receipt') return null;

  if (shortcut === '1') {
    const text = (searchParams.get('text') || '').trim();
    return text ? { mode: 'voice', text } : null;
  }

  const hashParams = new URLSearchParams((hash || '').replace(/^#/, ''));
  const text = (hashParams.get('text') || '').trim();
  return text ? { mode: 'receipt', text } : null;
}

function getShortcutText(search) {
  const request = getShortcutRequest(search);
  return request && request.mode === 'voice' ? request.text : '';
}

const Speech = (() => {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSupported = !!SpeechRecognitionCtor;
  let recognition = null;
  let listening = false;

  function start({ onResult, onEnd, onError, lang }) {
    if (!isSupported) {
      onError && onError(new Error('此瀏覽器不支援語音辨識'));
      return;
    }
    recognition = new SpeechRecognitionCtor();
    recognition.lang = lang || 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      onResult && onResult({ finalText, interimText });
    };

    recognition.onerror = (event) => {
      onError && onError(new Error(event.error || '語音辨識發生錯誤'));
    };

    recognition.onend = () => {
      listening = false;
      onEnd && onEnd();
    };

    listening = true;
    recognition.start();
  }

  function stop() {
    if (recognition && listening) {
      recognition.stop();
    }
  }

  return { isSupported, start, stop, isListening: () => listening };
})();
