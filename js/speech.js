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

function guessAmount(text) {
  const matches = (text || '').match(/[0-9]+(?:\.[0-9]+)?/g);
  if (!matches || matches.length === 0) return null;
  return Number(matches[0]);
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

  const incomeCategory = guessCustomCategory(trimmed, 'income') || guessFromKeywords(trimmed, INCOME_CATEGORY_KEYWORDS, INCOME_MATCH_ORDER);
  if (incomeCategory) {
    return { type: 'income', amount: guessAmount(trimmed), category: incomeCategory, note: trimmed };
  }
  if (INCOME_TRIGGER_WORDS.some(w => lower.includes(w))) {
    return { type: 'income', amount: guessAmount(trimmed), category: '其他收入', note: trimmed };
  }
  const expenseCategory = guessCustomCategory(trimmed, 'expense') || guessFromKeywords(trimmed, EXPENSE_CATEGORY_KEYWORDS, EXPENSE_MATCH_ORDER);
  return { type: 'expense', amount: guessAmount(trimmed), category: expenseCategory || '其他', note: trimmed };
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
