// localStorage 存取層：帳本 (books)、收支紀錄 (transactions)、預算 (budgets)、定期收支 (recurrings) 的 CRUD
const DB = (() => {
  const BOOKS_KEY = 'voiceLedger.books';
  const TX_KEY = 'voiceLedger.transactions';
  const CURRENT_BOOK_KEY = 'voiceLedger.currentBookId';
  const BUDGETS_KEY = 'voiceLedger.budgets';
  const RECURRINGS_KEY = 'voiceLedger.recurrings';

  // 舊版「旅遊語音記帳」使用的 key，用來做一次性資料搬遷
  const OLD_TRIPS_KEY = 'voiceExpense.trips';
  const OLD_EXPENSES_KEY = 'voiceExpense.expenses';
  const OLD_CURRENT_TRIP_KEY = 'voiceExpense.currentTripId';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('讀取資料失敗', key, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ---------- 一次性資料搬遷：舊版行程/花費 -> 新版帳本/收支紀錄 ----------
  function migrateFromOldVersion() {
    if (localStorage.getItem(BOOKS_KEY) !== null) return; // 已經是新版資料，不搬遷
    const oldTrips = readJSON(OLD_TRIPS_KEY, null);
    const oldExpenses = readJSON(OLD_EXPENSES_KEY, null);
    if (!oldTrips) return;

    const books = oldTrips.map(t => ({ id: t.id, name: t.name, currency: t.currency || 'TWD' }));
    const transactions = (oldExpenses || []).map(e => ({
      id: e.id,
      bookId: e.tripId,
      type: 'expense',
      amount: e.amount,
      category: e.category || '其他',
      note: e.note || '',
      rawText: e.rawText || '',
      timestamp: e.timestamp
    }));
    writeJSON(BOOKS_KEY, books);
    writeJSON(TX_KEY, transactions);
    const oldCurrent = localStorage.getItem(OLD_CURRENT_TRIP_KEY);
    if (oldCurrent) localStorage.setItem(CURRENT_BOOK_KEY, oldCurrent);
  }
  migrateFromOldVersion();

  // ---------- Books ----------
  function getBooks() {
    return readJSON(BOOKS_KEY, []);
  }

  function saveBooks(books) {
    writeJSON(BOOKS_KEY, books);
  }

  function addBook({ name, currency }) {
    const books = getBooks();
    const book = { id: uid(), name, currency: currency || 'TWD' };
    books.push(book);
    saveBooks(books);
    return book;
  }

  function updateBook(id, patch) {
    const books = getBooks();
    const idx = books.findIndex(b => b.id === id);
    if (idx === -1) return null;
    books[idx] = Object.assign({}, books[idx], patch);
    saveBooks(books);
    return books[idx];
  }

  function deleteBook(id) {
    saveBooks(getBooks().filter(b => b.id !== id));
    saveTransactions(getTransactions().filter(t => t.bookId !== id));
    saveBudgets(getBudgetsRaw().filter(b => b.bookId !== id));
    saveRecurrings(getRecurringsRaw().filter(r => r.bookId !== id));
    if (getCurrentBookId() === id) {
      const remaining = getBooks();
      setCurrentBookId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  function getCurrentBookId() {
    return localStorage.getItem(CURRENT_BOOK_KEY) || null;
  }

  function setCurrentBookId(id) {
    if (id) localStorage.setItem(CURRENT_BOOK_KEY, id);
    else localStorage.removeItem(CURRENT_BOOK_KEY);
  }

  // ---------- Transactions ----------
  function getTransactions() {
    return readJSON(TX_KEY, []);
  }

  function saveTransactions(transactions) {
    writeJSON(TX_KEY, transactions);
  }

  function addTransaction({ bookId, type, amount, category, note, rawText, timestamp }) {
    const transactions = getTransactions();
    const tx = {
      id: uid(),
      bookId,
      type: type === 'income' ? 'income' : 'expense',
      amount: Number(amount),
      category: category || '其他',
      note: note || '',
      rawText: rawText || '',
      timestamp: timestamp || Date.now()
    };
    transactions.push(tx);
    saveTransactions(transactions);
    return tx;
  }

  function updateTransaction(id, patch) {
    const transactions = getTransactions();
    const idx = transactions.findIndex(t => t.id === id);
    if (idx === -1) return null;
    transactions[idx] = Object.assign({}, transactions[idx], patch);
    saveTransactions(transactions);
    return transactions[idx];
  }

  function deleteTransaction(id) {
    saveTransactions(getTransactions().filter(t => t.id !== id));
  }

  function getTransactionsByBook(bookId, { type } = {}) {
    const all = getTransactions();
    return all.filter(t => (!bookId || t.bookId === bookId) && (!type || t.type === type));
  }

  // ---------- Budgets（每月固定預算，依帳本＋類別） ----------
  function getBudgetsRaw() {
    return readJSON(BUDGETS_KEY, []);
  }

  function saveBudgets(budgets) {
    writeJSON(BUDGETS_KEY, budgets);
  }

  function getBudgets(bookId) {
    return getBudgetsRaw().filter(b => b.bookId === bookId);
  }

  function setBudget(bookId, category, amount) {
    const budgets = getBudgetsRaw();
    const idx = budgets.findIndex(b => b.bookId === bookId && b.category === category);
    if (amount == null || amount <= 0) {
      if (idx !== -1) budgets.splice(idx, 1);
      saveBudgets(budgets);
      return null;
    }
    if (idx === -1) {
      const budget = { id: uid(), bookId, category, amount: Number(amount) };
      budgets.push(budget);
      saveBudgets(budgets);
      return budget;
    }
    budgets[idx].amount = Number(amount);
    saveBudgets(budgets);
    return budgets[idx];
  }

  // ---------- Recurrings（定期收支） ----------
  function getRecurringsRaw() {
    return readJSON(RECURRINGS_KEY, []);
  }

  function saveRecurrings(recurrings) {
    writeJSON(RECURRINGS_KEY, recurrings);
  }

  function getRecurrings(bookId) {
    return getRecurringsRaw().filter(r => r.bookId === bookId);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // 依頻率算出「下一次」日期字串 (YYYY-MM-DD)
  function computeNextDate(fromDateStr, frequency, dayOfMonth, weekday) {
    const d = new Date(fromDateStr + 'T00:00:00');
    if (frequency === 'daily') {
      d.setDate(d.getDate() + 1);
    } else if (frequency === 'weekly') {
      d.setDate(d.getDate() + 7);
    } else {
      // monthly：移到下個月，並夾在該月天數內
      const targetDay = dayOfMonth || d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(targetDay, daysInMonth));
    }
    return toDateStr(d);
  }

  function addRecurring({ bookId, type, amount, category, note, frequency, dayOfMonth, weekday, startDate }) {
    const recurrings = getRecurringsRaw();
    const start = startDate || toDateStr(new Date());
    const recurring = {
      id: uid(),
      bookId,
      type: type === 'income' ? 'income' : 'expense',
      amount: Number(amount),
      category: category || '其他',
      note: note || '',
      frequency: frequency || 'monthly',
      dayOfMonth: dayOfMonth || null,
      weekday: weekday != null ? weekday : null,
      startDate: start,
      nextDate: start,
      active: true
    };
    recurrings.push(recurring);
    saveRecurrings(recurrings);
    return recurring;
  }

  function updateRecurring(id, patch) {
    const recurrings = getRecurringsRaw();
    const idx = recurrings.findIndex(r => r.id === id);
    if (idx === -1) return null;
    recurrings[idx] = Object.assign({}, recurrings[idx], patch);
    saveRecurrings(recurrings);
    return recurrings[idx];
  }

  function deleteRecurring(id) {
    saveRecurrings(getRecurringsRaw().filter(r => r.id !== id));
  }

  // 檢查所有啟用中的定期收支，把到期（含補記過去錯過的）的項目自動新增為收支紀錄
  // 回傳新增的紀錄數
  const MAX_CATCH_UP = 24; // 避免長時間沒開 App 時一次補太多筆
  function applyDueRecurrings() {
    const recurrings = getRecurringsRaw();
    const todayStr = toDateStr(new Date());
    let addedCount = 0;
    let changed = false;

    recurrings.forEach(r => {
      if (!r.active) return;
      let guard = 0;
      while (r.nextDate <= todayStr && guard < MAX_CATCH_UP) {
        addTransaction({
          bookId: r.bookId,
          type: r.type,
          amount: r.amount,
          category: r.category,
          note: r.note,
          rawText: '[定期] ' + (r.note || r.category),
          timestamp: new Date(r.nextDate + 'T12:00:00').getTime()
        });
        addedCount++;
        r.nextDate = computeNextDate(r.nextDate, r.frequency, r.dayOfMonth, r.weekday);
        changed = true;
        guard++;
      }
    });

    if (changed) saveRecurrings(recurrings);
    return addedCount;
  }

  // ---------- Backup / Restore ----------
  function exportAll() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      books: getBooks(),
      transactions: getTransactions(),
      budgets: getBudgetsRaw(),
      recurrings: getRecurringsRaw()
    };
  }

  // 合併匯入：只新增本機沒有的資料（依 id 判斷），不覆蓋、不刪除既有資料
  function importAll(data) {
    const incomingBooks = Array.isArray(data && data.books) ? data.books : [];
    const incomingTx = Array.isArray(data && data.transactions) ? data.transactions : [];
    const incomingBudgets = Array.isArray(data && data.budgets) ? data.budgets : [];
    const incomingRecurrings = Array.isArray(data && data.recurrings) ? data.recurrings : [];

    const books = getBooks();
    const existingBookIds = new Set(books.map(b => b.id));
    let addedBooks = 0;
    incomingBooks.forEach(b => {
      if (b && b.id && !existingBookIds.has(b.id)) {
        books.push(b);
        existingBookIds.add(b.id);
        addedBooks++;
      }
    });
    saveBooks(books);

    const transactions = getTransactions();
    const existingTxIds = new Set(transactions.map(t => t.id));
    let addedTx = 0;
    incomingTx.forEach(t => {
      if (t && t.id && !existingTxIds.has(t.id)) {
        transactions.push(Object.assign({ type: 'expense' }, t));
        existingTxIds.add(t.id);
        addedTx++;
      }
    });
    saveTransactions(transactions);

    const budgets = getBudgetsRaw();
    const existingBudgetIds = new Set(budgets.map(b => b.id));
    incomingBudgets.forEach(b => {
      if (b && b.id && !existingBudgetIds.has(b.id)) {
        budgets.push(b);
        existingBudgetIds.add(b.id);
      }
    });
    saveBudgets(budgets);

    const recurrings = getRecurringsRaw();
    const existingRecurringIds = new Set(recurrings.map(r => r.id));
    incomingRecurrings.forEach(r => {
      if (r && r.id && !existingRecurringIds.has(r.id)) {
        recurrings.push(r);
        existingRecurringIds.add(r.id);
      }
    });
    saveRecurrings(recurrings);

    return { addedBooks, addedTx };
  }

  return {
    getBooks, addBook, updateBook, deleteBook,
    getCurrentBookId, setCurrentBookId,
    getTransactions, addTransaction, updateTransaction, deleteTransaction, getTransactionsByBook,
    getBudgets, setBudget,
    getRecurrings, addRecurring, updateRecurring, deleteRecurring, applyDueRecurrings,
    exportAll, importAll
  };
})();
