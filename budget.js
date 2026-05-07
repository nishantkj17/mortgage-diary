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
      .filter(([cat, { budgeted, actual }]) => budgeted > 0 && !fixedOnlyCats.has(cat) && actual / budgeted >= 0.6)
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
    const manualExpenses = month.expenses.filter(e => !e.fixedId);
    const hasAny = fixedEntries.length || manualExpenses.length;
    if (!hasAny) {
      tbody.innerHTML = '<tr><td colspan="4" class="b-empty-row">No expenses recorded yet.</td></tr>';
      return;
    }
    // Auto-rows from fixed budget entries (editable)
    fixedEntries.forEach(entry => {
      const override = month.expenses.find(e => e.fixedId === entry.id);
      const displayAmt = override ? override.amount : entry.amount;
      const displayDesc = override ? (override.description || '') : (entry.description || '');
      const tr = document.createElement('tr');
      tr.className = 'b-fixed-row';
      tr.innerHTML = `
        <td><span class="b-cat-chip">${esc(entry.category)}</span> <span class="b-fixed-badge">Fixed</span>${override ? ' <span class="b-override-badge" title="Amount overridden">Edited</span>' : ''}</td>
        <td class="b-muted-cell">${esc(displayDesc)}</td>
        <td class="b-amount-cell">${fmt(displayAmt)}</td>
        <td class="b-actions-cell">
          <button class="b-btn-icon b-edit-fixed" data-id="${entry.id}" title="Edit actual amount">✎</button>
          <button class="b-btn-icon b-del-fixed" data-id="${entry.id}" title="${override ? 'Reset to budget amount' : 'Delete'}">✕</button>
        </td>`;
      tbody.appendChild(tr);
    });
    // Manually entered expenses
    manualExpenses.forEach(entry => {
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
      });
      container.appendChild(btn);
    });
  }

  // ── Quick-add Expense Modal ───────────────────────────────────────────────────
  let editingExpenseId = null;
  let editingFixedSourceId = null;

  function openQuickExpenseModal(entry, fixedSourceId) {
    editingExpenseId = entry ? entry.id : null;
    editingFixedSourceId = fixedSourceId || null;
    renderExpenseCatTags(entry ? entry.category : '');
    document.getElementById('expenseCatText').value = '';
    document.getElementById('expenseDesc').value = entry ? (entry.description || '') : '';
    document.getElementById('expenseAmt').value = entry ? entry.amount : '';
    document.getElementById('quickExpenseModal').classList.add('active');
    document.getElementById('expenseAmt').focus();
  }
  function closeQuickExpenseModal() {
    editingExpenseId = null;
    editingFixedSourceId = null;
    selectedExpenseCat = '';
    document.getElementById('quickExpenseModal').classList.remove('active');
    document.getElementById('expenseCatText').value = '';
    document.getElementById('expenseAmt').value = '';
    document.getElementById('expenseDesc').value = '';
  }
  async function saveQuickExpense() {
    const textCat = document.getElementById('expenseCatText').value.trim();
    const cat = textCat || selectedExpenseCat;
    const desc = document.getElementById('expenseDesc').value.trim();
    const amt = parseFloat(document.getElementById('expenseAmt').value);
    if (!cat) { toast('Category is required', 'error'); return; }
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }
    ensureCategory(cat);
    const month = getMonth(activeMonth);
    if (editingExpenseId) {
      const entry = month.expenses.find(e => e.id === editingExpenseId);
      if (entry) { entry.category = cat; entry.description = desc; entry.amount = amt; }
    } else if (editingFixedSourceId) {
      month.expenses.push({ id: uid(), category: cat, description: desc, amount: amt, fixedId: editingFixedSourceId });
    } else {
      month.expenses.push({ id: uid(), category: cat, description: desc, amount: amt });
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
      const editBtn = e.target.closest('.b-edit-expense');
      const delBtn = e.target.closest('.b-del-expense');
      const editFixed = e.target.closest('.b-edit-fixed');
      const delFixed = e.target.closest('.b-del-fixed');
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
    render();
    renderHomeWidgets();
  });

  // Expose for SPA: home FAB opens the quick-add expense modal in the budget tab
  window.budgetOpenExpense = openQuickExpenseModal;
  // Expose for re-render when switching to home tab
  window.budgetRenderHomeWidgets = renderHomeWidgets;
})();
