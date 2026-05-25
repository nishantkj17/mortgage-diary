(function () {
  'use strict';

  const API = window.location.hostname === 'localhost' ? 'http://localhost:5001/api/budget' : '/api/budget';

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function fmt(n) { return '$' + (Number(n) || 0).toLocaleString('en-US'); }
  function monthLabel(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }
  function currentMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function prevMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // ── Toast ────────────────────────────────────────────────────────────────────
  let _tt;
  function toast(msg, type = 'success') {
    const el = document.getElementById('bToast');
    clearTimeout(_tt);
    el.textContent = msg;
    el.className = 'b-toast b-toast-' + type + ' b-toast-show';
    _tt = setTimeout(() => el.classList.remove('b-toast-show'), 2800);
  }

  // ── Confirm ──────────────────────────────────────────────────────────────────
  function confirm(msg) {
    return new Promise(resolve => {
      const modal = document.getElementById('bConfirmModal');
      document.getElementById('bConfirmMsg').textContent = msg;
      modal.classList.add('active');
      const ok = document.getElementById('bConfirmOk');
      const cancel = document.getElementById('bConfirmCancel');
      const cleanup = (v) => { modal.classList.remove('active'); resolve(v); };
      ok.onclick = () => cleanup(true);
      cancel.onclick = () => cleanup(false);
    });
  }

  // ── State ────────────────────────────────────────────────────────────────────
  let db = { categories: [], months: {} }; // full persisted state
  let activeMonth = currentMonth();

  // ── Persistence ─────────────────────────────────────────────────────────────
  async function load() {
    try {
      const r = await fetch(API);
      if (!r.ok) throw new Error();
      db = await r.json();
      if (!db.categories) db.categories = [];
      if (!db.months) db.months = {};
    } catch { db = { categories: [], months: {} }; }
  }
  async function save() {
    try {
      await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) });
    } catch { toast('Failed to save', 'error'); }
  }

  // ── Month data helpers ───────────────────────────────────────────────────────
  function getMonth(ym) {
    if (!db.months[ym]) db.months[ym] = { budget: [], expenses: [] };
    return db.months[ym];
  }
  function totalBudget(ym) { return getMonth(ym).budget.reduce((s, e) => s + (Number(e.amount) || 0), 0); }
  function totalExpenses(ym) {
    const month = getMonth(ym);
    const overrideIds = new Set(month.expenses.filter(e => e.fixedId).map(e => e.fixedId));
    const fixedSum = month.budget.filter(e => e.fixed && !overrideIds.has(e.id)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const manualSum = month.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return fixedSum + manualSum;
  }

  // ── Per-category breakdown (budgeted + actual) ──────────────────────────────────────
  function catBreakdown(ym) {
    const month = getMonth(ym);
    const overrideIds = new Set(month.expenses.filter(e => e.fixedId).map(e => e.fixedId));
    const map = {};
    month.budget.forEach(e => {
      if (!map[e.category]) map[e.category] = { budgeted: 0, actual: 0 };
      map[e.category].budgeted += Number(e.amount) || 0;
      if (e.fixed && !overrideIds.has(e.id)) map[e.category].actual += Number(e.amount) || 0;
    });
    month.expenses.forEach(e => {
      if (!map[e.category]) map[e.category] = { budgeted: 0, actual: 0 };
      map[e.category].actual += Number(e.amount) || 0;
    });
    return map;
  }

  // ── Summary cards ────────────────────────────────────────────────────────────
  function renderSummaryCards() {
    const budget = totalBudget(activeMonth);
    const spent = totalExpenses(activeMonth);
    const diff = budget - spent;
    const over = diff < 0;

    const budgetAmtEl = document.getElementById('cardBudgetAmt');
    const expenseAmtEl = document.getElementById('cardExpenseAmt');
    const diffEl = document.getElementById('cardDiff');
    const arrowEl = document.getElementById('cardArrow');

    if (budgetAmtEl) budgetAmtEl.textContent = fmt(budget);
    if (expenseAmtEl) expenseAmtEl.textContent = fmt(spent);
    if (diffEl) { diffEl.textContent = fmt(Math.abs(diff)); diffEl.className = 'b-summary-diff ' + (over ? 'over' : 'under'); }
    if (arrowEl) { arrowEl.textContent = over ? '↑' : '↓'; arrowEl.className = 'b-arrow ' + (over ? 'over' : 'under'); }
  }

  // ── Nearing-limit progress bars (≥ 40% spent) ───────────────────────────────
  function renderCategoryProgress() {
    const section = document.getElementById('catProgressSection');
    const list = document.getElementById('catProgressList');
    const ubSection = document.getElementById('unbudgetedProgressSection');
    const ubList = document.getElementById('unbudgetedProgressList');
    const breakdown = catBreakdown(activeMonth);
    const month = getMonth(activeMonth);
    const totalBudgeted = totalBudget(activeMonth);
    const threshold = totalBudgeted * 0.02;

    // Build set of categories whose budget entries are ALL fixed (auto-logged — no alert needed)
    const fixedOnlyCats = new Set(
      db.categories.map(c => c.name).filter(name => {
        const entries = month.budget.filter(e => e.category === name);
        return entries.length > 0 && entries.every(e => e.fixed);
      })
    );

    // ── Nearing-limit alerts (has budget, >= 40% spent) ───────────────────────
    const alerts = Object.entries(breakdown)
      .filter(([cat, { budgeted, actual }]) => budgeted > 0 && !fixedOnlyCats.has(cat) && actual / budgeted >= 0.4)
      .sort((a, b) => (b[1].actual / b[1].budgeted) - (a[1].actual / a[1].budgeted));
    if (!alerts.length) { section.style.display = 'none'; }
    else {
      section.style.display = 'block';
      list.innerHTML = '';
      alerts.forEach(([cat, { budgeted, actual }]) => {
        const pct = Math.min((actual / budgeted) * 100, 100);
        const over = actual > budgeted;
        const row = document.createElement('div');
        row.className = 'b-progress-row';
        row.innerHTML = `
          <div class="b-progress-meta">
            <span class="b-progress-cat">${esc(cat)}</span>
            <span class="b-progress-amounts${over ? ' over' : ''}">${fmt(actual)} / ${fmt(budgeted)}</span>
          </div>
          <div class="b-progress-track">
            <div class="b-progress-fill${over ? ' over' : ''}" style="width:${pct}%"></div>
          </div>`;
        row.addEventListener('click', () => openCatTxnModal(cat));
        list.appendChild(row);
      });
    }

    // ── Unbudgeted categories (no budget entry, expense > 5% of total budget) ─
    const budgetedCats = new Set(month.budget.map(e => e.category));
    const unbudgeted = Object.entries(breakdown)
      .filter(([cat, { budgeted, actual }]) => budgeted === 0 && !budgetedCats.has(cat) && actual > threshold)
      .sort((a, b) => b[1].actual - a[1].actual);
    if (!unbudgeted.length) { ubSection.style.display = 'none'; }
    else {
      ubSection.style.display = 'block';
      ubList.innerHTML = '';
      unbudgeted.forEach(([cat, { actual }]) => {
        const row = document.createElement('div');
        row.className = 'b-progress-row';
        row.innerHTML = `
          <div class="b-progress-meta">
            <span class="b-progress-cat">${esc(cat)}</span>
            <span class="b-progress-amounts over">${fmt(actual)}</span>
          </div>
          <div class="b-progress-track">
            <div class="b-progress-fill over" style="width:100%"></div>
          </div>`;
        row.addEventListener('click', () => openCatTxnModal(cat));
        ubList.appendChild(row);
      });
    }
  }

  // ── Category Transactions Popup ────────────────────────────────────────────
  let catTxnDonutInst = null;

  function openCatTxnModal(cat) {
    const month = getMonth(activeMonth);
    document.getElementById('catTxnTitle').textContent = cat + ' — Transactions';
    const tbody = document.querySelector('#catTxnTable tbody');
    tbody.innerHTML = '';
    const rows = [];
    // Fixed budget entries that apply (not overridden)
    const overrideIds = new Set(month.expenses.filter(e => e.fixedId).map(e => e.fixedId));
    month.budget.filter(e => e.category === cat && e.fixed && !overrideIds.has(e.id)).forEach(e => {
      rows.push({ date: '', desc: e.description || '', amount: e.amount, note: 'Fixed (auto)', subCategory: '' });
    });
    // Override and manual expenses
    month.expenses.filter(e => e.category === cat).forEach(e => {
      const budgetEntry = e.fixedId ? month.budget.find(b => b.id === e.fixedId) : null;
      rows.push({ date: e.date || '', desc: e.description || '', amount: e.amount, note: budgetEntry ? 'Fixed (edited)' : '', subCategory: e.subCategory || '' });
    });
    // Sort: dated newest first, undated at top
    rows.sort((a, b) => { if (!a.date && !b.date) return 0; if (!a.date) return -1; if (!b.date) return 1; return b.date.localeCompare(a.date); });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="b-empty-row">No transactions found.</td></tr>';
    } else {
      rows.forEach(({ date, desc, amount, note, subCategory }) => {
        const dateLabel = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
        const descCell = subCategory ? `<span class="b-subcat-chip">› ${esc(subCategory)}</span> ${esc(desc)}` : esc(desc);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="b-muted-cell" style="white-space:nowrap">${dateLabel}</td><td class="b-muted-cell">${descCell}</td><td class="b-amount-cell">${fmt(amount)}</td><td class="b-muted-cell" style="font-size:11px">${esc(note)}</td>`;
        tbody.appendChild(tr);
      });
    }

    // ── Vacation sub-category donut ──────────────────────────────────────────
    const donutWrap = document.getElementById('catTxnDonutWrap');
    const legendEl  = document.getElementById('catTxnDonutLegend');
    if (catTxnDonutInst) { catTxnDonutInst.destroy(); catTxnDonutInst = null; }
    if (cat === VACATION_CAT) {
      const tally = {};
      month.expenses.filter(e => e.category === VACATION_CAT).forEach(e => {
        const key = e.subCategory || 'Other';
        tally[key] = (tally[key] || 0) + (Number(e.amount) || 0);
      });
      const labels = Object.keys(tally);
      if (labels.length >= 1) {
        const values = labels.map(l => tally[l]);
        const SUB_COLORS = ['#4db6ac','#ff8a65','#ba68c8','#4fc3f7','#aed581','#f06292','#ffd54f','#80cbc4'];
        const colors = labels.map((_, i) => SUB_COLORS[i % SUB_COLORS.length]);
        donutWrap.style.display = 'flex';
        catTxnDonutInst = new Chart(document.getElementById('catTxnDonut').getContext('2d'), {
          type: 'doughnut',
          data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
          options: {
            responsive: false,
            cutout: '60%',
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)}` } }
            }
          }
        });
        legendEl.innerHTML = labels.map((l, i) =>
          `<div class="cat-txn-legend-item"><span class="cat-txn-legend-dot" style="background:${colors[i]}"></span><span class="cat-txn-legend-label">${esc(l)}</span><span class="cat-txn-legend-val">${fmt(tally[l])}</span></div>`
        ).join('');
      } else {
        donutWrap.style.display = 'none';
      }
    } else {
      donutWrap.style.display = 'none';
    }

    document.getElementById('catTxnModal').classList.add('active');
  }

  // ── Charts ───────────────────────────────────────────────────────────────────
  let donutInst = null;
  let lineInst = null;
  const CHART_COLORS = ['#607d8b','#4db6ac','#ff8a65','#ba68c8','#4fc3f7','#aed581','#f06292','#ffd54f','#80cbc4','#ffb74d'];

  function renderCharts() {
    const breakdown = catBreakdown(activeMonth);
    const cats = Object.keys(breakdown).sort();
    const carousel = document.getElementById('chartCarousel');
    if (!cats.length) { carousel.style.display = 'none'; return; }
    carousel.style.display = 'block';

    const includeRent    = document.getElementById('includeRentChk')    ? document.getElementById('includeRentChk').checked    : true;
    const includeCarLoan = document.getElementById('includeCarLoanChk') ? document.getElementById('includeCarLoanChk').checked : true;
    const includeIndia   = document.getElementById('includeIndiaChk')   ? document.getElementById('includeIndiaChk').checked   : true;
    const donutCats = cats.filter(c => {
      const cl = c.toLowerCase();
      if (!includeRent    && cl === 'rent')     return false;
      if (!includeCarLoan && cl === 'car loan') return false;
      if (!includeIndia   && cl === 'india')    return false;
      return true;
    });

    const actuals = cats.map(c => breakdown[c].actual);
    const budgets = cats.map(c => breakdown[c].budgeted);
    const colors  = cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
    const donutActuals = donutCats.map(c => breakdown[c].actual);
    const donutColors  = donutCats.map(c => CHART_COLORS[cats.indexOf(c) % CHART_COLORS.length]);
    const isDark   = document.documentElement.getAttribute('data-theme') === 'dark';
    const tickColor = isDark ? '#9ca3af' : '#78909c';
    const gridColor = isDark ? '#374151' : '#f0f1f4';

    if (donutInst) donutInst.destroy();
    donutInst = new Chart(document.getElementById('donutChart').getContext('2d'), {
      type: 'doughnut',
      data: { labels: donutCats, datasets: [{ data: donutActuals, backgroundColor: donutColors, borderWidth: 0 }] },
      options: {
        responsive: true, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)}` } }
        }
      }
    });

    // ── Weekday-labeled daily stacked bar chart (manual expenses only) ──────────
    const month = getMonth(activeMonth);
    const [y, m] = activeMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = new Date();
    const lastDay = (today.getFullYear() === y && today.getMonth() + 1 === m)
      ? today.getDate() : daysInMonth;

    // Collect unique categories from manual expenses
    const manualExps = month.expenses.filter(e => !e.fixedId && e.date);
    const barCats = [...new Set(manualExps.map(e => e.category))].sort();

    const barLabels = Array.from({ length: lastDay }, (_, i) => i + 1);

    const barDatasets = barCats.map((cat, ci) => {
      const data = barLabels.map((_, di) => {
        const dayNum = di + 1;
        return manualExps
          .filter(e => e.category === cat && parseInt(e.date.split('-')[2], 10) === dayNum)
          .reduce((s, e) => s + (Number(e.amount) || 0), 0) || null;
      });
      const color = CHART_COLORS[ci % CHART_COLORS.length];
      return { label: cat, data, backgroundColor: color, borderWidth: 0, borderRadius: 2 };
    });

    if (lineInst) lineInst.destroy();
    if (!barCats.length) {
      // No manual expense data — leave canvas blank
      lineInst = null;
    } else {
      lineInst = new Chart(document.getElementById('lineChart').getContext('2d'), {
        type: 'bar',
        data: { labels: barLabels, datasets: barDatasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              title: (items) => { const d = Number(items[0].label); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); },
              label: ctx => ctx.parsed.y ? ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` : null
            } }
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: tickColor,
                font: { size: 10 },
                autoSkip: false,
                maxRotation: 0,
                callback: (val) => {
                  const d = Number(val) + 1;
                  if (d !== 1 && d % 5 !== 0) return null;
                  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                }
              },
              grid: { color: gridColor }
            },
            y: {
              stacked: true,
              ticks: { color: tickColor, font: { size: 10 }, callback: v => fmt(v) },
              grid: { color: gridColor },
              beginAtZero: true
            }
          }
        }
      });
    }

  }

  // ── Budget List Popup ────────────────────────────────────────────────────────
  function renderBudgetListPopup() {
    const month = getMonth(activeMonth);
    const tbody = document.querySelector('#budgetListTable tbody');
    tbody.innerHTML = '';
    if (!month.budget.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="b-empty-row">No budget entries yet.</td></tr>';
      return;
    }
    month.budget.forEach(entry => {
      const tr = document.createElement('tr');
      const fixedBadge = entry.fixed ? '<span class="b-fixed-badge">Fixed</span>' : '';
      tr.innerHTML = `
        <td><span class="b-cat-chip">${esc(entry.category)}</span> ${fixedBadge}</td>
        <td class="b-muted-cell">${esc(entry.description || '')}</td>
        <td class="b-amount-cell">${fmt(entry.amount)}</td>
        <td class="b-actions-cell">
          <button class="b-btn-icon b-edit-budget" data-id="${entry.id}" title="Edit">✎</button>
          <button class="b-btn-icon b-del-budget" data-id="${entry.id}" title="Delete">✕</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function openBudgetListPopup() {
    renderBudgetListPopup();
    document.getElementById('budgetListModal').classList.add('active');
  }

  // ── Expense List Popup ────────────────────────────────────────────────────────
  function renderExpenseListPopup() {
    const month = getMonth(activeMonth);
    // Render sortable thead
    const thead = document.querySelector('#expenseListTable thead tr');
    if (thead) {
      const sortIndicator = (key) => {
        if (expenseListSortKey !== key) return '<span class="b-sort-icon">⇅</span>';
        return expenseListSortDir === 'asc' ? '<span class="b-sort-icon b-sort-active">↑</span>' : '<span class="b-sort-icon b-sort-active">↓</span>';
      };
      thead.innerHTML = `
        <th class="b-sortable-th" data-sort="date">Date ${sortIndicator('date')}</th>
        <th class="b-sortable-th" data-sort="category">Category ${sortIndicator('category')}</th>
        <th>Description</th><th>Amount</th><th></th>`;
    }
    const tbody = document.querySelector('#expenseListTable tbody');
    tbody.innerHTML = '';
    const fixedEntries = month.budget.filter(e => e.fixed);
    const manualExpenses = month.expenses.filter(e => !e.fixedId);
    const hasAny = fixedEntries.length || manualExpenses.length;
    if (!hasAny) {
      tbody.innerHTML = '<tr><td colspan="5" class="b-empty-row">No expenses recorded yet.</td></tr>';
      return;
    }
    // Apply collapsed state
    const expTable = document.getElementById('expenseListTable');
    expTable.classList.toggle('b-fixed-hidden', fixedSectionCollapsed);
    // Fixed entries section header
    if (fixedEntries.length) {
      const hdr = document.createElement('tr');
      hdr.className = 'b-section-header-row';
      hdr.innerHTML = `<td colspan="5"><button class="b-toggle-fixed">${fixedSectionCollapsed ? '\u25b8' : '\u25be'} Fixed entries (${fixedEntries.length})</button></td>`;
      tbody.appendChild(hdr);
    }
    // Auto-rows from fixed budget entries (editable)
    fixedEntries.forEach(entry => {
      const override = month.expenses.find(e => e.fixedId === entry.id);
      const displayAmt = override ? override.amount : entry.amount;
      const displayDesc = override ? (override.description || '') : (entry.description || '');
      const tr = document.createElement('tr');
      tr.className = 'b-fixed-row';
      tr.innerHTML = `
        <td></td>
        <td><span class="b-cat-chip">${esc(entry.category)}</span> <span class="b-fixed-badge">Fixed</span>${override ? ' <span class="b-override-badge" title="Amount overridden">Edited</span>' : ''}</td>
        <td class="b-muted-cell">${esc(displayDesc)}</td>
        <td class="b-amount-cell">${fmt(displayAmt)}</td>
        <td class="b-actions-cell">
          <button class="b-btn-icon b-edit-fixed" data-id="${entry.id}" title="Edit actual amount">✎</button>
          <button class="b-btn-icon b-del-fixed" data-id="${entry.id}" title="${override ? 'Reset to budget amount' : 'Delete'}">✕</button>
        </td>`;
      tbody.appendChild(tr);
    });
    // Manually entered expenses — sort by active column/direction
    manualExpenses.slice().sort((a, b) => {
      let valA, valB;
      if (expenseListSortKey === 'category') {
        valA = (a.category || '').toLowerCase();
        valB = (b.category || '').toLowerCase();
      } else {
        valA = a.date || '';
        valB = b.date || '';
      }
      if (valA < valB) return expenseListSortDir === 'asc' ? -1 : 1;
      if (valA > valB) return expenseListSortDir === 'asc' ? 1 : -1;
      return 0;
    }).forEach(entry => {
      const dateLabel = entry.date ? new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      const catCell = entry.subCategory
        ? `<span class="b-cat-chip">${esc(entry.category)}</span> <span class="b-subcat-chip">› ${esc(entry.subCategory)}</span>`
        : `<span class="b-cat-chip">${esc(entry.category)}</span>`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="b-muted-cell" style="white-space:nowrap">${dateLabel}</td>
        <td>${catCell}</td>
        <td class="b-muted-cell">${esc(entry.description || '')}</td>
        <td class="b-amount-cell">${fmt(entry.amount)}</td>
        <td class="b-actions-cell">
          <button class="b-btn-icon b-edit-expense" data-id="${entry.id}" title="Edit">✎</button>
          <button class="b-btn-icon b-del-expense" data-id="${entry.id}" title="Delete">✕</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function openExpenseListPopup() {
    renderExpenseListPopup();
    document.getElementById('expenseListModal').classList.add('active');
  }

  // ── Category dropdown populate ───────────────────────────────────────────────
  function populateCatDropdown(selectId, selectedVal) {
    const sel = document.getElementById(selectId);
    const prev = selectedVal || sel.value;
    sel.innerHTML = '<option value="">-- Select or type new --</option>';
    db.categories.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      if (c.name === prev) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // ── Register new category if unknown ────────────────────────────────────────
  function ensureCategory(name) {
    if (!name) return;
    if (!db.categories.find(c => c.name === name)) {
      db.categories.push({ id: uid(), name });
    }
  }

  // ── Escape html ──────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── Read category from combobox (select + freetext) ─────────────────────────
  function readCatField(selectId, textId) {
    const sel = document.getElementById(selectId).value.trim();
    const txt = document.getElementById(textId).value.trim();
    return txt || sel;
  }

  // ── Render full page ─────────────────────────────────────────────────────────
  function render() {
    renderSummaryCards();
    renderCharts();
    renderCategoryProgress();
    renderBudgetCatTags();
    renderExpenseCatTags();
    renderHomeWidgets();
  }

  // ── Carry forward from previous month ───────────────────────────────────────
  async function carryForward() {
    const prev = prevMonth(activeMonth);
    const prevData = getMonth(prev);
    if (!prevData.budget.length) { toast('No budget entries in ' + monthLabel(prev), 'error'); return; }
    const cur = getMonth(activeMonth);
    const existing = new Set(cur.budget.map(e => e.category + '|' + (e.description || '')));
    let added = 0;
    prevData.budget.forEach(e => {
      const key = e.category + '|' + (e.description || '');
      if (!existing.has(key)) {
        cur.budget.push({ id: uid(), category: e.category, description: e.description || '', amount: e.amount, fixed: !!e.fixed });
        existing.add(key);
        added++;
      }
    });
    await save();
    render();
    toast(added ? `Carried ${added} entries from ${monthLabel(prev)}` : 'All entries already present');
  }

  // ── Month navigation ─────────────────────────────────────────────────────────
  function setMonth(ym) {
    activeMonth = ym;
    render();
  }

  // ── Panel toggle ─────────────────────────────────────────────────────────────
  function togglePanel(panelId, btnId) {
    const panel = document.getElementById(panelId);
    const btn = document.getElementById(btnId);
    const collapsed = panel.classList.toggle('b-panel-collapsed');
    btn.textContent = collapsed ? '+' : '−';
  }

  // ── Budget form ──────────────────────────────────────────────────────────────
  let editingBudgetId = null;
  let selectedBudgetCat = '';

  function renderBudgetCatTags(preselect) {
    if (preselect !== undefined) selectedBudgetCat = preselect || '';
    const container = document.getElementById('budgetCatTags');
    if (!container) return;
    container.innerHTML = '';
    db.categories.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'b-cat-tag' + (c.name === selectedBudgetCat ? ' selected' : '');
      btn.textContent = c.name;
      btn.addEventListener('click', () => {
        selectedBudgetCat = selectedBudgetCat === c.name ? '' : c.name;
        document.getElementById('budgetCatText').value = '';
        renderBudgetCatTags();
      });
      container.appendChild(btn);
    });
  }

  function openBudgetForm(entry) {
    editingBudgetId = entry ? entry.id : null;
    document.getElementById('budgetFormTitle').textContent = entry ? 'Edit Budget Entry' : 'Add Budget Entry';
    renderBudgetCatTags(entry ? entry.category : '');
    document.getElementById('budgetCatText').value = '';
    document.getElementById('budgetDesc').value = entry ? (entry.description || '') : '';
    document.getElementById('budgetAmt').value = entry ? entry.amount : '';
    document.getElementById('budgetFixed').checked = entry ? !!entry.fixed : false;
    document.getElementById('budgetForm').classList.remove('b-hidden');
    document.getElementById('budgetAmt').focus();
  }
  function closeBudgetForm() {
    editingBudgetId = null;
    selectedBudgetCat = '';
    document.getElementById('budgetForm').classList.add('b-hidden');
    document.getElementById('budgetCatText').value = '';
    document.getElementById('budgetAmt').value = '';
    document.getElementById('budgetDesc').value = '';
    document.getElementById('budgetFixed').checked = false;
  }
  async function saveBudgetEntry() {
    const textCat = document.getElementById('budgetCatText').value.trim();
    const cat = textCat || selectedBudgetCat;
    const desc = document.getElementById('budgetDesc').value.trim();
    const amt = parseFloat(document.getElementById('budgetAmt').value);
    const fixed = document.getElementById('budgetFixed').checked;
    if (!cat) { toast('Category is required', 'error'); return; }
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }
    ensureCategory(cat);
    const month = getMonth(activeMonth);
    if (editingBudgetId) {
      const entry = month.budget.find(e => e.id === editingBudgetId);
      if (entry) { entry.category = cat; entry.description = desc; entry.amount = amt; entry.fixed = fixed; }
    } else {
      month.budget.push({ id: uid(), category: cat, description: desc, amount: amt, fixed });
    }
    closeBudgetForm();
    await save();
    render();
    toast(editingBudgetId ? 'Budget entry updated' : 'Budget entry added');
  }

  // ── Category tag rendering for expense modal e ────────────────────────────────
  let selectedExpenseCat = '';

  function renderExpenseCatTags(preselect) {
    if (preselect !== undefined) selectedExpenseCat = preselect || '';
    const container = document.getElementById('expenseCatTags');
    if (!container) return;
    container.innerHTML = '';
    const month = getMonth(activeMonth);
    const fixedOnlyCats = new Set(
      db.categories.map(c => c.name).filter(name => {
        const entries = month.budget.filter(e => e.category === name);
        return entries.length > 0 && entries.every(e => e.fixed);
      })
    );
    db.categories.slice().sort((a, b) => a.name.localeCompare(b.name)).filter(c => !fixedOnlyCats.has(c.name)).forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'b-cat-tag' + (c.name === selectedExpenseCat ? ' selected' : '');
      btn.textContent = c.name;
      btn.addEventListener('click', () => {
        selectedExpenseCat = selectedExpenseCat === c.name ? '' : c.name;
        document.getElementById('expenseCatText').value = '';
        renderExpenseCatTags();
        renderExpenseSubCatTags();
      });
      container.appendChild(btn);
    });
  }

  const VACATION_CAT = 'Vacation';
  const VACATION_SUB_CATS = ['Coffee', 'Eat out', 'Grocery', 'Liquor', 'Misc', 'Shopping', 'Transport', 'Stay'];
  let selectedExpenseSubCat = '';

  function renderExpenseSubCatTags() {
    const row = document.getElementById('expenseSubCatRow');
    if (!row) return;
    const isVacation = selectedExpenseCat === VACATION_CAT;
    row.style.display = isVacation ? 'block' : 'none';
    if (!isVacation) { selectedExpenseSubCat = ''; return; }
    const container = document.getElementById('expenseSubCatTags');
    container.innerHTML = '';
    VACATION_SUB_CATS.forEach(name => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'b-cat-tag' + (name === selectedExpenseSubCat ? ' selected' : '');
        btn.textContent = name;
        btn.addEventListener('click', () => {
          selectedExpenseSubCat = selectedExpenseSubCat === name ? '' : name;
          renderExpenseSubCatTags();
        });
        container.appendChild(btn);
      });
  }

  // ── Quick-add Expense Modal ───────────────────────────────────────────────────
  let editingExpenseId = null;
  let editingFixedSourceId = null;
  let fixedSectionCollapsed = true;
  let expenseListSortKey = 'date';   // 'date' | 'category'
  let expenseListSortDir = 'desc';   // 'asc'  | 'desc'

  function openQuickExpenseModal(entry, fixedSourceId) {
    editingExpenseId = entry ? entry.id : null;
    editingFixedSourceId = fixedSourceId || null;
    renderExpenseCatTags(entry ? entry.category : '');
    selectedExpenseSubCat = entry ? (entry.subCategory || '') : '';
    renderExpenseSubCatTags();
    document.getElementById('expenseCatText').value = '';
    document.getElementById('expenseDesc').value = entry ? (entry.description || '') : '';
    document.getElementById('expenseAmt').value = entry ? entry.amount : '';
    document.getElementById('expenseDate').value = entry ? (entry.date || '') : '';
    document.getElementById('expenseDateBtn').classList.toggle('has-date', !!(entry && entry.date));
    document.getElementById('quickExpenseModal').classList.add('active');
    document.getElementById('expenseAmt').focus();
  }
  function closeQuickExpenseModal() {
    editingExpenseId = null;
    editingFixedSourceId = null;
    selectedExpenseCat = '';
    selectedExpenseSubCat = '';
    const subCatRow = document.getElementById('expenseSubCatRow');
    if (subCatRow) subCatRow.style.display = 'none';
    document.getElementById('quickExpenseModal').classList.remove('active');
    document.getElementById('expenseCatText').value = '';
    document.getElementById('expenseAmt').value = '';
    document.getElementById('expenseDesc').value = '';
    document.getElementById('expenseDate').value = '';
    document.getElementById('expenseDateBtn').classList.remove('has-date');
  }
  async function saveQuickExpense() {
    const textCat = document.getElementById('expenseCatText').value.trim();
    const cat = textCat || selectedExpenseCat;
    const desc = document.getElementById('expenseDesc').value.trim();
    const amt = parseFloat(document.getElementById('expenseAmt').value);
    const dateVal = document.getElementById('expenseDate').value || new Date().toISOString().slice(0, 10);
    if (!cat) { toast('Category is required', 'error'); return; }
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }
    ensureCategory(cat);
    const month = getMonth(activeMonth);
    const subCat = (cat === VACATION_CAT && selectedExpenseSubCat) ? selectedExpenseSubCat : undefined;
    if (editingExpenseId) {
      const entry = month.expenses.find(e => e.id === editingExpenseId);
      if (entry) { entry.category = cat; entry.description = desc; entry.amount = amt; entry.date = dateVal; entry.subCategory = subCat; }
    } else if (editingFixedSourceId) {
      month.expenses.push({ id: uid(), category: cat, description: desc, amount: amt, fixedId: editingFixedSourceId, date: dateVal, subCategory: subCat });
    } else {
      month.expenses.push({ id: uid(), category: cat, description: desc, amount: amt, date: dateVal, subCategory: subCat });
    }
    const wasEditing = editingExpenseId;
    closeQuickExpenseModal();
    await save();
    render();
    toast(wasEditing ? 'Expense updated' : 'Expense added');
  }

  // ── Wire up events ───────────────────────────────────────────────────────────
  function wireEvents() {
    // Month picker
    document.getElementById('monthPicker').addEventListener('change', e => setMonth(e.target.value));
    document.getElementById('prevMonthBtn').addEventListener('click', () => {
      setMonth(prevMonth(activeMonth));
      document.getElementById('monthPicker').value = activeMonth;
    });
    document.getElementById('nextMonthBtn').addEventListener('click', () => {
      const [y, m] = activeMonth.split('-').map(Number);
      const d = new Date(y, m, 1);
      const next = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      setMonth(next);
      document.getElementById('monthPicker').value = activeMonth;
    });

    // Summary cards open list popups
    document.getElementById('cardBudget').addEventListener('click', openBudgetListPopup);
    document.getElementById('cardExpense').addEventListener('click', openExpenseListPopup);

    // Carry forward
    document.getElementById('carryForwardBtn').addEventListener('click', async () => {
      const ok = await confirm('Copy all budget entries from previous month into this month? Duplicates will be skipped.');
      if (ok) carryForward();
    });

    // Budget panel
    document.getElementById('viewBudgetListBtn').addEventListener('click', openBudgetListPopup);
    document.getElementById('addBudgetBtn').addEventListener('click', () => openBudgetForm(null));
    document.getElementById('cancelBudgetForm').addEventListener('click', closeBudgetForm);
    document.getElementById('saveBudgetForm').addEventListener('click', saveBudgetEntry);

    // Budget list modal
    document.getElementById('closeBudgetListModal').addEventListener('click', () => document.getElementById('budgetListModal').classList.remove('active'));
    document.getElementById('budgetListModal').addEventListener('click', e => { if (e.target === document.getElementById('budgetListModal')) document.getElementById('budgetListModal').classList.remove('active'); });
    document.getElementById('budgetListTable').addEventListener('click', async e => {
      const editBtn = e.target.closest('.b-edit-budget');
      const delBtn = e.target.closest('.b-del-budget');
      if (editBtn) {
        const entry = getMonth(activeMonth).budget.find(x => x.id === editBtn.dataset.id);
        if (entry) { document.getElementById('budgetListModal').classList.remove('active'); openBudgetForm(entry); }
      }
      if (delBtn) {
        const ok = await confirm('Delete this budget entry?');
        if (!ok) return;
        const month = getMonth(activeMonth);
        month.budget = month.budget.filter(x => x.id !== delBtn.dataset.id);
        await save(); renderSummaryCards(); renderBudgetListPopup(); toast('Deleted');
      }
    });

    // FAB + quick expense modal
    document.getElementById('closeQuickExpenseModal').addEventListener('click', closeQuickExpenseModal);
    document.getElementById('cancelQuickExpense').addEventListener('click', closeQuickExpenseModal);
    document.getElementById('saveQuickExpense').addEventListener('click', saveQuickExpense);
    document.getElementById('quickExpenseModal').addEventListener('click', e => { if (e.target === document.getElementById('quickExpenseModal')) closeQuickExpenseModal(); });
    // Calendar icon opens date picker
    document.getElementById('expenseDateBtn').addEventListener('click', () => {
      const inp = document.getElementById('expenseDate');
      try { inp.showPicker(); } catch(e) { inp.focus(); }
    });
    document.getElementById('expenseDate').addEventListener('change', () => {
      document.getElementById('expenseDateBtn').classList.toggle('has-date', !!document.getElementById('expenseDate').value);
    });
    // Typing a new category in text box clears the tag selection
    document.getElementById('expenseCatText').addEventListener('input', () => {
      if (document.getElementById('expenseCatText').value.trim()) {
        selectedExpenseCat = '';
        renderExpenseCatTags();
      }
    });
    // Also re-render tags when modal opens for the first time (categories might not exist yet)
    document.getElementById('expenseCatText').addEventListener('focus', renderExpenseCatTags);
    // Save on Enter in amount field
    document.getElementById('expenseAmt').addEventListener('keydown', e => { if (e.key === 'Enter') saveQuickExpense(); });

    // Expense panel list view
    document.getElementById('viewExpenseListBtn').addEventListener('click', openExpenseListPopup);
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    if (addExpenseBtn) addExpenseBtn.addEventListener('click', () => openQuickExpenseModal(null));

    // Expense list modal
    document.getElementById('closeExpenseListModal').addEventListener('click', () => document.getElementById('expenseListModal').classList.remove('active'));
    document.getElementById('expenseListModal').addEventListener('click', e => { if (e.target === document.getElementById('expenseListModal')) document.getElementById('expenseListModal').classList.remove('active'); });
    document.getElementById('expenseListTable').addEventListener('click', async e => {
      // Sort header click
      const sortTh = e.target.closest('th[data-sort]');
      if (sortTh) {
        const key = sortTh.dataset.sort;
        if (expenseListSortKey === key) {
          expenseListSortDir = expenseListSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          expenseListSortKey = key;
          expenseListSortDir = key === 'date' ? 'desc' : 'asc';
        }
        renderExpenseListPopup();
        return;
      }
      const toggleFixed = e.target.closest('.b-toggle-fixed');
      const editBtn = e.target.closest('.b-edit-expense');
      const delBtn = e.target.closest('.b-del-expense');
      const editFixed = e.target.closest('.b-edit-fixed');
      const delFixed = e.target.closest('.b-del-fixed');
      if (toggleFixed) {
        fixedSectionCollapsed = !fixedSectionCollapsed;
        document.getElementById('expenseListTable').classList.toggle('b-fixed-hidden', fixedSectionCollapsed);
        toggleFixed.textContent = (fixedSectionCollapsed ? '\u25b8' : '\u25be') + ` Fixed entries (${getMonth(activeMonth).budget.filter(x => x.fixed).length})`;
        return;
      }
      if (editFixed) {
        const budgetEntry = getMonth(activeMonth).budget.find(x => x.id === editFixed.dataset.id);
        if (budgetEntry) {
          document.getElementById('expenseListModal').classList.remove('active');
          const override = getMonth(activeMonth).expenses.find(e => e.fixedId === budgetEntry.id);
          if (override) {
            openQuickExpenseModal(override); // edit the existing override
          } else {
            openQuickExpenseModal({ ...budgetEntry, id: null }, budgetEntry.id); // pre-fill from budget, create override on save
          }
        }
      }
      if (delFixed) {
        const budgetEntry = getMonth(activeMonth).budget.find(x => x.id === delFixed.dataset.id);
        const override = budgetEntry && getMonth(activeMonth).expenses.find(e => e.fixedId === budgetEntry.id);
        if (override) {
          const ok = await confirm('Reset to budget amount? The override will be removed.');
          if (!ok) return;
          const month = getMonth(activeMonth);
          month.expenses = month.expenses.filter(x => x.id !== override.id);
          await save(); render(); renderExpenseListPopup(); toast('Reset to budget amount');
        } else {
          const ok = await confirm('Delete this fixed expense? It will also be removed from your estimated budget.');
          if (!ok) return;
          const month = getMonth(activeMonth);
          month.budget = month.budget.filter(x => x.id !== delFixed.dataset.id);
          await save(); render(); renderExpenseListPopup(); toast('Deleted');
        }
      }
      if (editBtn) {
        const entry = getMonth(activeMonth).expenses.find(x => x.id === editBtn.dataset.id);
        if (entry) { document.getElementById('expenseListModal').classList.remove('active'); openQuickExpenseModal(entry); }
      }
      if (delBtn) {
        const ok = await confirm('Delete this expense?');
        if (!ok) return;
        const month = getMonth(activeMonth);
        month.expenses = month.expenses.filter(x => x.id !== delBtn.dataset.id);
        await save(); renderSummaryCards(); renderExpenseListPopup(); toast('Deleted');
      }
    });

    // Typing a new budget category clears tag selection
    document.getElementById('budgetCatText').addEventListener('input', () => {
      if (document.getElementById('budgetCatText').value.trim()) {
        selectedBudgetCat = '';
        renderBudgetCatTags();
      }
    });
    // Typing a new category clears tag selection
    document.getElementById('expenseCatText').addEventListener('input', () => {
      if (document.getElementById('expenseCatText').value.trim()) {
        selectedExpenseCat = '';
        renderExpenseCatTags();
      }
    });
    // Save on Enter in amount field
    document.getElementById('expenseAmt').addEventListener('keydown', e => { if (e.key === 'Enter') saveQuickExpense(); });

    // Include Rent / Car Loan / India checkboxes re-render donut
    const includeRentChk = document.getElementById('includeRentChk');
    if (includeRentChk) includeRentChk.addEventListener('change', renderCharts);
    const includeCarLoanChk = document.getElementById('includeCarLoanChk');
    if (includeCarLoanChk) includeCarLoanChk.addEventListener('change', renderCharts);
    const includeIndiaChk = document.getElementById('includeIndiaChk');
    if (includeIndiaChk) includeIndiaChk.addEventListener('change', renderCharts);

    // Carousel dot navigation
    document.querySelectorAll('.b-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const targetId = dot.dataset.slide;
        document.querySelectorAll('.b-carousel-slide').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.b-dot').forEach(d => d.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
        dot.classList.add('active');
      });
    });

    // Category transactions modal
    document.getElementById('closeCatTxnModal').addEventListener('click', () => document.getElementById('catTxnModal').classList.remove('active'));
    document.getElementById('catTxnModal').addEventListener('click', e => { if (e.target === document.getElementById('catTxnModal')) document.getElementById('catTxnModal').classList.remove('active'); });

    // Settings modal
    document.getElementById('budgetSettingsBtn').addEventListener('click', () => document.getElementById('budgetSettingsModal').classList.add('active'));
    document.getElementById('closeBudgetSettings').addEventListener('click', () => document.getElementById('budgetSettingsModal').classList.remove('active'));
    document.getElementById('budgetSettingsModal').addEventListener('click', e => { if (e.target === document.getElementById('budgetSettingsModal')) document.getElementById('budgetSettingsModal').classList.remove('active'); });

    // Delete all budget data
    document.getElementById('budgetDeleteAll').addEventListener('click', async () => {
      const ok = await confirm('Delete ALL budget data? This cannot be undone.');
      if (!ok) return;
      db = { categories: [], months: {} };
      await save();
      render();
      document.getElementById('budgetSettingsModal').classList.remove('active');
      toast('All budget data deleted');
    });

    // Export JSON
    document.getElementById('budgetExportJson').addEventListener('click', () => {
      const json = JSON.stringify(db, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `budget_data_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    // Import JSON
    document.getElementById('budgetImportJson').addEventListener('click', () => document.getElementById('budgetJsonFileInput').click());
    document.getElementById('budgetJsonFileInput').addEventListener('change', async function () {
      const file = this.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid format');
        const ok = await confirm('Replace all current budget data with the imported file? This cannot be undone.');
        if (!ok) { this.value = ''; return; }
        db = parsed;
        if (!db.categories) db.categories = [];
        if (!db.months) db.months = {};
        await save();
        render();
        document.getElementById('budgetSettingsModal').classList.remove('active');
        toast('Budget data imported successfully');
      } catch (e) {
        toast('Import failed: ' + e.message, 'error');
      }
      this.value = '';
    });

    // Re-render charts whenever the theme is toggled (works in both SPA and standalone mode)
    new MutationObserver(renderCharts).observe(
      document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }
    );
    // Standalone mode only: wire up the budgetThemeToggle button if it exists
    const themeBtn = document.getElementById('budgetThemeToggle');
    if (themeBtn) {
      themeBtn.textContent = localStorage.getItem('propfolio-theme') === 'dark' ? '☀️' : '🌙';
      themeBtn.addEventListener('click', () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (dark) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('propfolio-theme', dark ? 'light' : 'dark');
        themeBtn.textContent = dark ? '🌙' : '☀️';
      });
    }
  }

  // ── Home Dashboard — Budget Widgets ──────────────────────────────────────────
  let homeDonutInst = null;
  let homeActiveMonth = currentMonth();

  function renderHomeWidgets() {
    const donutCanvas = document.getElementById('homeDonutChart');
    const budgetProgressEl = document.getElementById('homeBudgetProgress');
    const momCard = document.getElementById('homeMomCard');
    const monthLabelEl = document.getElementById('homeMonthLabel');
    if (!donutCanvas && !budgetProgressEl) return;

    // Update month label
    if (monthLabelEl) monthLabelEl.textContent = monthLabel(homeActiveMonth);

    const breakdown = catBreakdown(homeActiveMonth);
    const includeRent    = document.getElementById('homeIncludeRentChk')    ? document.getElementById('homeIncludeRentChk').checked    : true;
    const includeCarLoan = document.getElementById('homeIncludeCarLoanChk') ? document.getElementById('homeIncludeCarLoanChk').checked : true;
    const includeIndia   = document.getElementById('homeIncludeIndiaChk')   ? document.getElementById('homeIncludeIndiaChk').checked   : true;
    const allCats = Object.keys(breakdown).sort();
    const donutCats = allCats.filter(c => {
      const cl = c.toLowerCase();
      if (!includeRent    && cl === 'rent')     return false;
      if (!includeCarLoan && cl === 'car loan') return false;
      if (!includeIndia   && cl === 'india')    return false;
      return true;
    });

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tickColor = isDark ? '#9ca3af' : '#78909c';

    // Bubble chart — one bubble per category, Y=actual spend, R=proportional to actual
    if (donutCanvas) {
      if (homeDonutInst) homeDonutInst.destroy();
      if (donutCats.length) {
        const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
        const maxActual = Math.max(...donutCats.map(c => breakdown[c].actual), 1);
        const hex2rgba = (hex, a) => `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
        const datasets = donutCats.map((cat, i) => {
          const actual = breakdown[cat].actual;
          const color  = CHART_COLORS[allCats.indexOf(cat) % CHART_COLORS.length];
          const r = Math.max(6, Math.round(Math.sqrt(actual / maxActual) * 30));
          return {
            label: cat,
            data: [{ x: i + 1, y: actual, r }],
            backgroundColor: hex2rgba(color, 0.65),
            borderColor: color,
            borderWidth: 1.5
          };
        });
        homeDonutInst = new Chart(donutCanvas.getContext('2d'), {
          type: 'bubble',
          data: { datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw.y)}`
                }
              }
            },
            scales: {
              x: {
                min: 0,
                max: donutCats.length + 1,
                grid: { display: false },
                ticks: { display: false }
              },
              y: {
                title: { display: false },
                ticks: { color: tickColor, font: { size: 10 }, callback: v => v >= 1000 ? '$'+(v/1000).toFixed(1)+'k' : '$'+v },
                grid: { color: gridColor },
                min: 0
              }
            }
          }
        });
      }
    }

    // Month-on-month comparison card
    if (momCard) {
      const thisSpent = totalExpenses(homeActiveMonth);
      const prev = prevMonth(homeActiveMonth);
      const prevSpent = totalExpenses(prev);
      if (thisSpent > 0 || prevSpent > 0) {
        const diff = thisSpent - prevSpent;
        const diffPct = prevSpent > 0 ? ((diff / prevSpent) * 100) : null;
        const up = diff > 0;
        const arrow = diff === 0 ? '→' : (up ? '↑' : '↓');
        const color = diff === 0 ? '#78909c' : (up ? '#e57373' : '#6b9080');
        const pctLabel = diffPct !== null ? ` (${up ? '+' : ''}${diffPct.toFixed(1)}%)` : '';
        momCard.innerHTML = `
          <div class="home-mom-row">
            <div class="home-mom-col">
              <div class="home-mom-label">${monthLabel(prev)}</div>
              <div class="home-mom-amt">${fmt(prevSpent)}</div>
            </div>
            <div class="home-mom-arrow" style="color:${color}">${arrow}<span class="home-mom-diff">${fmt(Math.abs(diff))}${pctLabel}</span></div>
            <div class="home-mom-col">
              <div class="home-mom-label">${monthLabel(homeActiveMonth)}</div>
              <div class="home-mom-amt">${fmt(thisSpent)}</div>
            </div>
          </div>`;
      } else {
        momCard.innerHTML = '';
      }
    }

    // Budget vs Actual progress bar
    if (budgetProgressEl) {
      const budget = totalBudget(homeActiveMonth);
      const spent  = totalExpenses(homeActiveMonth);
      if (!budget) { budgetProgressEl.innerHTML = '<span class="home-dash-empty">No budget set for this month.</span>'; return; }
      const pct  = Math.min((spent / budget) * 100, 100);
      const over = spent > budget;
      budgetProgressEl.innerHTML = `
        <div class="loan-progress-header">
          <span style="font-size:12px;color:#78909c">Actual <strong style="color:${over ? '#e57373' : '#6b9080'}">${fmt(spent)}</strong> of <strong>${fmt(budget)}</strong> budgeted</span>
          <span class="loan-progress-pct" style="color:${over ? '#e57373' : '#6b9080'}">${pct.toFixed(1)}%</span>
        </div>
        <div class="loan-progress-track">
          <div class="loan-progress-fill${over ? ' over' : ''}" style="width:${pct.toFixed(2)}%;background:${over ? '#e57373' : ''}"></div>
        </div>
        <div class="loan-progress-labels">
          <span style="color:${over ? '#e57373' : '#6b9080'};font-weight:600">${fmt(spent)} spent</span>
          <span style="color:#90a4ae;font-size:11px">${over ? fmt(spent - budget) + ' over' : fmt(budget - spent) + ' remaining'}</span>
        </div>`;
    }
  }

  function wireHomeMonthNav() {
    const prevBtn = document.getElementById('homePrevMonthBtn');
    const nextBtn = document.getElementById('homeNextMonthBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      homeActiveMonth = prevMonth(homeActiveMonth);
      renderHomeWidgets();
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      const [y, m] = homeActiveMonth.split('-').map(Number);
      const d = new Date(y, m, 1);
      homeActiveMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      renderHomeWidgets();
    });
    ['homeIncludeRentChk', 'homeIncludeCarLoanChk', 'homeIncludeIndiaChk'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderHomeWidgets);
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('monthPicker').value = activeMonth;
    await load();
    wireEvents();
    wireHomeMonthNav();
    wireAnalytics();
    render();
    renderHomeWidgets();
    renderAnalytics();
  });

  // Expose for SPA: home FAB opens the quick-add expense modal in the budget tab
  window.budgetOpenExpense = openQuickExpenseModal;
  // Expose for re-render when switching to home tab
  window.budgetRenderHomeWidgets = renderHomeWidgets;

  // ── Analytics Page ───────────────────────────────────────────────────────────
  let analyticsMonth   = currentMonth();
  let analyticsBaseline = 1; // 1 = prev month, 3 = 3-month avg, 6 = 6-month avg

  function nextMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // Returns averaged catBreakdown over the n months prior to ym,
  // only counting months that actually had spend for each category.
  function getBaselineBreakdown(ym, n) {
    if (n === 1) return catBreakdown(prevMonth(ym));
    const totals = {};  // { cat: { sum, count } }
    let m = ym;
    for (let i = 0; i < n; i++) {
      m = prevMonth(m);
      Object.entries(catBreakdown(m)).forEach(([cat, { actual }]) => {
        if (actual > 0) {
          if (!totals[cat]) totals[cat] = { sum: 0, count: 0 };
          totals[cat].sum   += actual;
          totals[cat].count += 1;
        }
      });
    }
    const avg = {};
    Object.entries(totals).forEach(([cat, { sum, count }]) => {
      avg[cat] = { actual: sum / count, budgeted: 0 };
    });
    return avg;
  }

  // ── Sparkline helper (inline SVG, no Chart.js) ─────────────────────────────
  function sparklineSVG(values, color) {
    const W = 52, H = 20, pad = 1;
    const max = Math.max(...values, 1);
    const bw  = (W - pad * (values.length - 1)) / values.length;
    const bars = values.map((v, i) => {
      const bh = Math.max(2, (v / max) * (H - 2));
      const x  = i * (bw + pad);
      const y  = H - bh;
      const op = v > 0 ? 1 : 0.18;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="${color}" opacity="${op}"/>`;
    }).join('');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">${bars}</svg>`;
  }

  // ── Category share donut ─────────────────────────────────────────────────────
  function renderShareDonut(cats, cur) {
    const el = document.getElementById('anDonutSection');
    if (!el) return;
    const PALETTE = ['#3b82f6','#f59e0b','#10b981','#f87171','#a78bfa','#34d399','#fb923c','#e879f9','#38bdf8','#84cc16'];
    const data  = cats.map(c => (cur[c] || {}).actual || 0);
    const total = data.reduce((s, v) => s + v, 0);
    if (!total) { el.style.display = 'none'; return; }
    el.style.display = '';

    // Sort items by value descending, keep original palette index for color
    const items = cats.map((cat, i) => ({
      cat, val: data[i], pct: Math.round(data[i] / total * 100), color: PALETTE[i % PALETTE.length]
    })).sort((a, b) => b.val - a.val);

    const W = 320, H = 112, GAP = 2;

    // Binary-split treemap layout (recursive)
    function layout(its, x, y, w, h) {
      if (!its.length) return [];
      if (its.length === 1) return [Object.assign({}, its[0], {rx:x, ry:y, rw:w, rh:h})];
      const tot = its.reduce((s, i) => s + i.val, 0);
      let sum = 0, split = 0;
      for (let i = 0; i < its.length; i++) {
        sum += its[i].val;
        if (sum * 2 >= tot) { split = i + 1; break; }
      }
      if (split >= its.length) split = its.length - 1;
      if (split < 1) split = 1;
      const g1 = its.slice(0, split), g2 = its.slice(split);
      const s1 = g1.reduce((s, i) => s + i.val, 0);
      if (w >= h) {
        const w1 = Math.max(1, Math.round(w * s1 / tot) - GAP);
        const x2 = x + w1 + GAP;
        return layout(g1, x, y, w1, h).concat(layout(g2, x2, y, Math.max(1, w - w1 - GAP), h));
      } else {
        const h1 = Math.max(1, Math.round(h * s1 / tot) - GAP);
        const y2 = y + h1 + GAP;
        return layout(g1, x, y, w, h1).concat(layout(g2, x, y2, w, Math.max(1, h - h1 - GAP)));
      }
    }

    const rects = layout(items, 0, 0, W, H);
    const svgContent = rects.map(r => {
      const showName = r.rw > 38 && r.rh > 22;
      const showPct  = r.rw > 26 && r.rh > 12;
      const label    = r.cat.length > 11 ? r.cat.slice(0, 10) + '\u2026' : r.cat;
      const tipAttr  = `data-tip="${esc(r.cat + ' \u00b7 ' + fmt(r.val) + ' \u00b7 ' + r.pct + '%')}"`;
      return `<g>
        <rect x="${r.rx}" y="${r.ry}" width="${r.rw}" height="${r.rh}" rx="4" fill="${r.color}" ${tipAttr} style="cursor:default"/>
        ${showName ? `<text x="${r.rx + 5}" y="${r.ry + 13}" font-size="9" fill="rgba(255,255,255,0.9)" font-weight="600" font-family="system-ui,sans-serif" pointer-events="none">${esc(label)}</text>` : ''}
        ${showPct  ? `<text x="${r.rx + 5}" y="${r.ry + r.rh - 5}" font-size="10" fill="white" font-weight="700" font-family="system-ui,sans-serif" pointer-events="none">${r.pct}%</text>` : ''}
      </g>`;
    }).join('');

    el.innerHTML = `<svg class="an-treemap-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svgContent}</svg>`;

    // Tooltip
    let tip = document.getElementById('anTreemapTip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'anTreemapTip';
      tip.className = 'an-treemap-tip';
      document.body.appendChild(tip);
    }
    const svg = el.querySelector('.an-treemap-svg');
    function _tipShow(e) {
      const rect = e.target.closest('rect[data-tip]');
      if (!rect) { tip.style.display = 'none'; return; }
      tip.textContent = rect.dataset.tip;
      tip.style.display = 'block';
      _tipMove(e);
    }
    function _tipMove(e) {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const vw = window.innerWidth;
      let left = cx + 12;
      if (left + 150 > vw) left = cx - 155;
      tip.style.left = left + 'px';
      tip.style.top  = (cy - 38) + 'px';
    }
    svg.addEventListener('mousemove',  _tipShow);
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    svg.addEventListener('touchstart', e => {
      const rect = e.target.closest('rect[data-tip]');
      if (rect) { _tipShow(e); setTimeout(() => { tip.style.display = 'none'; }, 2000); }
    }, { passive: true });
  }

  // Returns Set of fixed-only category names for a given month string
  function getFixedOnlyCats(ym) {
    const monthData = getMonth(ym);
    return new Set(
      db.categories.map(c => c.name).filter(name => {
        const entries = monthData.budget.filter(e => e.category === name);
        return entries.length > 0 && entries.every(e => e.fixed);
      })
    );
  }

  function renderTotalTrend(fixedOnlyCats) {
    const canvas = document.getElementById('anTrendCanvas');
    if (!canvas) return;
    // Build last 6 months ending at analyticsMonth
    const months = [];
    let m = analyticsMonth;
    for (let i = 0; i < 6; i++) { months.unshift(m); m = prevMonth(m); }
    const totals = months.map(mo => {
      const bd = catBreakdown(mo);
      return Object.entries(bd)
        .filter(([cat]) => !fixedOnlyCats.has(cat))
        .reduce((sum, [, { actual }]) => sum + actual, 0);
    });
    const labels = months.map(mo => monthLabel(mo).split(' ')[0]);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bgColors = months.map(mo =>
      mo === analyticsMonth ? (isDark ? '#60a5fa' : '#3b82f6') : (isDark ? '#374151' : '#e5e7eb')
    );
    if (window._anTrendChart) { window._anTrendChart.destroy(); window._anTrendChart = null; }
    window._anTrendChart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data: totals, backgroundColor: bgColors, borderRadius: 5, borderSkipped: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: isDark ? '#9ca3af' : '#6b7280', font: { size: 11 } } },
          y: { display: false }
        }
      }
    });
  }

  function renderFixedCosts(baseline, baseLbl) {
    const el       = document.getElementById('anFixedSection');
    const splitEl  = document.getElementById('anSplitBarSection');
    if (!el) return;
    const fixedCats = getFixedOnlyCats(analyticsMonth);
    if (!fixedCats.size) { el.style.display = 'none'; if (splitEl) splitEl.style.display = 'none'; return; }
    const cur = catBreakdown(analyticsMonth);

    // All fixed rows with data
    const allRows = [...fixedCats]
      .map(cat => ({ cat, curAmt: (cur[cat] || {}).actual || 0, bAmt: (baseline[cat] || {}).actual || 0 }))
      .filter(r => r.curAmt > 0)
      .sort((a, b) => b.curAmt - a.curAmt);
    if (!allRows.length) { el.style.display = 'none'; if (splitEl) splitEl.style.display = 'none'; return; }

    const fixedTotal = allRows.reduce((s, r) => s + r.curAmt, 0);
    const bFixedTotal = allRows.reduce((s, r) => s + r.bAmt, 0);
    const fixedTotalPct = bFixedTotal > 0 ? ((fixedTotal - bFixedTotal) / bFixedTotal) * 100 : null;

    // Only rows that changed (≥1% difference)
    const changedRows = allRows.filter(r => {
      if (!r.bAmt) return true; // new
      return Math.abs(((r.curAmt - r.bAmt) / r.bAmt) * 100) >= 1;
    });

    // ── Fixed section (tappable) ─────────────────────────────────────────────
    el.style.display = '';
    const totalBadge = fixedTotalPct !== null
      ? `<span class="an-badge ${fixedTotalPct > 0 ? 'an-badge-up' : 'an-badge-down'}">${fixedTotalPct > 0 ? '▲' : '▼'} ${Math.abs(fixedTotalPct).toFixed(0)}%</span>`
      : '';
    el.innerHTML = `
      <div class="an-fixed-header" id="anFixedTapTarget" style="cursor:pointer">
        <span class="an-fixed-title">🔒 Fixed Costs <span class="an-fixed-tap-hint">(tap for details)</span></span>
        <span class="an-fixed-total">${fmt(fixedTotal)} ${totalBadge}</span>
      </div>
      ${ changedRows.length ? `
      <div class="an-fixed-list">
        ${changedRows.map(r => {
          let badge = '';
          if (r.bAmt > 0) {
            const pct = ((r.curAmt - r.bAmt) / r.bAmt) * 100;
            badge = `<span class="an-badge ${pct > 0 ? 'an-badge-up' : 'an-badge-down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</span>`;
          } else {
            badge = `<span class="an-badge an-badge-new">New</span>`;
          }
          return `<div class="an-fixed-row"><span class="an-fixed-cat">${esc(r.cat)}</span><span class="an-fixed-amt">${fmt(r.curAmt)}</span>${badge}</div>`;
        }).join('')}
      </div>` : '<div class="an-fixed-nochange">No changes vs ' + baseLbl + '</div>' }`;

    // tap → modal
    document.getElementById('anFixedTapTarget').addEventListener('click', () => {
      const modal     = document.getElementById('anFixedModal');
      const monthSpan = document.getElementById('anFixedModalMonth');
      const body      = document.getElementById('anFixedModalBody');
      monthSpan.textContent = monthLabel(analyticsMonth);
      body.innerHTML = `<table class="an-fixed-modal-table">
        <thead><tr><th>Category</th><th>Amount</th><th>vs ${baseLbl}</th></tr></thead>
        <tbody>${allRows.map(r => {
          let cell = '—';
          if (r.bAmt > 0) {
            const pct = ((r.curAmt - r.bAmt) / r.bAmt) * 100;
            cell = `<span class="an-badge ${pct > 0 ? 'an-badge-up' : 'an-badge-down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</span><br><small>${fmt(r.bAmt)}</small>`;
          } else { cell = `<span class="an-badge an-badge-new">New</span>`; }
          return `<tr><td>${esc(r.cat)}</td><td><strong>${fmt(r.curAmt)}</strong></td><td>${cell}</td></tr>`;
        }).join('')}
        <tr class="an-fixed-modal-total"><td><strong>Total</strong></td><td><strong>${fmt(fixedTotal)}</strong></td><td>${totalBadge || '—'}</td></tr>
        </tbody></table>`;
      modal.style.display = 'flex';
    });

    // ── Split progress bar ───────────────────────────────────────────────────
    if (splitEl) {
      const varCats  = Object.keys(cur).filter(c => !fixedCats.has(c) && (cur[c] || {}).actual > 0);
      const varTotal = varCats.reduce((s, c) => s + ((cur[c] || {}).actual || 0), 0);
      const grandTotal = fixedTotal + varTotal;
      if (!grandTotal) { splitEl.style.display = 'none'; return; }
      const fixedPct = (fixedTotal / grandTotal * 100).toFixed(1);
      const varPct   = (100 - fixedPct).toFixed(1);

      const bVarTotal = varCats.reduce((s, c) => s + ((baseline[c] || {}).actual || 0), 0);
      const bGrand    = bFixedTotal + bVarTotal;
      const grandPct  = bGrand > 0 ? ((grandTotal - bGrand) / bGrand) * 100 : null;
      const grandBadge = grandPct !== null
        ? `<span class="an-badge ${grandPct > 0 ? 'an-badge-up' : 'an-badge-down'}">${grandPct > 0 ? '▲' : '▼'} ${Math.abs(grandPct).toFixed(0)}%</span>`
        : '';

      splitEl.style.display = '';
      splitEl.innerHTML = `
        <div class="an-splitbar-track">
          <div class="an-splitbar-fixed" style="width:${fixedPct}%" title="Fixed: ${fmt(fixedTotal)}"></div>
          <div class="an-splitbar-var"   style="width:${varPct}%"   title="Variable: ${fmt(varTotal)}"></div>
        </div>
        <div class="an-splitbar-footer">
          <span class="an-splitbar-label"><span class="an-splitbar-dot an-splitbar-dot-fixed"></span>Fixed ${fmt(fixedTotal)}</span>
          <span class="an-splitbar-label"><span class="an-splitbar-dot an-splitbar-dot-var"></span>Variable ${fmt(varTotal)}</span>
          <span class="an-splitbar-total">${fmt(grandTotal)} ${grandBadge}</span>
        </div>`;
    }
  }

  function renderMovers(cats, cur, baseline) {
    const el = document.getElementById('anMoversSection');
    if (!el) return;
    const movers = cats.map(cat => {
      const curAmt = (cur[cat] || {}).actual || 0;
      const bAmt   = (baseline[cat] || {}).actual || 0;
      if (!bAmt) return null;
      return { cat, pct: ((curAmt - bAmt) / bAmt) * 100 };
    }).filter(Boolean);
    const ups   = movers.filter(m => m.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 2);
    const downs = movers.filter(m => m.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 2);
    if (!ups.length && !downs.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    const itemHtml = (items, isUp) => items.map(m =>
      `<div class="an-mover-item ${isUp ? 'an-mover-up' : 'an-mover-down'}">
        <span class="an-mover-cat">${esc(m.cat)}</span>
        <span class="an-mover-pct">${isUp ? '▲' : '▼'} ${Math.abs(m.pct).toFixed(0)}%</span>
      </div>`
    ).join('');
    el.innerHTML = `
      <div class="an-movers-row">
        <div class="an-movers-col">
          <span class="an-movers-title">📈 Jumps</span>
          ${ups.length ? itemHtml(ups, true) : '<div class="an-mover-none">—</div>'}
        </div>
        <div class="an-movers-col">
          <span class="an-movers-title">📉 Drops</span>
          ${downs.length ? itemHtml(downs, false) : '<div class="an-mover-none">—</div>'}
        </div>
      </div>`;
  }

  function renderAnalytics() {
    const grid  = document.getElementById('anCardsGrid');
    const label = document.getElementById('anMonthLabel');
    if (!grid) return;

    label.textContent = monthLabel(analyticsMonth);

    const cur      = catBreakdown(analyticsMonth);
    const baseline = getBaselineBreakdown(analyticsMonth, analyticsBaseline);
    const baseLbl  = analyticsBaseline === 1 ? 'prev' : `${analyticsBaseline}M avg`;
    const fixedOnly = getFixedOnlyCats(analyticsMonth);

    const cats = Object.keys(cur)
      .filter(c => cur[c].actual > 0 && !fixedOnly.has(c))
      .sort((a, b) => cur[b].actual - cur[a].actual);

    renderTotalTrend(fixedOnly);
    renderShareDonut(cats, cur);
    renderFixedCosts(baseline, baseLbl);
    renderMovers(cats, cur, baseline);

    if (!cats.length) {
      grid.innerHTML = '<div class="an-empty">No variable expense data for this month.</div>';
      return;
    }

    grid.innerHTML = cats.map(cat => {
      const curAmt = (cur[cat] || {}).actual || 0;
      const bAmt   = (baseline[cat] || {}).actual || 0;
      const maxAmt = Math.max(curAmt, bAmt, 1);
      const curPct = (curAmt / maxAmt * 100).toFixed(1);
      const bPct   = (bAmt   / maxAmt * 100).toFixed(1);

      // 6-month sparkline for this category
      const sparkMonths = [];
      let sm = analyticsMonth;
      for (let i = 0; i < 6; i++) { sparkMonths.unshift(sm); sm = prevMonth(sm); }
      const sparkVals = sparkMonths.map(mo => (catBreakdown(mo)[cat] || {}).actual || 0);
      const sparkColor = curAmt > bAmt && bAmt > 0 ? '#f87171' : curAmt < bAmt && bAmt > 0 ? '#34d399' : '#60a5fa';
      const spark = sparklineSVG(sparkVals, sparkColor);

      let badgeHtml = '';
      let curBarClass = 'an-bar-curr-neutral';
      if (bAmt > 0) {
        const pct = ((curAmt - bAmt) / bAmt) * 100;
        const up  = pct > 0;
        badgeHtml = `<span class="an-badge ${up ? 'an-badge-up' : 'an-badge-down'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(0)}%</span>`;
        curBarClass = up ? 'an-bar-curr-up' : 'an-bar-curr-down';
      } else {
        badgeHtml = `<span class="an-badge an-badge-new">New</span>`;
      }

      const prevGhost = bAmt > 0 ? `<div class="an-bar-fill an-bar-prev" style="width:${bPct}%"></div>` : '';
      const prevLabel = bAmt > 0
        ? `<span class="an-bar-prev-amt">${fmt(bAmt)} ${baseLbl}</span>`
        : `<span class="an-bar-prev-amt an-bar-prev-none">No prev</span>`;

      return `
        <div class="an-row">
          <div class="an-row-header">
            <span class="an-row-cat">${esc(cat)}</span>
            <div class="an-spark">${spark}</div>
            ${badgeHtml}
          </div>
          <div class="an-bar-track">
            ${prevGhost}
            <div class="an-bar-fill ${curBarClass}" style="width:${curPct}%"></div>
          </div>
          <div class="an-bar-footer">
            <span class="an-bar-curr-amt">${fmt(curAmt)}</span>
            ${prevLabel}
          </div>
        </div>`;
    }).join('');
  }

  function wireAnalytics() {
    const prevBtn = document.getElementById('anPrevMonthBtn');
    const nextBtn = document.getElementById('anNextMonthBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => { analyticsMonth = prevMonth(analyticsMonth); renderAnalytics(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { analyticsMonth = nextMonth(analyticsMonth); renderAnalytics(); });
    // Fixed modal close
    const fixedModal = document.getElementById('anFixedModal');
    if (fixedModal) {
      document.getElementById('anFixedModalClose').addEventListener('click', () => { fixedModal.style.display = 'none'; });
      fixedModal.addEventListener('click', e => { if (e.target === fixedModal) fixedModal.style.display = 'none'; });
    }
    document.querySelectorAll('.an-baseline-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.an-baseline-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        analyticsBaseline = parseInt(btn.dataset.baseline, 10);
        renderAnalytics();
      });
    });
    // Re-render when tab becomes visible
    document.querySelectorAll('#appTabBar .app-tab').forEach(btn => {
      if (btn.dataset.page === 'analytics') {
        btn.addEventListener('click', () => renderAnalytics());
      }
    });
  }
})();
