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

  // 計算「本月」各類別支出與預算的使用狀況
  function budgetUsage(transactions, budgets) {
    const now = new Date();
    const curKey = monthKey(now.getTime());
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

  return { summarize, budgetUsage };
})();
