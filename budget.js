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
    const fixedSum = month.budget.filter(e => e.fixed).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const manualSum = month.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return fixedSum + manualSum;
  }

  // ── Per-category breakdown (budgeted + actual) ──────────────────────────────────────
  function catBreakdown(ym) {
    const month = getMonth(ym);
    const map = {};
    month.budget.forEach(e => {
      if (!map[e.category]) map[e.category] = { budgeted: 0, actual: 0 };
      map[e.category].budgeted += Number(e.amount) || 0;
      if (e.fixed) map[e.category].actual += Number(e.amount) || 0;
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
    const diffLabelEl = document.getElementById('cardDiffLabel');

    if (budgetAmtEl) budgetAmtEl.textContent = fmt(budget);
    if (expenseAmtEl) expenseAmtEl.textContent = fmt(spent);
    if (diffEl) { diffEl.textContent = fmt(Math.abs(diff)); diffEl.className = 'b-summary-diff ' + (over ? 'over' : 'under'); }
    if (arrowEl) { arrowEl.textContent = over ? '↑' : '↓'; arrowEl.className = 'b-arrow ' + (over ? 'over' : 'under'); }
    if (diffLabelEl) diffLabelEl.textContent = over ? 'Over budget' : 'Under budget';
  }

  // ── Nearing-limit progress bars (≥ 90% spent) ───────────────────────────────
  function renderCategoryProgress() {
    const section = document.getElementById('catProgressSection');
    const list = document.getElementById('catProgressList');
    const breakdown = catBreakdown(activeMonth);
    const month = getMonth(activeMonth);
    // Build set of categories whose budget entries are ALL fixed (auto-logged — no alert needed)
    const fixedOnlyCats = new Set(
      db.categories.map(c => c.name).filter(name => {
        const entries = month.budget.filter(e => e.category === name);
        return entries.length > 0 && entries.every(e => e.fixed);
      })
    );
    // Only non-fixed categories with a budget set AND actual >= 90%
    const alerts = Object.entries(breakdown)
      .filter(([cat, { budgeted, actual }]) => budgeted > 0 && !fixedOnlyCats.has(cat) && actual / budgeted >= 0.9)
      .sort((a, b) => (b[1].actual / b[1].budgeted) - (a[1].actual / a[1].budgeted));
    if (!alerts.length) { section.style.display = 'none'; return; }
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
      list.appendChild(row);
    });
  }

  // ── Charts ───────────────────────────────────────────────────────────────────
  let donutInst = null;
  let barInst = null;
  const CHART_COLORS = ['#607d8b','#4db6ac','#ff8a65','#ba68c8','#4fc3f7','#aed581','#f06292','#ffd54f','#80cbc4','#ffb74d'];

  function renderCharts() {
    const breakdown = catBreakdown(activeMonth);
    const cats = Object.keys(breakdown).sort();
    const carousel = document.getElementById('chartCarousel');
    if (!cats.length) { carousel.style.display = 'none'; return; }
    carousel.style.display = 'block';

    const actuals = cats.map(c => breakdown[c].actual);
    const budgets = cats.map(c => breakdown[c].budgeted);
    const colors  = cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
    const isDark   = document.documentElement.getAttribute('data-theme') === 'dark';
    const tickColor = isDark ? '#9ca3af' : '#78909c';
    const gridColor = isDark ? '#374151' : '#f0f1f4';

    if (donutInst) donutInst.destroy();
    donutInst = new Chart(document.getElementById('donutChart').getContext('2d'), {
      type: 'doughnut',
      data: { labels: cats, datasets: [{ data: actuals, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: tickColor, boxWidth: 12, padding: 12, font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)}` } }
        }
      }
    });

    if (barInst) barInst.destroy();
    barInst = new Chart(document.getElementById('barChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: cats,
        datasets: [
          { label: 'Budget', data: budgets, backgroundColor: isDark ? '#4b5563' : '#cfd8dc', borderRadius: 4 },
          { label: 'Actual', data: actuals, backgroundColor: colors, borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: { ticks: { color: tickColor, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: tickColor, font: { size: 11 }, callback: v => '$' + v.toLocaleString('en-US') }, grid: { color: gridColor } }
        },
        plugins: {
          legend: { labels: { color: tickColor, boxWidth: 12, font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
        }
      }
    });
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
    const tbody = document.querySelector('#expenseListTable tbody');
    tbody.innerHTML = '';
    const fixedEntries = month.budget.filter(e => e.fixed);
    const hasAny = fixedEntries.length || month.expenses.length;
    if (!hasAny) {
      tbody.innerHTML = '<tr><td colspan="4" class="b-empty-row">No expenses recorded yet.</td></tr>';
      return;
    }
    // Auto-rows from fixed budget entries (read-only)
    fixedEntries.forEach(entry => {
      const tr = document.createElement('tr');
      tr.className = 'b-fixed-row';
      tr.innerHTML = `
        <td><span class="b-cat-chip">${esc(entry.category)}</span> <span class="b-fixed-badge">Fixed</span></td>
        <td class="b-muted-cell">${esc(entry.description || '')}</td>
        <td class="b-amount-cell">${fmt(entry.amount)}</td>
        <td class="b-actions-cell b-muted-cell" style="font-size:11px">auto</td>`;
      tbody.appendChild(tr);
    });
    // Manually entered expenses
    month.expenses.forEach(entry => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="b-cat-chip">${esc(entry.category)}</span></td>
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
    populateCatDropdown('budgetCatSel', '');
    populateCatDropdown('expenseCatSel', '');
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

  function openBudgetForm(entry) {
    editingBudgetId = entry ? entry.id : null;
    document.getElementById('budgetFormTitle').textContent = entry ? 'Edit Budget Entry' : 'Add Budget Entry';
    document.getElementById('budgetCatSel').value = entry ? entry.category : '';
    document.getElementById('budgetCatText').value = '';
    document.getElementById('budgetDesc').value = entry ? (entry.description || '') : '';
    document.getElementById('budgetAmt').value = entry ? entry.amount : '';
    document.getElementById('budgetFixed').checked = entry ? !!entry.fixed : false;
    document.getElementById('budgetForm').classList.remove('b-hidden');
    document.getElementById('budgetCatSel').focus();
  }
  function closeBudgetForm() {
    editingBudgetId = null;
    document.getElementById('budgetForm').classList.add('b-hidden');
    document.getElementById('budgetCatText').value = '';
    document.getElementById('budgetAmt').value = '';
    document.getElementById('budgetDesc').value = '';
    document.getElementById('budgetFixed').checked = false;
  }
  async function saveBudgetEntry() {
    const cat = readCatField('budgetCatSel', 'budgetCatText');
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

  // ── Quick-add Expense Modal ───────────────────────────────────────────────────
  let editingExpenseId = null;

  function openQuickExpenseModal(entry) {
    editingExpenseId = entry ? entry.id : null;
    populateCatDropdown('expenseCatSel', entry ? entry.category : '');
    document.getElementById('expenseCatText').value = '';
    document.getElementById('expenseDesc').value = entry ? (entry.description || '') : '';
    document.getElementById('expenseAmt').value = entry ? entry.amount : '';
    document.getElementById('quickExpenseModal').classList.add('active');
    document.getElementById('expenseCatSel').focus();
  }
  function closeQuickExpenseModal() {
    editingExpenseId = null;
    document.getElementById('quickExpenseModal').classList.remove('active');
    document.getElementById('expenseCatText').value = '';
    document.getElementById('expenseAmt').value = '';
    document.getElementById('expenseDesc').value = '';
  }
  async function saveQuickExpense() {
    const cat = readCatField('expenseCatSel', 'expenseCatText');
    const desc = document.getElementById('expenseDesc').value.trim();
    const amt = parseFloat(document.getElementById('expenseAmt').value);
    if (!cat) { toast('Category is required', 'error'); return; }
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }
    ensureCategory(cat);
    const month = getMonth(activeMonth);
    if (editingExpenseId) {
      const entry = month.expenses.find(e => e.id === editingExpenseId);
      if (entry) { entry.category = cat; entry.description = desc; entry.amount = amt; }
    } else {
      month.expenses.push({ id: uid(), category: cat, description: desc, amount: amt });
    }
    closeQuickExpenseModal();
    await save();
    renderSummaryCards();
    toast(editingExpenseId ? 'Expense updated' : 'Expense added');
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

    // Expense panel list view
    document.getElementById('viewExpenseListBtn').addEventListener('click', openExpenseListPopup);

    // Expense list modal
    document.getElementById('closeExpenseListModal').addEventListener('click', () => document.getElementById('expenseListModal').classList.remove('active'));
    document.getElementById('expenseListModal').addEventListener('click', e => { if (e.target === document.getElementById('expenseListModal')) document.getElementById('expenseListModal').classList.remove('active'); });
    document.getElementById('expenseListTable').addEventListener('click', async e => {
      const editBtn = e.target.closest('.b-edit-expense');
      const delBtn = e.target.closest('.b-del-expense');
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

    // When expense dropdown changes, clear text box
    document.getElementById('expenseCatSel').addEventListener('change', () => { document.getElementById('expenseCatText').value = ''; });

    // Carousel dot navigation
    document.querySelectorAll('.b-dot').forEach(dot => {
      dot.addEventListener('click', function () {
        const idx = parseInt(this.dataset.slide);
        document.querySelectorAll('.b-carousel-slide').forEach((s, i) => s.classList.toggle('active', i === idx));
        document.querySelectorAll('.b-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
        setTimeout(() => { if (idx === 0 && donutInst) donutInst.resize(); if (idx === 1 && barInst) barInst.resize(); }, 30);
      });
    });

    // When budget dropdown changes, clear the text box
    document.getElementById('budgetCatSel').addEventListener('change', () => { document.getElementById('budgetCatText').value = ''; });

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

    // Theme toggle
    const themeBtn = document.getElementById('budgetThemeToggle');
    themeBtn.textContent = localStorage.getItem('propfolio-theme') === 'dark' ? '☀️' : '🌙';
    themeBtn.addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('propfolio-theme', dark ? 'light' : 'dark');
      themeBtn.textContent = dark ? '🌙' : '☀️';
      renderCharts(); // re-render with updated tick/grid colors
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('monthPicker').value = activeMonth;
    await load();
    wireEvents();
    render();
  });
})();
