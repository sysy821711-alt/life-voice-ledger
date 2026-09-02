// 收支資料彙總：收入／支出／結餘、依類別分佈、每月趨勢與變化率、預算使用狀況

const Stats = (() => {
  function monthKey(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function summarize(transactions) {
    const incomeTx = transactions.filter(t => t.type === 'income');
    const expenseTx = transactions.filter(t => t.type !== 'income');
    const income = incomeTx.reduce((s, t) => s + t.amount, 0);
    const expense = expenseTx.reduce((s, t) => s + t.amount, 0);

    const byCategory = {};
    expenseTx.forEach(t => {
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    });
    const expenseCategoryData = Object.keys(byCategory)
      .map(cat => ({ label: cat, value: byCategory[cat], percent: expense > 0 ? (byCategory[cat] / expense * 100) : 0 }))
      .sort((a, b) => b.value - a.value);

    const byDate = {};
    expenseTx.forEach(t => {
      const d = new Date(t.timestamp);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      byDate[dateKey] = (byDate[dateKey] || 0) + t.amount;
    });
    const dailyData = Object.keys(byDate)
      .sort()
      .map(date => ({ label: date.slice(5), value: byDate[date] }));

    // 依月份彙總收入／支出，供趨勢圖與變化率使用
    const byMonth = {};
    transactions.forEach(t => {
      const key = monthKey(t.timestamp);
      if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0 };
      if (t.type === 'income') byMonth[key].income += t.amount;
      else byMonth[key].expense += t.amount;
    });
    const monthlyData = Object.keys(byMonth)
      .sort()
      .map(key => ({ label: key.slice(5), income: byMonth[key].income, expense: byMonth[key].expense }));

    // 本月與上月的支出變化率
    let expenseChangeRate = null;
    if (monthlyData.length >= 2) {
      const thisMonth = monthlyData[monthlyData.length - 1];
      const lastMonth = monthlyData[monthlyData.length - 2];
      if (lastMonth.expense > 0) {
        expenseChangeRate = ((thisMonth.expense - lastMonth.expense) / lastMonth.expense) * 100;
      }
    }

    return {
      income, expense, net: income - expense,
      count: transactions.length,
      expenseCategoryData, dailyData, monthlyData, expenseChangeRate
    };
  }

  // 計算指定月份（預設本月）各類別支出與預算的使用狀況
  function budgetUsage(transactions, budgets, year, month) {
    const now = new Date();
    const curKey = year != null && month != null
      ? `${year}-${String(month + 1).padStart(2, '0')}`
      : monthKey(now.getTime());
    const spentByCategory = {};
    transactions
      .filter(t => t.type !== 'income' && monthKey(t.timestamp) === curKey)
      .forEach(t => {
        spentByCategory[t.category] = (spentByCategory[t.category] || 0) + t.amount;
      });
    return budgets.map(b => {
      const spent = spentByCategory[b.category] || 0;
      return {
        category: b.category,
        budget: b.amount,
        spent,
        percent: b.amount > 0 ? Math.min(100, (spent / b.amount) * 100) : 0,
        over: spent > b.amount
      };
    });
  }

  // 計算「單一月份」或「整年」的收支總計、依類別明細、依付款方式明細
  // period: { type: 'month'|'year', year, month(0-11，僅 month 模式需要) }
  // categories: DB.getCategories() 全部（收入＋支出）；paymentMethods: DB.getPaymentMethods()
  function summarizePeriod(transactions, period, categories, paymentMethods) {
    const filtered = transactions.filter(t => {
      const d = new Date(t.timestamp);
      if (period.type === 'year') return d.getFullYear() === period.year;
      return d.getFullYear() === period.year && d.getMonth() === period.month;
    });

    const income = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter(t => t.type !== 'income').reduce((s, t) => s + t.amount, 0);

    function byCategory(txType) {
      const known = categories.filter(c => c.type === txType);
      const sums = {};
      filtered.filter(t => t.type === txType).forEach(t => {
        sums[t.category] = (sums[t.category] || 0) + t.amount;
      });
      const rows = known.map(c => ({ label: c.name, icon: c.icon, value: sums[c.name] || 0 }));
      Object.keys(sums).forEach(name => {
        if (!known.some(c => c.name === name)) rows.push({ label: name, icon: '🏷️', value: sums[name] });
      });
      return rows;
    }

    function byPayment() {
      const sums = {};
      let unassigned = 0;
      filtered.filter(t => t.type !== 'income').forEach(t => {
        if (t.paymentMethod) sums[t.paymentMethod] = (sums[t.paymentMethod] || 0) + t.amount;
        else unassigned += t.amount;
      });
      const rows = paymentMethods.map(p => ({ label: p.name, icon: p.icon, value: sums[p.name] || 0 }));
      Object.keys(sums).forEach(name => {
        if (!paymentMethods.some(p => p.name === name)) rows.push({ label: name, icon: '🏷️', value: sums[name] });
      });
      if (unassigned > 0) rows.push({ label: '未指定', icon: '❔', value: unassigned });
      return rows;
    }

    return {
      income, expense, net: income - expense, count: filtered.length,
      incomeByCategory: byCategory('income'),
      expenseByCategory: byCategory('expense'),
      paymentBreakdown: byPayment()
    };
  }

  return { summarize, budgetUsage, summarizePeriod };
})();
