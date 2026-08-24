// 手刻 SVG 圖表（不依賴外部套件，離線也能正常渲染）

// 每個分類固定專屬顏色（不隨排序變動），紀錄清單標籤／圓餅圖／圖例都共用同一組
const CATEGORY_COLORS = {
  '餐飲': '#4F8EF7',
  '交通': '#F76E4F',
  '居住': '#4FD1A5',
  '購物': '#A47FF7',
  '娛樂': '#F7C948',
  '醫療': '#EC6C9A',
  '教育': '#5AB0D6',
  '人情': '#D69E5A',
  '薪資': '#2FBF71',
  '獎金': '#2FBF71',
  '投資': '#2FBF71',
  '退款': '#2FBF71',
  '其他收入': '#2FBF71',
  '其他': '#B0B8C4'
};

// 文字用的深色版本（部分顏色如黃色直接當文字色，在淺底上對比不足）
const CATEGORY_TEXT_COLORS = {
  '餐飲': '#3A70D6',
  '交通': '#D14E2F',
  '居住': '#1F9C74',
  '購物': '#7A4FE0',
  '娛樂': '#A67A00',
  '醫療': '#C24E7C',
  '教育': '#2E86AE',
  '人情': '#A6772F',
  '薪資': '#1F9C56',
  '獎金': '#1F9C56',
  '投資': '#1F9C56',
  '退款': '#1F9C56',
  '其他收入': '#1F9C56',
  '其他': '#6B7280'
};

const INCOME_COLOR = '#2FBF71';
const EXPENSE_COLOR = '#F76E4F';
// 每日趨勢圖用單一中性色，刻意跟上方分類色盤區隔，避免讓人誤以為顏色有對應關係
const TREND_BAR_COLOR = '#334155';

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS['其他'];
}

function getCategoryTextColor(category) {
  return CATEGORY_TEXT_COLORS[category] || CATEGORY_TEXT_COLORS['其他'];
}

function svgEl(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function renderPieChart(container, data) {
  container.innerHTML = '';
  const total = data.reduce((s, d) => s + d.value, 0);
  const size = 200, r = 90, cx = size / 2, cy = size / 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: size });

  if (total <= 0) {
    const text = svgEl('text', { x: cx, y: cy, 'text-anchor': 'middle', class: 'chart-empty' });
    text.textContent = '尚無資料';
    svg.appendChild(text);
    container.appendChild(svg);
    return;
  }

  let angleStart = -90;
  data.forEach((d) => {
    const angle = (d.value / total) * 360;
    const angleEnd = angleStart + angle;
    const largeArc = angle > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos(Math.PI * angleStart / 180);
    const y1 = cy + r * Math.sin(Math.PI * angleStart / 180);
    const x2 = cx + r * Math.cos(Math.PI * angleEnd / 180);
    const y2 = cy + r * Math.sin(Math.PI * angleEnd / 180);
    const d1 = data.length === 1
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
      : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    const path = svgEl('path', { d: d1, fill: getCategoryColor(d.label) });
    const title = svgEl('title', {});
    title.textContent = `${d.label}: ${d.value}`;
    path.appendChild(title);
    svg.appendChild(path);
    angleStart = angleEnd;
  });
  container.appendChild(svg);
}

function renderBarChart(container, data, color) {
  container.innerHTML = '';
  if (data.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty-text';
    empty.textContent = '尚無資料';
    container.appendChild(empty);
    return;
  }
  const barColor = color || TREND_BAR_COLOR;
  const max = Math.max(1, ...data.map(d => d.value));
  const barW = 28, gap = 16, height = 160, paddingBottom = 24, paddingTop = 10;
  const width = data.length * (barW + gap) + gap;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: Math.max(width, 300),
    height,
    preserveAspectRatio: 'xMinYMin meet'
  });
  data.forEach((d, i) => {
    const barH = (d.value / max) * (height - paddingBottom - paddingTop);
    const x = gap + i * (barW + gap);
    const y = height - paddingBottom - barH;
    const rect = svgEl('rect', { x, y, width: barW, height: barH, rx: 4, fill: barColor });
    const title = svgEl('title', {});
    title.textContent = `${d.label}: ${d.value}`;
    rect.appendChild(title);
    svg.appendChild(rect);
    const label = svgEl('text', { x: x + barW / 2, y: height - 8, 'text-anchor': 'middle', class: 'chart-label' });
    label.textContent = d.label;
    svg.appendChild(label);
  });
  const wrap = document.createElement('div');
  wrap.className = 'bar-chart-scroll';
  wrap.appendChild(svg);
  container.appendChild(wrap);
}

// 每月收入／支出並排長條圖
function renderGroupedBarChart(container, data) {
  container.innerHTML = '';
  if (data.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty-text';
    empty.textContent = '尚無資料';
    container.appendChild(empty);
    return;
  }
  const max = Math.max(1, ...data.map(d => Math.max(d.income, d.expense)));
  const barW = 14, barGap = 4, groupGap = 20, height = 170, paddingBottom = 24, paddingTop = 10;
  const groupW = barW * 2 + barGap;
  const width = data.length * (groupW + groupGap) + groupGap;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: Math.max(width, 300),
    height,
    preserveAspectRatio: 'xMinYMin meet'
  });
  data.forEach((d, i) => {
    const groupX = groupGap + i * (groupW + groupGap);
    const incomeH = (d.income / max) * (height - paddingBottom - paddingTop);
    const expenseH = (d.expense / max) * (height - paddingBottom - paddingTop);

    const incomeRect = svgEl('rect', {
      x: groupX, y: height - paddingBottom - incomeH, width: barW, height: incomeH, rx: 3, fill: INCOME_COLOR
    });
    const incomeTitle = svgEl('title', {});
    incomeTitle.textContent = `${d.label} 收入: ${d.income}`;
    incomeRect.appendChild(incomeTitle);
    svg.appendChild(incomeRect);

    const expenseRect = svgEl('rect', {
      x: groupX + barW + barGap, y: height - paddingBottom - expenseH, width: barW, height: expenseH, rx: 3, fill: EXPENSE_COLOR
    });
    const expenseTitle = svgEl('title', {});
    expenseTitle.textContent = `${d.label} 支出: ${d.expense}`;
    expenseRect.appendChild(expenseTitle);
    svg.appendChild(expenseRect);

    const label = svgEl('text', { x: groupX + groupW / 2, y: height - 8, 'text-anchor': 'middle', class: 'chart-label' });
    label.textContent = d.label;
    svg.appendChild(label);
  });
  const wrap = document.createElement('div');
  wrap.className = 'bar-chart-scroll';
  wrap.appendChild(svg);
  container.appendChild(wrap);
}

// 預算使用進度條
function renderBudgetBars(container, usageData) {
  container.innerHTML = '';
  if (usageData.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty-text';
    empty.textContent = '尚未設定任何預算';
    container.appendChild(empty);
    return;
  }
  usageData.forEach(u => {
    const row = document.createElement('div');
    row.className = 'budget-row';
    const barColor = u.over ? EXPENSE_COLOR : getCategoryColor(u.category);
    row.innerHTML = `
      <div class="budget-row-top">
        <span class="budget-category">${u.category}</span>
        <span class="budget-value${u.over ? ' over' : ''}">${u.spent.toLocaleString()} / ${u.budget.toLocaleString()}</span>
      </div>
      <div class="budget-track"><div class="budget-fill" style="width:${u.percent}%;background:${barColor}"></div></div>
    `;
    container.appendChild(row);
  });
}
