// 主控制器：分頁切換、事件綁定、畫面渲染
(function () {
  const state = {
    recognizedText: '',
    pendingTx: null,
    editingTxId: null,
    pendingType: 'expense',
    confirmType: 'expense',
    recurringType: 'expense',
    historyTypeFilter: '',
    statsFilterTouched: false
  };

  const el = {};

  function cacheEls() {
    const ids = [
      'book-select', 'mic-btn', 'mic-status', 'transcript', 'manual-entry-link',
      'confirm-form', 'amount-input', 'category-chips', 'note-input',
      'save-expense-btn', 'cancel-expense-btn', 'record-empty-state', 'record-main',
      'history-list', 'history-empty', 'stats-book-select',
      'stats-income', 'stats-expense', 'stats-net', 'stats-count',
      'trend-chart', 'stats-change-rate', 'pie-chart', 'pie-legend', 'budget-usage',
      'book-list', 'book-form', 'book-name-input', 'book-currency-input',
      'dictation-area', 'dictation-input', 'dictation-parse-btn',
      'confirm-form-title', 'datetime-input',
      'export-json-btn', 'export-csv-btn', 'import-file-input',
      'type-toggle', 'confirm-type-toggle', 'history-type-filter',
      'recurring-list', 'recurring-form', 'recurring-note-input', 'recurring-amount-input',
      'recurring-category-chips', 'recurring-frequency-input', 'recurring-start-input',
      'recurring-type-toggle', 'budget-form'
    ];
    ids.forEach(id => {
      el[toCamel(id)] = document.getElementById(id);
    });
    el.tabPanels = document.querySelectorAll('.tab-panel');
    el.navButtons = document.querySelectorAll('.nav-btn');
  }

  function toCamel(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function init() {
    cacheEls();
    bindNav();
    bindRecordTab();
    bindHistoryFilter();
    bindBookTab();
    bindRecurringTab();
    el.statsBookSelect.addEventListener('change', () => {
      state.statsFilterTouched = true;
      renderStats();
    });
    ensureCurrentBook();
    DB.applyDueRecurrings();
    renderAll();
    registerServiceWorker();
  }

  function ensureCurrentBook() {
    const books = DB.getBooks();
    const current = DB.getCurrentBookId();
    if (!current && books.length > 0) {
      DB.setCurrentBookId(books[0].id);
    }
  }

  function switchTab(tab) {
    el.tabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tab}`);
    });
    el.navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    if (tab === 'stats') renderStats();
    if (tab === 'history') renderHistory();
    if (tab === 'books') { renderBooks(); renderBudgetForm(); }
    if (tab === 'record') renderRecordTab();
    if (tab === 'recurring') renderRecurringList();
  }

  function bindNav() {
    el.navButtons.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function bindTypeToggle(container, onChange) {
    container.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(btn.dataset.type);
      });
    });
  }

  function setActiveTypeBtn(container, type) {
    container.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  }

  function renderChips(container, categories, selected, onSelect) {
    container.innerHTML = '';
    categories.forEach(cat => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (cat === selected ? ' selected' : '');
      chip.textContent = cat;
      chip.dataset.category = cat;
      chip.addEventListener('click', () => {
        container.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        if (onSelect) onSelect(cat);
      });
      container.appendChild(chip);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function todayDateStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ---------- Record tab ----------
  function bindRecordTab() {
    bindTypeToggle(el.typeToggle, (type) => { state.pendingType = type; });
    bindTypeToggle(el.confirmTypeToggle, (type) => {
      state.confirmType = type;
      const categories = categoriesForType(type);
      renderChips(el.categoryChips, categories, categories[categories.length - 1]);
    });

    el.micBtn.addEventListener('click', toggleListening);
    el.manualEntryLink.addEventListener('click', (e) => {
      e.preventDefault();
      state.editingTxId = null;
      openConfirmForm({ type: state.pendingType, amount: null, category: null, note: '', rawText: '' });
    });
    el.cancelExpenseBtn.addEventListener('click', closeConfirmForm);
    el.saveExpenseBtn.addEventListener('click', saveTransaction);
    el.dictationParseBtn.addEventListener('click', () => {
      const text = el.dictationInput.value.trim();
      if (!text) {
        el.dictationInput.focus();
        return;
      }
      const parsed = parseSpeechText(text);
      state.editingTxId = null;
      openConfirmForm(Object.assign({}, parsed, { rawText: text }));
      el.dictationInput.value = '';
    });
    el.bookSelect.addEventListener('change', () => {
      DB.setCurrentBookId(el.bookSelect.value || null);
      renderAll();
    });
  }

  function toggleListening() {
    if (!Speech.isSupported) return;
    if (Speech.isListening()) {
      Speech.stop();
      return;
    }
    el.transcript.textContent = '';
    el.micStatus.textContent = '聆聽中…請說出收支項目與金額';
    el.micBtn.classList.add('listening');

    Speech.start({
      lang: 'zh-TW',
      onResult: ({ finalText, interimText }) => {
        el.transcript.textContent = finalText || interimText;
        if (finalText) state.recognizedText = finalText;
      },
      onEnd: () => {
        el.micBtn.classList.remove('listening');
        el.micStatus.textContent = '';
        if (state.recognizedText) {
          const parsed = parseSpeechText(state.recognizedText);
          state.editingTxId = null;
          openConfirmForm(Object.assign({}, parsed, { rawText: state.recognizedText }));
          state.recognizedText = '';
        }
      },
      onError: (err) => {
        el.micBtn.classList.remove('listening');
        el.micStatus.textContent = '辨識失敗：' + err.message + '，請改用手動輸入';
      }
    });
  }

  function toDatetimeLocalValue(timestamp) {
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openConfirmForm({ type, amount, category, note, rawText, timestamp }) {
    state.pendingTx = { rawText: rawText || '' };
    state.confirmType = type || 'expense';
    setActiveTypeBtn(el.confirmTypeToggle, state.confirmType);
    el.amountInput.value = amount != null ? amount : '';
    el.noteInput.value = note || '';
    el.datetimeInput.value = toDatetimeLocalValue(timestamp || Date.now());
    const categories = categoriesForType(state.confirmType);
    const selected = category && categories.includes(category) ? category : categories[categories.length - 1];
    renderChips(el.categoryChips, categories, selected);
    el.confirmFormTitle.textContent = state.editingTxId ? '編輯收支' : '確認收支';
    el.confirmForm.classList.remove('hidden');
    el.amountInput.focus();
  }

  function closeConfirmForm() {
    el.confirmForm.classList.add('hidden');
    state.pendingTx = null;
    state.editingTxId = null;
  }

  function saveTransaction() {
    const bookId = DB.getCurrentBookId();
    if (!bookId) {
      alert('請先建立並選擇一個帳本');
      return;
    }
    const amount = parseFloat(el.amountInput.value);
    if (isNaN(amount) || amount <= 0) {
      alert('請輸入有效的金額');
      return;
    }
    const type = state.confirmType;
    const categories = categoriesForType(type);
    const selectedChip = el.categoryChips.querySelector('.chip.selected');
    const category = selectedChip ? selectedChip.dataset.category : categories[categories.length - 1];
    const note = el.noteInput.value.trim();
    const rawText = state.pendingTx ? state.pendingTx.rawText : '';
    const parsedTimestamp = new Date(el.datetimeInput.value).getTime();
    const timestamp = isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;

    if (state.editingTxId) {
      DB.updateTransaction(state.editingTxId, { type, amount, category, note, rawText, timestamp });
    } else {
      DB.addTransaction({ bookId, type, amount, category, note, rawText, timestamp });
    }
    closeConfirmForm();
    el.transcript.textContent = '';
    switchTab('history');
  }

  function renderRecordTab() {
    const books = DB.getBooks();
    populateBookSelect(el.bookSelect, books, DB.getCurrentBookId());
    const hasBook = !!DB.getCurrentBookId();
    el.recordEmptyState.classList.toggle('hidden', hasBook);
    el.recordMain.classList.toggle('hidden', !hasBook);
    el.micBtn.classList.toggle('hidden', !Speech.isSupported);
    el.dictationArea.classList.toggle('hidden', Speech.isSupported);
  }

  function populateBookSelect(selectEl, books, currentId) {
    selectEl.innerHTML = '';
    if (books.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '尚無帳本';
      selectEl.appendChild(opt);
      return;
    }
    books.forEach(book => {
      const opt = document.createElement('option');
      opt.value = book.id;
      opt.textContent = book.name;
      if (book.id === currentId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  // ---------- History tab ----------
  function bindHistoryFilter() {
    bindTypeToggle(el.historyTypeFilter, (type) => {
      state.historyTypeFilter = type;
      renderHistory();
    });
  }

  function renderHistory() {
    const bookId = DB.getCurrentBookId();
    const filter = state.historyTypeFilter ? { type: state.historyTypeFilter } : {};
    const transactions = DB.getTransactionsByBook(bookId, filter).sort((a, b) => b.timestamp - a.timestamp);
    el.historyList.innerHTML = '';
    el.historyEmpty.classList.toggle('hidden', transactions.length > 0);
    const book = DB.getBooks().find(b => b.id === bookId);
    const currency = book ? book.currency : '';

    transactions.forEach(tx => {
      const item = document.createElement('li');
      item.className = 'history-item';
      const date = new Date(tx.timestamp);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      const badgeBg = getCategoryColor(tx.category) + '22';
      const badgeText = getCategoryTextColor(tx.category);
      const sign = tx.type === 'income' ? '+' : '−';
      const amountClass = tx.type === 'income' ? 'income' : 'expense';
      item.innerHTML = `
        <div class="history-main">
          <div class="history-top">
            <span class="history-category" style="background:${badgeBg};color:${badgeText}">${tx.category}</span>
            <span class="history-date">${dateStr}</span>
          </div>
          <div class="history-note">${escapeHtml(tx.note || tx.rawText || '（無備註）')}</div>
        </div>
        <div class="history-amount ${amountClass}">${sign}${currency} ${tx.amount.toLocaleString()}</div>
        <div class="history-actions">
          <button class="history-edit" data-id="${tx.id}" aria-label="編輯">✎</button>
          <button class="history-delete" data-id="${tx.id}" aria-label="刪除">✕</button>
        </div>
      `;
      item.querySelector('.history-edit').addEventListener('click', () => {
        state.editingTxId = tx.id;
        openConfirmForm({
          type: tx.type,
          amount: tx.amount,
          category: tx.category,
          note: tx.note,
          rawText: tx.rawText,
          timestamp: tx.timestamp
        });
        switchTab('record');
      });
      item.querySelector('.history-delete').addEventListener('click', () => {
        if (confirm('確定刪除這筆紀錄？')) {
          DB.deleteTransaction(tx.id);
          renderHistory();
          if (document.getElementById('tab-stats').classList.contains('active')) renderStats();
        }
      });
      el.historyList.appendChild(item);
    });
  }

  // ---------- Stats tab ----------
  function renderStats() {
    const books = DB.getBooks();
    const prevValue = el.statsBookSelect.value;
    el.statsBookSelect.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '全部帳本';
    el.statsBookSelect.appendChild(allOpt);
    books.forEach(book => {
      const opt = document.createElement('option');
      opt.value = book.id;
      opt.textContent = book.name;
      el.statsBookSelect.appendChild(opt);
    });
    const optionValues = Array.from(el.statsBookSelect.options).map(o => o.value);
    if (state.statsFilterTouched && optionValues.includes(prevValue)) {
      el.statsBookSelect.value = prevValue;
    } else {
      el.statsBookSelect.value = DB.getCurrentBookId() || '';
    }

    const bookId = el.statsBookSelect.value || null;
    const transactions = DB.getTransactionsByBook(bookId);
    const summary = Stats.summarize(transactions);
    const book = books.find(b => b.id === bookId);
    const currency = bookId && book ? book.currency : '';

    el.statsIncome.textContent = `${currency} ${summary.income.toLocaleString()}`;
    el.statsExpense.textContent = `${currency} ${summary.expense.toLocaleString()}`;
    el.statsNet.textContent = `${currency} ${summary.net.toLocaleString()}`;
    el.statsNet.classList.toggle('negative', summary.net < 0);
    el.statsCount.textContent = `共 ${summary.count} 筆`;

    renderGroupedBarChart(el.trendChart, summary.monthlyData);
    if (summary.expenseChangeRate == null) {
      el.statsChangeRate.textContent = '';
    } else {
      const rate = summary.expenseChangeRate;
      el.statsChangeRate.textContent = `本月支出較上月${rate >= 0 ? '增加' : '減少'} ${Math.abs(rate).toFixed(1)}%`;
      el.statsChangeRate.classList.toggle('negative', rate > 0);
    }

    renderPieChart(el.pieChart, summary.expenseCategoryData);
    el.pieLegend.innerHTML = '';
    summary.expenseCategoryData.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `<span class="legend-dot" style="background:${getCategoryColor(d.label)}"></span>
        <span class="legend-label">${d.label}</span>
        <span class="legend-value">${d.value.toLocaleString()}（${d.percent.toFixed(0)}%）</span>`;
      el.pieLegend.appendChild(row);
    });

    if (!bookId) {
      el.budgetUsage.innerHTML = '<p class="chart-empty-text">請選擇特定帳本以查看預算使用狀況</p>';
    } else {
      const budgets = DB.getBudgets(bookId);
      const usage = Stats.budgetUsage(transactions, budgets);
      renderBudgetBars(el.budgetUsage, usage);
    }
  }

  // ---------- Recurring tab ----------
  function frequencyLabel(r) {
    if (r.frequency === 'daily') return '每天';
    if (r.frequency === 'weekly') {
      const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
      return `每${days[r.weekday || 0]}`;
    }
    return `每月${r.dayOfMonth || '?'}日`;
  }

  function bindRecurringTab() {
    bindTypeToggle(el.recurringTypeToggle, (type) => {
      state.recurringType = type;
      const categories = categoriesForType(type);
      renderChips(el.recurringCategoryChips, categories, categories[categories.length - 1]);
    });
    renderChips(el.recurringCategoryChips, categoriesForType(state.recurringType), '其他');
    el.recurringStartInput.value = todayDateStr();

    el.recurringForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const bookId = DB.getCurrentBookId();
      if (!bookId) {
        alert('請先建立並選擇一個帳本');
        return;
      }
      const amount = parseFloat(el.recurringAmountInput.value);
      if (isNaN(amount) || amount <= 0) {
        alert('請輸入有效的金額');
        return;
      }
      const categories = categoriesForType(state.recurringType);
      const selectedChip = el.recurringCategoryChips.querySelector('.chip.selected');
      const category = selectedChip ? selectedChip.dataset.category : categories[categories.length - 1];
      const note = el.recurringNoteInput.value.trim();
      const frequency = el.recurringFrequencyInput.value;
      const startDate = el.recurringStartInput.value || todayDateStr();
      const startDateObj = new Date(startDate + 'T00:00:00');
      const dayOfMonth = frequency === 'monthly' ? startDateObj.getDate() : null;
      const weekday = frequency === 'weekly' ? startDateObj.getDay() : null;

      DB.addRecurring({ bookId, type: state.recurringType, amount, category, note, frequency, dayOfMonth, weekday, startDate });
      el.recurringForm.reset();
      el.recurringStartInput.value = todayDateStr();
      renderChips(el.recurringCategoryChips, categories, categories[categories.length - 1]);
      renderRecurringList();
    });
  }

  function renderRecurringList() {
    const bookId = DB.getCurrentBookId();
    const items = bookId ? DB.getRecurrings(bookId) : [];
    el.recurringList.innerHTML = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = '尚未設定任何定期收支';
      el.recurringList.appendChild(li);
      return;
    }
    items.forEach(r => {
      const li = document.createElement('li');
      li.className = 'history-item' + (r.active ? '' : ' inactive');
      const badgeBg = getCategoryColor(r.category) + '22';
      const badgeText = getCategoryTextColor(r.category);
      const sign = r.type === 'income' ? '+' : '−';
      const amountClass = r.type === 'income' ? 'income' : 'expense';
      li.innerHTML = `
        <div class="history-main">
          <div class="history-top">
            <span class="history-category" style="background:${badgeBg};color:${badgeText}">${r.category}</span>
            <span class="history-date">${frequencyLabel(r)} · 下次 ${r.nextDate}</span>
          </div>
          <div class="history-note">${escapeHtml(r.note || r.category)}</div>
        </div>
        <div class="history-amount ${amountClass}">${sign}${r.amount.toLocaleString()}</div>
        <div class="history-actions">
          <button class="recurring-toggle" data-id="${r.id}" aria-label="啟用或暫停">${r.active ? '⏸' : '▶'}</button>
          <button class="history-delete" data-id="${r.id}" aria-label="刪除">✕</button>
        </div>
      `;
      li.querySelector('.recurring-toggle').addEventListener('click', () => {
        DB.updateRecurring(r.id, { active: !r.active });
        renderRecurringList();
      });
      li.querySelector('.history-delete').addEventListener('click', () => {
        if (confirm('確定刪除這筆定期收支設定？')) {
          DB.deleteRecurring(r.id);
          renderRecurringList();
        }
      });
      el.recurringList.appendChild(li);
    });
  }

  // ---------- Books tab ----------
  function bindBookTab() {
    el.bookForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = el.bookNameInput.value.trim();
      if (!name) return;
      const book = DB.addBook({
        name,
        currency: el.bookCurrencyInput.value.trim() || 'TWD'
      });
      DB.setCurrentBookId(book.id);
      el.bookForm.reset();
      renderAll();
      switchTab('record');
    });

    el.exportJsonBtn.addEventListener('click', exportJson);
    el.exportCsvBtn.addEventListener('click', exportCsv);
    el.importFileInput.addEventListener('change', handleImportFile);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function todayStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  function exportJson() {
    const data = DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(`生活記帳備份-${todayStamp()}.json`, blob);
  }

  function csvEscape(value) {
    const str = String(value == null ? '' : value);
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function exportCsv() {
    const bookId = DB.getCurrentBookId();
    if (!bookId) {
      alert('請先建立並選擇一個帳本');
      return;
    }
    const book = DB.getBooks().find(b => b.id === bookId);
    const transactions = DB.getTransactionsByBook(bookId).sort((a, b) => a.timestamp - b.timestamp);
    const rows = [['日期時間', '類型', '類別', '金額', '幣別', '備註', '語音原文']];
    transactions.forEach(tx => {
      rows.push([
        toDatetimeLocalValue(tx.timestamp).replace('T', ' '),
        tx.type === 'income' ? '收入' : '支出',
        tx.category,
        tx.amount,
        book ? book.currency : '',
        tx.note,
        tx.rawText
      ]);
    });
    const csvBody = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
    // 加上 UTF-8 BOM，讓 Excel 開啟時中文不會亂碼
    const blob = new Blob(['﻿' + csvBody], { type: 'text/csv;charset=utf-8' });
    const bookName = book ? book.name : '帳本';
    downloadBlob(`${bookName}-收支紀錄-${todayStamp()}.csv`, blob);
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const result = DB.importAll(data);
        alert(`匯入完成：新增 ${result.addedBooks} 個帳本、${result.addedTx} 筆收支紀錄`);
        renderAll();
      } catch (err) {
        alert('匯入失敗：檔案格式不正確');
      }
      el.importFileInput.value = '';
    };
    reader.readAsText(file);
  }

  function renderBooks() {
    const books = DB.getBooks();
    el.bookList.innerHTML = '';
    if (books.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = '尚未建立任何帳本，請在下方新增';
      el.bookList.appendChild(li);
      return;
    }
    const currentId = DB.getCurrentBookId();
    books.forEach(book => {
      const li = document.createElement('li');
      li.className = 'trip-item' + (book.id === currentId ? ' active' : '');
      li.innerHTML = `
        <div class="trip-info">
          <div class="trip-name">${escapeHtml(book.name)}${book.id === currentId ? '（目前）' : ''}</div>
          <div class="trip-meta">幣別：${escapeHtml(book.currency)}</div>
        </div>
        <div class="trip-actions">
          <button class="btn-select" data-id="${book.id}">選用</button>
          <button class="btn-delete" data-id="${book.id}">刪除</button>
        </div>
      `;
      li.querySelector('.btn-select').addEventListener('click', () => {
        DB.setCurrentBookId(book.id);
        renderAll();
      });
      li.querySelector('.btn-delete').addEventListener('click', () => {
        if (confirm(`確定刪除帳本「${book.name}」？其收支紀錄也會一併刪除`)) {
          DB.deleteBook(book.id);
          renderAll();
        }
      });
      el.bookList.appendChild(li);
    });
  }

  function renderBudgetForm() {
    const bookId = DB.getCurrentBookId();
    if (!bookId) {
      el.budgetForm.innerHTML = '<p class="chart-empty-text">請先建立帳本</p>';
      return;
    }
    const budgets = DB.getBudgets(bookId);
    const budgetMap = {};
    budgets.forEach(b => { budgetMap[b.category] = b.amount; });
    el.budgetForm.innerHTML = '';
    EXPENSE_CATEGORIES.filter(cat => cat !== '其他').forEach(cat => {
      const row = document.createElement('label');
      row.className = 'field budget-input-row';
      row.innerHTML = `<span>${cat}</span><input type="number" min="0" step="1" placeholder="未設定" value="${budgetMap[cat] != null ? budgetMap[cat] : ''}">`;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        const val = parseFloat(input.value);
        DB.setBudget(bookId, cat, isNaN(val) || val <= 0 ? null : val);
      });
      el.budgetForm.appendChild(row);
    });
  }

  function renderAll() {
    renderRecordTab();
    renderHistory();
    renderStats();
    renderBooks();
    renderBudgetForm();
    renderRecurringList();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
          console.warn('Service worker 註冊失敗', err);
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
