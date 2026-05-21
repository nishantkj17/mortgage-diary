(function(){
  const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5001/api' : '/api';

  function uid(){return Date.now().toString(36) + Math.random().toString(36).slice(2,8)}

  // ── Toast ────────────────────────────────────────────────────────────────────
  let _toastTimer;
  function showToast(msg, type = 'success', duration = 2800) {
    const el = document.getElementById('toast');
    if (!el) return;
    clearTimeout(_toastTimer);
    el.textContent = msg;
    el.className = 'toast toast-' + type + ' toast-show';
    _toastTimer = setTimeout(() => { el.classList.remove('toast-show'); }, duration);
  }

  // ── Confirm dialog ───────────────────────────────────────────────────────────
  function showConfirm(msg, { icon = '🗑️', okLabel = 'Delete', okClass = '' } = {}) {
    return new Promise(resolve => {
      const modal   = document.getElementById('confirmModal');
      const msgEl   = document.getElementById('confirmMsg');
      const iconEl  = document.getElementById('confirmIcon');
      const okBtn   = document.getElementById('confirmOk');
      const cancelBtn = document.getElementById('confirmCancel');
      msgEl.textContent  = msg;
      iconEl.textContent = icon;
      okBtn.textContent  = okLabel;
      modal.classList.add('active');
      const cleanup = (result) => {
        modal.classList.remove('active');
        okBtn.replaceWith(okBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        resolve(result);
      };
      document.getElementById('confirmOk').addEventListener('click', () => cleanup(true), { once: true });
      document.getElementById('confirmCancel').addEventListener('click', () => cleanup(false), { once: true });
    });
  }

  async function load(){
    try{
      const response = await fetch(`${API_BASE}/data`);
      if (!response.ok) throw new Error('Failed to load data');
      return await response.json();
    }catch(e){
      console.error('Load error:', e);
      return {accounts:[]};
    }
  }
  
  async function save(data){
    try{
      const response = await fetch(`${API_BASE}/data`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to save data');
    }catch(e){
      console.error('Save error:', e);
      showToast('Failed to save. Check server is running.', 'error');
    }
  }

  const qs = sel => document.querySelector(sel);
  const qsa = sel => Array.from(document.querySelectorAll(sel));

  let data = {accounts:[]};
  let currentAccountId = null;
  let chart = null;
  let sortCol = 'month';   // 'month' | 'interest' | 'balance' | 'payment'
  let sortDir = 'desc';    // 'asc' | 'desc'
  let currentTab = 'analytics';
  let currentTheme = localStorage.getItem('propfolio-theme') || 'light';

  function themeIcon(t) {
    if (t === 'dark') return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  }

  function applyTheme(t) {
    currentTheme = t;
    localStorage.setItem('propfolio-theme', t);
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    qsa('.theme-toggle-btn').forEach(btn => { btn.innerHTML = themeIcon(t); btn.title = t === 'dark' ? 'Dark mode' : 'Light mode'; });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme === 'system') applyTheme('system');
  });

  function formatMonthYear(dateStr) {
    // dateStr is YYYY-MM or YYYY-MM-DD
    const [year, month] = dateStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month)-1]} ${year}`;
  }

  function renderAll() {
    renderAccountsList();
    renderEntries();
    renderSummaryCards();
    renderLoanProgress();
    renderHomeDashboard();
    updateChart();
    renderTenants();
  }

  async function init(){
    data = await load();
    renderAll();
  }

  function renderAccountsList(){
    const sel = qs('#selectAccount');
    sel.innerHTML = '';
    data.accounts.forEach(acc=>{
      const opt = document.createElement('option'); opt.value = acc.id; opt.textContent = acc.name; sel.appendChild(opt);
    });

    const list = qs('#accountsList'); list.innerHTML='';
    data.accounts.forEach(acc=>{
      const div = document.createElement('div'); div.className='acc';
      const title = document.createElement('div'); title.textContent = acc.name;
      const count = document.createElement('div'); count.textContent = (acc.entries||[]).length + ' entries';
      div.appendChild(title); div.appendChild(count);
      list.appendChild(div);
    });

    if(!currentAccountId && data.accounts.length) {
      const preferred = data.accounts.find(a => a.name === 'Lodha Bellavita');
      currentAccountId = (preferred || data.accounts[0]).id;
    }
    sel.value = currentAccountId || '';
    // Sync mobile account selector
    const mobSel = qs('#mobileSelectAccount');
    if(mobSel) { mobSel.innerHTML = sel.innerHTML; mobSel.value = currentAccountId || ''; }
  }

  async function createAccount(name){
    if(!name) return;
    const acc = {id:uid(), name:name, entries:[], tenant:{}, transactions:[]};
    data.accounts.push(acc); 
    await save(data); 
    currentAccountId = acc.id; 
    renderAll();
    showToast('Account "' + name + '" created ✓', 'success');
  }

  async function deleteAccount(id){
    if(!id) return;
    const idx = data.accounts.findIndex(a=>a.id===id); if(idx===-1) return;
    const accName = data.accounts[idx].name;
    if(!await showConfirm('Delete account "'+accName+'" and all its entries? This cannot be undone.', { icon:'🗑️', okLabel:'Delete Account' })) return;
    data.accounts.splice(idx,1); 
    await save(data); 
    currentAccountId = data.accounts[0]?data.accounts[0].id:null; 
    renderAll();
    showToast('Account "' + accName + '" deleted', 'success');
  }

  function getCurrentAccount(){return data.accounts.find(a=>a.id===currentAccountId)}

  function switchTab(tab) {
    currentTab = tab;
    qsa('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const panels = { analytics: '#tabAnalytics', add: '#topSection', entries: '#entriesSection', tenants: '#tabTenants' };
    Object.entries(panels).forEach(([key, sel]) => {
      const el = qs(sel);
      if(el) el.classList.toggle('tab-active', key === tab);
    });
    if(tab === 'analytics' && chart) setTimeout(() => chart.resize(), 100);
    if(tab === 'tenants') renderTenants();
  }

  function renderEntries(){
    const tbl = qs('#entriesTable tbody'); tbl.innerHTML='';
    const acc = getCurrentAccount(); if(!acc) return;
    const rows = (acc.entries||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
    
    // Group entries by month
    const groupedByMonth = {};
    rows.forEach(entry=>{
      const monthKey = entry.date.substring(0, 7);
      if(!groupedByMonth[monthKey]) groupedByMonth[monthKey] = [];
      groupedByMonth[monthKey].push(entry);
    });

    // Build summary per month for sorting
    const monthKeys = Object.keys(groupedByMonth);
    const monthMeta = monthKeys.map(k => {
      const entries = groupedByMonth[k];
      const primary = entries.find(e => e.principal === null || e.principal === undefined) || entries[0];
      const totalPayment = entries.reduce((s,e) => s + (e.principal && e.principalType !== 'withdrawal' ? e.principal : 0), 0);
      return { key: k, interest: primary.interest, balance: primary.balance ?? null, payment: totalPayment };
    });

    // Sort month groups
    monthMeta.sort((a, b) => {
      let va, vb;
      if(sortCol === 'month')    { va = a.key;      vb = b.key; }
      else if(sortCol === 'interest') { va = a.interest; vb = b.interest; }
      else if(sortCol === 'balance')  { va = a.balance ?? -Infinity; vb = b.balance ?? -Infinity; }
      else if(sortCol === 'payment')  { va = a.payment;  vb = b.payment; }
      if(va < vb) return sortDir === 'asc' ? -1 : 1;
      if(va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // Update header indicators
    const thead = qs('#entriesTable thead tr');
    thead.querySelectorAll('th[data-sort]').forEach(th => {
      const col = th.dataset.sort;
      const arrow = col === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
      th.textContent = th.dataset.label + arrow;
    });

    // Render grouped entries
    monthMeta.forEach(({ key: monthKey }) => {
      const monthEntries = groupedByMonth[monthKey];
      const monthYear = formatMonthYear(monthKey);
      
      // If only one entry for the month, show it as a flat row
      if(monthEntries.length === 1) {
        const entry = monthEntries[0];
        const tr = document.createElement('tr');
        
        const principalVal = entry.principal!==null && entry.principal!==undefined?entry.principal.toFixed(2):'';
        
        let typeCell = '';
        if(entry.principal !== null && entry.principal !== undefined && entry.principal > 0) {
          const typeText = entry.principalType === 'withdrawal' ? 'Withdrawal' : 'Payment';
          const typeClass = entry.principalType === 'withdrawal' ? 'type-withdrawal' : 'type-payment';
          typeCell = `<span class="${typeClass}">${typeText}</span>`;
        }
        
        const balanceVal = entry.balance !== null && entry.balance !== undefined ? entry.balance.toFixed(2) : '';
        tr.innerHTML = `
          <td><strong>${monthYear}</strong></td>
          <td data-label="Interest">${entry.interest.toFixed(2)}</td>
          <td data-label="Balance">${balanceVal}</td>
          <td data-label="Payment">${principalVal}</td>
          <td data-label="Type">${typeCell}</td>
          <td data-label="Notes">${entry.notes||''}</td>
          <td class="actions-cell">
            <button data-id="${entry.id}" class="editEntry" title="Edit entry">✎</button>
            <button data-id="${entry.id}" class="delEntry" title="Delete entry">✕</button>
          </td>`;
        tbl.appendChild(tr);
        return; // Skip the grouped rendering
      }
      
      // Multiple entries: show grouped with expand/collapse
      // Calculate totals for the month
      // Interest lives only on the primary entry; transaction entries have interest=0
      const primaryTableEntry = monthEntries.find(e => e.principal === null || e.principal === undefined);
      const totalInterest = primaryTableEntry ? primaryTableEntry.interest : monthEntries[0].interest;
      const totalPayment = monthEntries.reduce((sum, e) => {
        if(e.principal && e.principalType !== 'withdrawal') return sum + e.principal;
        return sum;
      }, 0);
      const totalWithdrawal = monthEntries.reduce((sum, e) => {
        if(e.principal && e.principalType === 'withdrawal') return sum + e.principal;
        return sum;
      }, 0);
      const netPrincipal = totalPayment - totalWithdrawal;
      
      // Create month header row
      const headerRow = document.createElement('tr');
      headerRow.className = 'month-group-header';
      headerRow.dataset.month = monthKey;
      
      let netDisplay = '';
      let netClass = '';
      if(netPrincipal !== 0) {
        netClass = netPrincipal > 0 ? 'type-payment' : 'type-withdrawal';
        netDisplay = `<span class="${netClass}">Net: ${Math.abs(netPrincipal).toFixed(2)} (${netPrincipal > 0 ? 'Payment' : 'Withdrawal'})</span>`;
      }

      // Find the latest non-null balance in this month
      let groupLatestBalance = null;
      for(const e of monthEntries) {
        if(e.balance !== null && e.balance !== undefined) groupLatestBalance = e.balance;
      }
      const groupBalanceDisplay = groupLatestBalance !== null ? groupLatestBalance.toFixed(2) : '';
      
      headerRow.innerHTML = `
        <td><span class="expand-icon">${monthEntries.length > 1 ? '▶' : '\u00a0\u00a0'}</span> <strong>${monthYear}</strong></td>
        <td data-label="Interest"><strong>${totalInterest.toFixed(2)}</strong></td>
        <td data-label="Balance">${groupBalanceDisplay}</td>
        <td data-label="Net">${netDisplay}</td>
        <td data-label="Txns"><em>${monthEntries.length} txn${monthEntries.length > 1 ? 's' : ''}</em></td>
        <td></td>
        <td></td>`;
      tbl.appendChild(headerRow);
      
      // Add click handler to expand/collapse if multiple entries
      if(monthEntries.length > 1) {
        headerRow.style.cursor = 'pointer';
        headerRow.addEventListener('click', () => {
          const icon = headerRow.querySelector('.expand-icon');
          const detailRows = tbl.querySelectorAll(`tr[data-parent="${monthKey}"]`);
          const isExpanded = icon.textContent.includes('▼');
          
          if(isExpanded) {
            icon.textContent = '▶';
            detailRows.forEach(row => row.style.display = 'none');
          } else {
            icon.textContent = '▼';
            detailRows.forEach(row => row.style.display = '');
          }
        });
      }
      
      // Create detail rows (initially hidden if multiple entries)
      monthEntries.forEach(entry => {
        const tr = document.createElement('tr');
        tr.className = 'month-detail-row';
        tr.dataset.parent = monthKey;
        if(monthEntries.length > 1) tr.style.display = 'none';
        
        const principalVal = entry.principal!==null && entry.principal!==undefined?entry.principal.toFixed(2):'';
        
        let typeCell = '';
        if(entry.principal !== null && entry.principal !== undefined && entry.principal > 0) {
          const typeText = entry.principalType === 'withdrawal' ? 'Withdrawal' : 'Payment';
          const typeClass = entry.principalType === 'withdrawal' ? 'type-withdrawal' : 'type-payment';
          typeCell = `<span class="${typeClass}">${typeText}</span>`;
        }
        
        const detailBalanceVal = entry.balance !== null && entry.balance !== undefined ? entry.balance.toFixed(2) : '';
        tr.innerHTML = `
          <td>${entry.notes||'(transaction)'}</td>
          <td data-label="Interest">${entry.interest > 0 ? entry.interest.toFixed(2) : ''}</td>
          <td data-label="Balance">${detailBalanceVal}</td>
          <td data-label="Payment">${principalVal}</td>
          <td data-label="Type">${typeCell}</td>
          <td></td>
          <td class="actions-cell">
            <button data-id="${entry.id}" class="editEntry" title="Edit entry">✎</button>
            <button data-id="${entry.id}" class="delEntry" title="Delete entry">✕</button>
          </td>`;
        tbl.appendChild(tr);
      });
    });
  }

  async function addEntry(obj){
    const acc = getCurrentAccount(); if(!acc) return showToast('No account selected', 'error');
    acc.entries = acc.entries || [];
    acc.entries.push(Object.assign({id:uid()}, obj));
    await save(data); 
    renderAll();
    showToast('Entry added ✓', 'success');
  }

  async function removeEntry(entryId){
    const acc = getCurrentAccount(); if(!acc) return;
    const idx = acc.entries.findIndex(e=>e.id===entryId); if(idx===-1) return; 
    acc.entries.splice(idx,1); 
    await save(data); 
    renderAll();
    showToast('Entry deleted', 'success');
  }

  async function updateEntry(entryId, updates){
    const acc = getCurrentAccount(); if(!acc) return;
    const entry = acc.entries.find(e=>e.id===entryId);
    if(!entry) return;
    Object.assign(entry, updates);
    await save(data);
    renderAll();
  }

  // ── Home Dashboard — Loan Repayment (all accounts) ──────────────────────────
  function renderHomeDashboard() {
    const el = document.getElementById('homeLoanSection');
    if (!el) return;
    if (!data.accounts || !data.accounts.length) { el.innerHTML = '<p class="home-dash-empty">No property data yet.</p>'; return; }

    function fmtL(v) {
      return '₹' + (v / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + 'L';
    }

    el.innerHTML = data.accounts.map(acc => {
      const rows = (acc.entries || []).filter(e => e.balance !== null && e.balance !== undefined);
      if (!rows.length) return '';
      const latest = rows.reduce((a, b) => new Date(a.date) > new Date(b.date) ? a : b);
      const currentBalance = Number(latest.balance);
      const balanceValues = rows.map(e => Number(e.balance)).filter(v => !isNaN(v) && v > 0);
      const TOTAL_LOAN = balanceValues.length ? Math.max(...balanceValues) : currentBalance;
      const repaid = Math.max(0, TOTAL_LOAN - currentBalance);
      const pct = Math.min(100, (repaid / TOTAL_LOAN) * 100);
      return `
        <div class="home-loan-block">
          <div class="loan-progress-header">
            <div class="loan-progress-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#78909c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              ${acc.name} — Loan Repayment
            </div>
            <span class="loan-progress-pct">${pct.toFixed(1)}% repaid</span>
          </div>
          <div class="loan-progress-track">
            <div class="loan-progress-fill" style="width:${pct.toFixed(2)}%"></div>
          </div>
          <div class="loan-progress-labels">
            <span class="lp-repaid">↓ ${fmtL(repaid)} repaid</span>
            <span style="color:#90a4ae;font-size:11px">of ${fmtL(TOTAL_LOAN)}</span>
            <span class="lp-remaining">${fmtL(currentBalance)} remaining ↑</span>
          </div>
        </div>`;
    }).join('');
  }

  // ── Loan Repayment Progress Bar ─────────────────────────────────────────────
  function renderLoanProgress() {
    const el = qs('#loanProgress');
    if (!el) return;

    const acc = getCurrentAccount();
    if (!acc || !acc.entries || acc.entries.length === 0) { el.innerHTML = ''; return; }

    // Get latest month's balance
    const rows = acc.entries.filter(e => e.balance !== null && e.balance !== undefined);
    if (rows.length === 0) { el.innerHTML = ''; return; }
    const latest = rows.reduce((a, b) => new Date(a.date) > new Date(b.date) ? a : b);
    const currentBalance = Number(latest.balance);
    const balanceValues = rows.map(e => Number(e.balance)).filter(v => !isNaN(v) && v > 0);
    const TOTAL_LOAN = balanceValues.length > 0 ? Math.max(...balanceValues) : currentBalance;
    const repaid = Math.max(0, TOTAL_LOAN - currentBalance);
    const pct = Math.min(100, (repaid / TOTAL_LOAN) * 100);

    function fmtL(v) {
      return '₹' + (v / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + 'L';
    }

    el.innerHTML = `
      <div class="loan-progress-header">
        <div class="loan-progress-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#78909c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Loan Repayment
        </div>
        <span class="loan-progress-pct">${pct.toFixed(1)}% repaid</span>
      </div>
      <div class="loan-progress-track">
        <div class="loan-progress-fill" style="width:${pct.toFixed(2)}%"></div>
      </div>
      <div class="loan-progress-labels">
        <span class="lp-repaid">↓ ${fmtL(repaid)} repaid</span>
        <span style="color:#90a4ae;font-size:11px">of ${fmtL(TOTAL_LOAN)}</span>
        <span class="lp-remaining">${fmtL(currentBalance)} remaining ↑</span>
      </div>
    `;
  }

  // ── Summary Stat Cards ──────────────────────────────────────────────────────
  function renderSummaryCards() {
    const container = qs('#summaryCards');
    if (!container) return;

    const acc = getCurrentAccount();
    if (!acc || !acc.entries || acc.entries.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Group by month, sorted
    const byMonth = {};
    acc.entries.forEach(e => {
      const k = e.date.substring(0, 7);
      if (!byMonth[k]) byMonth[k] = [];
      byMonth[k].push(e);
    });
    const monthKeys = Object.keys(byMonth).sort();
    if (monthKeys.length === 0) { container.innerHTML = ''; return; }

    // Get primary entry (interest+balance owner) for a given month key
    function primary(k) {
      const list = byMonth[k];
      return list.find(e => e.principal === null || e.principal === undefined) || list[0];
    }

    const latestKey = monthKeys[monthKeys.length - 1];
    const prevKey   = monthKeys.length > 1 ? monthKeys[monthKeys.length - 2] : null;
    const latest    = primary(latestKey);
    const prev      = prevKey ? primary(prevKey) : null;

    const latestBalance  = latest ? latest.balance  : null;
    const prevBalance    = prev   ? prev.balance    : null;
    const latestInterest = latest ? latest.interest : null;
    const prevInterest   = prev   ? prev.interest   : null;

    function fmt(val) {
      if (val === null || val === undefined) return '—';
      const n = Number(val);
      if (n >= 100000) return '₹' + (n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + 'L';
      return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }

    function trendHtml(cur, prv) {
      if (cur === null || cur === undefined || prv === null || prv === undefined) {
        return '<span class="trend-flat">— first entry</span>';
      }
      const diff = cur - prv;
      if (Math.abs(diff) < 0.01) return '<span class="trend-flat">↔ No change</span>';
      const up  = diff > 0;
      const cls = up ? 'trend-up' : 'trend-down';
      const arrow = up ? '↑' : '↓';
      return `<span class="${cls}">${arrow} ${fmt(Math.abs(diff))} vs prev</span>`;
    }

    // ── Aggregate stats across all entries ──
    const allPrimary = monthKeys.map(k => primary(k));
    const totalInterest   = allPrimary.reduce((s, e) => s + (e && e.interest ? Number(e.interest) : 0), 0);
    const avgInterest     = monthKeys.length > 0 ? totalInterest / monthKeys.length : 0;
    const totalDeposited  = acc.entries.reduce((s, e) => {
      return (e.principal && e.principalType !== 'withdrawal') ? s + Number(e.principal) : s;
    }, 0);
    const totalWithdrawn  = acc.entries.reduce((s, e) => {
      return (e.principal && e.principalType === 'withdrawal') ? s + Number(e.principal) : s;
    }, 0);

    // WeddingExpenseTracker neutral palette icons
    const balanceIcon    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9d8189" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`;
    const interestIcon   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#607d8b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`;
    const sumIcon        = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78909c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5l8 7-8 7"/><line x1="13" y1="12" x2="20" y2="12"/></svg>`;
    const depositIcon    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b9080" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
    const PROPERTY_VALUES  = { 'Kunal Iconia': 5700000, 'Lodha Bellavita': 12084000 };
    const propertyValue    = PROPERTY_VALUES[acc.name] || 0;
    const effectiveCost    = totalInterest + propertyValue;
    const withdrawIcon   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c09a6b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

    container.innerHTML = `
      <div class="summary-cards-row">
        <div class="summary-card">
          <div class="summary-card-label">
            ${balanceIcon} Balance
            <span class="summary-card-month">${formatMonthYear(latestKey)}</span>
          </div>
          <div class="summary-card-value" style="color:#9d8189">${fmt(latestBalance)}</div>
          <div class="summary-card-trend">${trendHtml(latestBalance, prevBalance)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">
            ${interestIcon} Interest
            <span class="summary-card-month">${formatMonthYear(latestKey)}</span>
          </div>
          <div class="summary-card-value" style="color:#607d8b">${fmt(latestInterest)}</div>
          <div class="summary-card-trend">${trendHtml(latestInterest, prevInterest)}</div>
        </div>
      </div>
      <div class="summary-cards-row">
        <div class="summary-card">
          <div class="summary-card-label">${sumIcon} Total Interest</div>
          <div class="summary-card-value" style="color:#78909c">${fmt(totalInterest)}</div>
          <div class="summary-card-trend"><span class="trend-flat">${monthKeys.length} months</span></div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">${interestIcon} Avg / Month</div>
          <div class="summary-card-value" style="color:#607d8b">${fmt(avgInterest)}</div>
          <div class="summary-card-trend"><span class="trend-flat">across all months</span></div>
        </div>
      </div>
      <div class="summary-cards-row">
        <div class="summary-card">
          <div class="summary-card-label">${depositIcon} Deposited</div>
          <div class="summary-card-value" style="color:#6b9080">${fmt(totalDeposited)}</div>
          <div class="summary-card-trend"><span class="trend-flat">total payments</span></div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">${withdrawIcon} Effective Cost</div>
          <div class="summary-card-value" style="color:#c09a6b">${fmt(effectiveCost)}</div>
          <div class="summary-card-trend"><span class="trend-flat">interest + property value</span></div>
        </div>
      </div>
    `;
  }

  // ── Tenant Management ────────────────────────────────────────────────────────────────────
  function categoryLabel(cat) {
    const map = { rent:'Rent', maintenance:'Society Maintenance Demand', electricity:'Electricity', water:'Water', society:'Agent Charges', repairs:'Repairs', other:'Other' };
    return map[cat] || cat;
  }

  function updateTxnCategories() {
    const catSel = qs('#txnCategory');
    if (!catSel) return;
    const type = qs('#txnType').value;
    catSel.innerHTML = type === 'income'
      ? '<option value="rent">Rent</option><option value="other">Other Income</option>'
      : '<option value="maintenance">Society Maintenance Demand</option><option value="electricity">Electricity</option><option value="water">Water</option><option value="society">Agent Charges</option><option value="repairs">Repairs</option><option value="other">Other Expense</option>';
  }

  function renderTenants() {
    const profileEl  = qs('#tenantProfile');
    const cashflowEl = qs('#tenantCashflow');
    const logEl      = qs('#tenantLog');
    if (!profileEl) return;
    const acc = getCurrentAccount();
    if (!acc) {
      profileEl.innerHTML = '';
      if (cashflowEl) cashflowEl.innerHTML = '';
      if (logEl) logEl.innerHTML = '';
      return;
    }
    const tenant      = acc.tenant || {};
    const transactions = acc.transactions || [];
    const isOccupied  = !!(tenant.name && tenant.name.trim());

    let leaseWarning = '';
    if (tenant.leaseEnd) {
      const daysLeft = Math.floor((new Date(tenant.leaseEnd + '-01') - new Date()) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 60) leaseWarning = `<span class="lease-warning">⚠ ${daysLeft}d left</span>`;
      else if (daysLeft < 0) leaseWarning = `<span class="lease-expired">Expired</span>`;
    }

    profileEl.innerHTML = `
      <div class="tenant-profile-card">
        <div class="tenant-profile-main">
          <span class="tenant-status-badge tenant-status-${isOccupied ? 'occupied' : 'vacant'}">${isOccupied ? '● Occupied' : '○ Vacant'}</span>
          ${isOccupied ? `
            <div class="tenant-name">${tenant.name}</div>
            ${tenant.phone ? `<div class="tenant-meta">${tenant.phone}</div>` : ''}
            <div class="tenant-meta-row">
              ${tenant.moveIn ? `<span>Since ${formatMonthYear(tenant.moveIn)}</span>` : ''}
              ${tenant.leaseEnd ? `<span>Lease end: ${formatMonthYear(tenant.leaseEnd)} ${leaseWarning}</span>` : ''}
            </div>
            ${tenant.rentAmount ? `<div class="tenant-rent">₹${Number(tenant.rentAmount).toLocaleString('en-IN')}<span class="tenant-rent-period">/month</span></div>` : ''}
            ${tenant.deposit ? `<div class="tenant-meta">Deposit: ₹${Number(tenant.deposit).toLocaleString('en-IN')}</div>` : ''}
          ` : '<div class="tenant-vacant-hint">No tenant — tap Edit to add details</div>'}
        </div>
        <button class="tenant-edit-btn" id="editTenantBtn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
      </div>
    `;
    qs('#editTenantBtn').addEventListener('click', () => openTenantModal());

    function fmtT(v) {
      const n = Math.abs(Number(v));
      if (n >= 100000) return '₹' + (n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + 'L';
      return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }
    const totalIncome   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const net = totalIncome - totalExpenses;

    cashflowEl.innerHTML = `
      <div class="summary-cards-row">
        <div class="summary-card">
          <div class="summary-card-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b9080" stroke-width="2.2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Rent Received
          </div>
          <div class="summary-card-value" style="color:#6b9080">${fmtT(totalIncome)}</div>
          <div class="summary-card-trend"><span class="trend-flat">all time</span></div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e07a5f" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Expenses
          </div>
          <div class="summary-card-value" style="color:#e07a5f">${fmtT(totalExpenses)}</div>
          <div class="summary-card-trend"><span class="trend-flat">all time</span></div>
        </div>
      </div>
      <div class="summary-cards-row">
        <div class="summary-card">
          <div class="summary-card-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${net >= 0 ? '#6b9080' : '#e07a5f'}" stroke-width="2.2" stroke-linecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            Net Cash Flow
          </div>
          <div class="summary-card-value" style="color:${net >= 0 ? '#6b9080' : '#e07a5f'}">${net < 0 ? '−' : ''}${fmtT(net)}</div>
          <div class="summary-card-trend"><span class="trend-flat">income − expenses</span></div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#607d8b" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="#607d8b" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="#607d8b" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="#607d8b" stroke="none"/></svg>
            Transactions
          </div>
          <div class="summary-card-value" style="color:#607d8b">${transactions.length}</div>
          <div class="summary-card-trend"><span class="trend-flat">total logged</span></div>
        </div>
      </div>
    `;

    const sorted = transactions.slice().sort((a, b) => {
      if (a.date < b.date) return 1;   // b is newer → show b first
      if (a.date > b.date) return -1;  // a is newer → show a first
      // Same date: most recently added (higher index) first
      return transactions.indexOf(b) - transactions.indexOf(a);
    });
    if (sorted.length === 0) {
      logEl.innerHTML = `<div class="tenant-empty">No transactions yet — tap <strong>+ Add</strong> to log rent or expenses.</div>`;
    } else {
      logEl.innerHTML = sorted.map(t => `
        <div class="txn-row">
          <div class="txn-left">
            <div class="txn-date">${formatMonthYear(t.date)}</div>
            <div class="txn-cat">${categoryLabel(t.category)}</div>
            ${t.notes ? `<div class="txn-notes-label">${t.notes}</div>` : ''}
          </div>
          <div class="txn-right">
            <div class="txn-amount txn-${t.type}">${t.type === 'income' ? '+' : '−'}${fmtT(Number(t.amount))}</div>
            <button class="txn-del" data-id="${t.id}" title="Delete">✕</button>
          </div>
        </div>
      `).join('');
      logEl.querySelectorAll('.txn-del').forEach(btn => {
        btn.addEventListener('click', () => removeTransaction(btn.dataset.id));
      });
    }
  }

  function openTenantModal() {
    const acc = getCurrentAccount(); if (!acc) return;
    const t = acc.tenant || {};
    qs('#tName').value    = t.name       || '';
    qs('#tPhone').value   = t.phone      || '';
    qs('#tMoveIn').value  = t.moveIn     || '';
    qs('#tLeaseEnd').value = t.leaseEnd  || '';
    qs('#tRent').value    = t.rentAmount || '';
    qs('#tDeposit').value = t.deposit    || '';
    qs('#tenantModal').classList.add('active');
  }

  async function addTransaction(obj) {
    const acc = getCurrentAccount(); if (!acc) return showToast('No account selected', 'error');
    if (!acc.transactions) acc.transactions = [];
    acc.transactions.push(Object.assign({ id: uid() }, obj));
    await save(data);
    renderTenants();
    showToast('Transaction saved ✓', 'success');
  }

  async function removeTransaction(txnId) {
    const acc = getCurrentAccount(); if (!acc) return;
    if (!await showConfirm('Delete this transaction?', { icon: '🗑️', okLabel: 'Delete' })) return;
    acc.transactions = (acc.transactions || []).filter(t => t.id !== txnId);
    await save(data);
    renderTenants();
    showToast('Transaction deleted', 'success');
  }

  async function saveTenantProfile(profile) {
    const acc = getCurrentAccount(); if (!acc) return;
    acc.tenant = Object.assign(acc.tenant || {}, profile);
    await save(data);
    renderTenants();
    showToast('Tenant profile saved ✓', 'success');
  }

  function updateChart(){
    const acc = getCurrentAccount();
    const canvas = qs('#loanChart');
    
    if(!canvas) {
      return;
    }
    
    // CRITICAL: Always destroy existing chart first to prevent memory leaks
    if(chart){ 
      try {
        chart.destroy();
      } catch(e) {
        console.error('Error destroying chart:', e);
      }
      chart = null;
    }
    
    // If no account or no entries, leave chart empty
    if(!acc || !acc.entries || acc.entries.length === 0){ 
      return;
    }
    
    const rows = acc.entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    
    if(rows.length === 0) return;
    
    // Group entries by month first
    const groupedByMonth = {};
    rows.forEach(entry=>{
      const monthKey = entry.date.substring(0, 7);
      if(!groupedByMonth[monthKey]) groupedByMonth[monthKey] = [];
      groupedByMonth[monthKey].push(entry);
    });

    const monthKeys = Object.keys(groupedByMonth).sort();
    const numMonths = monthKeys.length;

    // Auto-aggregate: monthly ≤24pts, quarterly ≤60pts, yearly beyond
    const useQuarterly = numMonths > 24 && numMonths <= 60;
    const useYearly    = numMonths > 60;

    function bucketKey(monthKey) {
      const [y, m] = monthKey.split('-').map(Number);
      if (useYearly)    return `${y}`;
      if (useQuarterly) return `${y}-Q${Math.ceil(m / 3)}`;
      return monthKey;
    }

    function bucketLabel(key) {
      if (useYearly)    return key;
      if (useQuarterly) return key.replace('-', ' ');
      const [y, m] = key.split('-');
      const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${names[parseInt(m)-1]} ${y}`;
    }

    // Aggregate monthly data into buckets
    const buckets = {};
    monthKeys.forEach(mk => {
      const bk = bucketKey(mk);
      if (!buckets[bk]) buckets[bk] = { interest: 0, balance: null, payment: 0, withdrawal: 0, count: 0 };
      const b = buckets[bk];
      const monthEntries = groupedByMonth[mk];
      const primary = monthEntries.find(e => e.principal === null || e.principal === undefined) || monthEntries[0];
      b.interest += primary.interest || 0;
      // For quarterly/yearly, use the last balance in the bucket
      if (primary.balance !== null && primary.balance !== undefined) b.balance = primary.balance;
      monthEntries.forEach(e => {
        if (e.principal && e.principalType !== 'withdrawal') b.payment += e.principal;
        if (e.principal && e.principalType === 'withdrawal') b.withdrawal += e.principal;
      });
      b.count++;
    });

    // For quarterly/yearly, interest should be averaged (avg monthly cost), not summed
    if (useQuarterly || useYearly) {
      Object.values(buckets).forEach(b => { b.interest = b.interest / b.count; });
    }

    // Build chart arrays
    const labels = [];
    const interestData = [];
    const balanceData = [];
    const paymentBubbles = [];
    const withdrawalBubbles = [];

    Object.keys(buckets).sort().forEach(bk => {
      const b = buckets[bk];
      labels.push(bucketLabel(bk));
      interestData.push(b.interest);
      balanceData.push(b.balance);
      const net = b.payment - b.withdrawal;
      if (net > 0)      { paymentBubbles.push(b.interest); withdrawalBubbles.push(null); }
      else if (net < 0) { paymentBubbles.push(null); withdrawalBubbles.push(b.interest); }
      else              { paymentBubbles.push(null); withdrawalBubbles.push(null); }
    });

    const datasets = [
      {
        label:'Interest paid', 
        data:interestData, 
        borderColor:'#607d8b',
        backgroundColor:'rgba(96,125,139,0.72)',
        yAxisID:'y', 
        type:'bar',
        borderRadius:4,
        borderSkipped:false,
        order:2
      }
    ];

    // Add payment markers (downward triangles) - only if there are any payments
    const hasPayments = paymentBubbles.some(v => v !== null);
    if(hasPayments) {
      datasets.push({
        label:'Payment',
        data:paymentBubbles,
        type:'line',
        showLine:false,
        pointStyle:'triangle',
        pointRotation:180,
        pointRadius:paymentBubbles.map(v => v === null ? 0 : 6),
        pointHoverRadius:paymentBubbles.map(v => v === null ? 0 : 8),
        pointBackgroundColor:'#6b9080',
        pointBorderColor:'#fff',
        pointBorderWidth:1.5,
        yAxisID:'y',
        order:1
      });
    }

    // Add withdrawal markers (upward triangles) - only if there are any withdrawals
    const hasWithdrawals = withdrawalBubbles.some(v => v !== null);
    if(hasWithdrawals) {
      datasets.push({
        label:'Withdrawal',
        data:withdrawalBubbles,
        type:'line',
        showLine:false,
        pointStyle:'triangle',
        pointRotation:0,
        pointRadius:withdrawalBubbles.map(v => v === null ? 0 : 6),
        pointHoverRadius:withdrawalBubbles.map(v => v === null ? 0 : 8),
        pointBackgroundColor:'#c09a6b',
        pointBorderColor:'#fff',
        pointBorderWidth:1.5,
        yAxisID:'y',
        order:1
      });
    }

    // Add balance line on secondary axis - only if there is any balance data
    const hasBalance = balanceData.some(v => v !== null);
    if(hasBalance) {
      datasets.push({
        label:'Balance',
        data:balanceData,
        type:'line',
        borderColor:'#9d8189',
        backgroundColor:'rgba(157,129,137,0.07)',
        yAxisID:'y1',
        fill:true,
        tension:0.35,
        borderWidth:2.5,
        pointRadius:2,
        pointHoverRadius:4,
        pointBackgroundColor:'#9d8189',
        pointBorderColor:'#fff',
        pointBorderWidth:1.5,
        spanGaps:true,
        order:0
      });
    }

    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      const lineDotsLegendPlugin = {
        id: 'lineDotsLegend',
        afterDraw(ch) {
          const legend = ch.legend;
          if (!legend || !legend.legendItems) return;
          const c = ch.ctx;
          legend.legendItems.forEach((item, i) => {
            const ds = ch.data.datasets[item.datasetIndex];
            if (!ds || ds.type !== 'line') return;
            const hb = legend.legendHitBoxes[i];
            if (!hb) return;
            const cx = hb.left + hb.width / 2;
            const cy = hb.top + hb.height / 2;
            const color = typeof ds.borderColor === 'string' ? ds.borderColor : '#9d8189';
            c.save();
            c.fillStyle = color;
            const r = 3;
            // Draw one dot centred on the line indicator (first 40px of hitbox, not the text)
            c.beginPath();
            c.arc(hb.left + 20, cy, r, 0, Math.PI * 2);
            c.fill();
            c.restore();
          });
        }
      };
      chart = new Chart(ctx, {
        type:'bar', 
        data:{labels:labels, datasets:datasets}, 
        plugins:[lineDotsLegendPlugin],
        options:{
          responsive:false,
          maintainAspectRatio:false,
          animation: false,
          plugins: {
            legend: {
              display: true,
              labels: {
                filter: item => item.text !== 'Payment' && item.text !== 'Withdrawal',
                usePointStyle: true,
                pointStyleWidth: 40,
                generateLabels: function(chart) {
                  return Chart.defaults.plugins.legend.labels.generateLabels(chart).map(item => {
                    const ds = chart.data.datasets[item.datasetIndex];
                    if (ds && ds.type === 'line') {
                      item.pointStyle = 'line';
                      item.strokeStyle = ds.borderColor;
                      item.lineWidth = 2.5;
                    } else {
                      item.pointStyle = 'rect';
                    }
                    return item;
                  }).filter(item => item.text !== 'Payment' && item.text !== 'Withdrawal');
                }
              }
            }
          },
          interaction:{mode:'index',intersect:false},
          scales:{
            x:{
              ticks:{
                callback: function(val, idx) {
                  // Monthly: show every 3rd to avoid crowding; quarterly/yearly: show all
                  const total = this.chart.data.labels.length;
                  const step = total > 36 ? 1 : total > 24 ? 1 : 3;
                  return idx % step === 0 ? this.getLabelForValue(val) : '';
                },
                maxRotation: 45,
                minRotation: 45
              }
            },
            y:{
              type:'linear',
              position:'left',
              title:{display:true,text: useYearly ? 'Avg Monthly Interest (₹)' : useQuarterly ? 'Avg Monthly Interest (₹)' : 'Interest (₹)'},
              beginAtZero: true,
              max: 80000,
              grid:{color:'rgba(0,0,0,0.05)'},
              ticks:{
                callback: v => v >= 1000 ? (v/1000) + 'K' : v
              }
            },
            y1:{
              type:'linear',
              position:'right',
              title:{display:true,text:'Balance (₹)'},
              grid:{drawOnChartArea:false},
              beginAtZero: false,
              ticks:{
                callback: v => (v/100000).toLocaleString('en-IN',{maximumFractionDigits:1}) + 'L'
              }
            }
          }
        }
      });
    } catch(err) {
      console.error('Error creating chart:', err);
    }
  }

  // --- events ---
  document.addEventListener('DOMContentLoaded',()=>{
    // Toggle top section (account selector + form) collapse
    qs('#toggleTopSection').addEventListener('click',()=>{
      const topSection = qs('#topSection');
      topSection.classList.add('collapsed');
      // Trigger chart resize after animation completes
      setTimeout(() => {
        if(chart) {
          chart.resize();
        }
      }, 300);
    });

    // Expand top section
    qs('#expandTopSection').addEventListener('click',()=>{
      const topSection = qs('#topSection');
      topSection.classList.remove('collapsed');
      // Trigger chart resize after animation completes
      setTimeout(() => {
        if(chart) {
          chart.resize();
        }
      }, 300);
    });

    // Open settings modal
    qs('#openSettings').addEventListener('click',()=>{
      qs('#settingsModal').classList.add('active');
    });

    // Close modal
    qs('#closeModal').addEventListener('click',()=>{
      qs('#settingsModal').classList.remove('active');
    });

    // Close modal when clicking outside
    qs('#settingsModal').addEventListener('click',(e)=>{
      if(e.target.id === 'settingsModal') {
        qs('#settingsModal').classList.remove('active');
      }
    });

    // Toggle entries section collapse
    qs('#toggleEntries').addEventListener('click',()=>{
      const entriesSection = qs('#entriesSection');
      entriesSection.classList.toggle('collapsed');
      // Trigger chart resize after animation completes
      setTimeout(() => {
        if(chart) {
          chart.resize();
        }
      }, 300);
    });

    // wire up create account
    qs('#createAccount').addEventListener('click',()=>{
      const name = qs('#accountName').value.trim(); if(!name) return showToast('Enter an account name', 'error'); createAccount(name); qs('#accountName').value='';
    });

    qs('#selectAccount').addEventListener('change',(e)=>{ 
      currentAccountId = e.target.value;
      const mobSel = qs('#mobileSelectAccount');
      if(mobSel) mobSel.value = e.target.value;
      renderEntries(); renderSummaryCards(); renderLoanProgress(); updateChart();
    });
    
    // Auto-fill interest when month is selected (if entry exists for that month)
    qs('#entryDate').addEventListener('change',(e)=>{
      const selectedMonth = e.target.value.substring(0, 7); // YYYY-MM
      if(!selectedMonth) return;
      
      const btn = qs('#entryForm button[type="submit"]');
      // Only auto-fill if in ADD mode (not editing)
      if(btn.dataset.editId) return;
      
      const acc = getCurrentAccount();
      if(!acc || !acc.entries) return;
      
      // Find existing entries for this month
      const existingEntry = acc.entries.find(e => e.date && e.date.substring(0, 7) === selectedMonth);
      if(existingEntry && existingEntry.interest) {
        qs('#interestPaid').value = existingEntry.interest;
      }
      if(existingEntry && existingEntry.balance !== null && existingEntry.balance !== undefined) {
        qs('#balance').value = existingEntry.balance;
      }
    });
    
    qs('#deleteAccount').addEventListener('click',()=>{ 
      if(!currentAccountId) return; 
      deleteAccount(currentAccountId);
      qs('#settingsModal').classList.remove('active'); // Close modal after delete
    });

    qs('#entryForm').addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const btn = ev.target.querySelector('button[type="submit"]');
      const editId = btn.dataset.editId;
      
      const date = qs('#entryDate').value.substring(0, 7); if(!date) return showToast('Select a month & year', 'error'); // Ensure YYYY-MM format
      const interest = parseFloat(qs('#interestPaid').value) || 0;
      const principalRaw = qs('#principalAmount').value; 
      const principal = principalRaw===''?null:parseFloat(principalRaw);
      const principalType = qs('#isWithdrawal').checked ? 'withdrawal' : 'payment';
      const notes = qs('#notes').value;
      const balanceRaw = qs('#balance').value;
      const balance = balanceRaw === '' ? null : parseFloat(balanceRaw);
      
      if(editId) {
        // Update existing entry
        const updateObj = {date:date, interest:interest, principal:principal, notes:notes, balance:balance};
        if(principal !== null && principal !== undefined) {
          updateObj.principalType = principalType;
        }
        await updateEntry(editId, updateObj);
        btn.textContent = 'Add Entry';
        btn.style.background = '#607d8b';
        delete btn.dataset.editId;
        // Hide cancel button
        const cancelBtn = qs('#cancelEdit');
        if(cancelBtn) cancelBtn.style.display = 'none';
        showToast('Entry updated ✓', 'success');
      } else {
        // ADD MODE
        // Rule: interest + balance live on ONE primary entry per month (principal === null).
        //       Principal payments are separate transaction entries (interest=0, balance=null).
        //       This prevents interest from being double-counted across multiple transactions.
        const acc = getCurrentAccount();
        if(!acc) return showToast('No account selected', 'error');
        acc.entries = acc.entries || [];

        // Primary entry = the entry for this month that has no principal
        const primaryEntry = acc.entries.find(e =>
          e.date && e.date.substring(0, 7) === date &&
          (e.principal === null || e.principal === undefined)
        );

        if(principal !== null && principal !== undefined) {
          // PRINCIPAL TRANSACTION
          // 1. Keep the primary entry's interest & balance up-to-date
          if(primaryEntry) {
            primaryEntry.interest = interest;
            primaryEntry.balance = balance;
          } else {
            acc.entries.push({id:uid(), date:date, interest:interest, balance:balance, notes:'', principal:null});
          }
          // 2. Add a new transaction entry — principal only, interest=0 so it is never double-counted
          acc.entries.push({id:uid(), date:date, interest:0, principal:principal, principalType:principalType, notes:notes, balance:null});
        } else {
          // NO PRINCIPAL: upsert the primary entry (interest + balance + notes)
          if(primaryEntry) {
            primaryEntry.interest = interest;
            primaryEntry.balance = balance;
            primaryEntry.notes = notes;
          } else {
            acc.entries.push({id:uid(), date:date, interest:interest, balance:balance, notes:notes, principal:null});
          }
        }

        await save(data);
        renderAll();
        showToast('Entry added ✓', 'success');
      } 
      qs('#interestPaid').value=''; 
      qs('#principalAmount').value=''; 
      qs('#isWithdrawal').checked = false;
      qs('#notes').value='';
      qs('#balance').value='';
    });

    qs('#entriesTable').addEventListener('click',(e)=>{
      // Sort header click
      const th = e.target.closest('th[data-sort]');
      if(th) {
        const col = th.dataset.sort;
        if(sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
        else { sortCol = col; sortDir = col === 'month' ? 'desc' : 'desc'; }
        renderEntries();
        return;
      }
      if(e.target.matches('.delEntry')){
        const id = e.target.getAttribute('data-id'); 
        if(!id) return; 
        showConfirm('Delete this entry? This cannot be undone.', { icon:'🗑️', okLabel:'Delete Entry' }).then(ok => { if(ok) removeEntry(id); });
      }
      if(e.target.matches('.editEntry')){
        const id = e.target.getAttribute('data-id'); 
        if(!id) return; 
        const acc = getCurrentAccount();
        if(!acc) return;
        const entry = acc.entries.find(e=>e.id===id);
        if(!entry) return;
        
        // Populate form with existing values
        // Ensure date is in YYYY-MM format for month input
        let dateValue = entry.date;
        if (dateValue && dateValue.length > 7) {
          dateValue = dateValue.substring(0, 7); // Keep only YYYY-MM
        }
        qs('#entryDate').value = dateValue;
        qs('#interestPaid').value = entry.interest;
        const principalValue = entry.principal !== null && entry.principal !== undefined ? entry.principal : (entry.remaining !== null && entry.remaining !== undefined ? entry.remaining : '');
        qs('#principalAmount').value = principalValue;
        qs('#isWithdrawal').checked = entry.principalType === 'withdrawal';
        qs('#notes').value = entry.notes || '';
        qs('#balance').value = entry.balance !== null && entry.balance !== undefined ? entry.balance : '';
        
        // Change submit button to update mode
        const form = qs('#entryForm');
        const btn = form.querySelector('button[type="submit"]');
        btn.textContent = 'Update Entry';
        btn.style.background = '#c09a6b';
        btn.dataset.editId = id;
        
        // Add cancel button if it doesn't exist
        let cancelBtn = qs('#cancelEdit');
        if(!cancelBtn) {
          cancelBtn = document.createElement('button');
          cancelBtn.id = 'cancelEdit';
          cancelBtn.type = 'button';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.style.cssText = 'padding:10px 16px;border:1px solid #6b6f77;background:#fff;color:#6b6f77;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;margin-left:8px';
          cancelBtn.addEventListener('click', () => {
            qs('#entryDate').value = '';
            qs('#interestPaid').value = '';
            qs('#principalAmount').value = '';
            qs('#isWithdrawal').checked = false;
            qs('#notes').value = '';
            qs('#balance').value = '';
            btn.textContent = 'Add Entry';
            btn.style.background = '';
            delete btn.dataset.editId;
            cancelBtn.style.display = 'none';
          });
          btn.closest('.form-actions').appendChild(cancelBtn);
        }
        cancelBtn.style.display = 'inline-block';
        
        // Switch to Add tab on mobile, scroll on desktop
        if(window.innerWidth <= 800) { switchTab('add'); } else { form.scrollIntoView({behavior: 'smooth'}); }
      }
    });

    // CSV Export
    qs('#exportCsv').addEventListener('click', async ()=>{
      try {
        const response = await fetch(`${API_BASE}/export/csv`);
        if (!response.ok) throw new Error('Export failed');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mortgage_diary_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      } catch(e) {
        showToast('Export failed: ' + e.message, 'error');
      }
    });

    // CSV Import
    qs('#importCsv').addEventListener('click', ()=>{
      qs('#csvFileInput').click();
    });

    qs('#csvFileInput').addEventListener('change', async (e)=>{
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const csvData = await file.text();
        const response = await fetch(`${API_BASE}/import/csv`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({csvData})
        });
        
        if (!response.ok) throw new Error('Import failed');
        const result = await response.json();
        showToast(result.message || 'Import successful!', 'success');
        
        // Reload data
        data = await load();
        renderAll();
        e.target.value = '';
      } catch(err) {
        showToast('Import failed: ' + err.message, 'error');
        e.target.value = '';
      }
    });

    // Tenant tab wiring
    qs('#toggleTxnForm').addEventListener('click', () => {
      const form = qs('#txnForm');
      const isVisible = form.style.display !== 'none';
      form.style.display = isVisible ? 'none' : 'block';
      qs('#toggleTxnForm').textContent = isVisible ? '+ Add' : '− Close';
      if (!isVisible) {
        const now = new Date();
        qs('#txnDate').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        updateTxnCategories();
        qs('#txnAmount').value = '';
        qs('#txnNotes').value  = '';
      }
    });
    qs('#cancelTxn').addEventListener('click', () => {
      qs('#txnForm').style.display = 'none';
      qs('#toggleTxnForm').textContent = '+ Add';
    });
    qs('#txnType').addEventListener('change', updateTxnCategories);
    qs('#txnForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const date     = qs('#txnDate').value.substring(0, 7);
      const type     = qs('#txnType').value;
      const category = qs('#txnCategory').value;
      const amount   = parseFloat(qs('#txnAmount').value);
      const notes    = qs('#txnNotes').value.trim();
      if (!date || !amount || amount <= 0) return showToast('Enter a valid month and amount', 'error');
      await addTransaction({ date, type, category, amount, notes });
      qs('#txnAmount').value = '';
      qs('#txnNotes').value  = '';
      qs('#txnForm').style.display = 'none';
      qs('#toggleTxnForm').textContent = '+ Add';
    });
    qs('#closeTenantModal').addEventListener('click', () => qs('#tenantModal').classList.remove('active'));
    qs('#tenantModal').addEventListener('click', e => { if (e.target === qs('#tenantModal')) qs('#tenantModal').classList.remove('active'); });
    qs('#saveTenantProfile').addEventListener('click', async () => {
      await saveTenantProfile({
        name:       qs('#tName').value.trim(),
        phone:      qs('#tPhone').value.trim(),
        moveIn:     qs('#tMoveIn').value,
        leaseEnd:   qs('#tLeaseEnd').value,
        rentAmount: parseFloat(qs('#tRent').value)    || 0,
        deposit:    parseFloat(qs('#tDeposit').value) || 0
      });
      qs('#tenantModal').classList.remove('active');
    });

    // initial render
    applyTheme(currentTheme);
    init();

    // Theme toggle
    qsa('.theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));
    });

    // Mobile tab navigation
    qsa('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // Mobile settings button
    const mobileSettingsBtn = qs('#mobileOpenSettings');
    if(mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', () => qs('#settingsModal').classList.add('active'));
    // Mobile account select
    const mobAccountSel = qs('#mobileSelectAccount');
    if(mobAccountSel) {
      mobAccountSel.addEventListener('change', (e) => {
        currentAccountId = e.target.value;
        qs('#selectAccount').value = e.target.value;
        renderEntries(); renderSummaryCards(); renderLoanProgress(); updateChart(); renderTenants();
      });
    }
    // Set initial tab on mobile
    if(window.innerWidth <= 800) switchTab('analytics');
  });

  // Expose for home dashboard
  window.propfolioGetData = () => data;
  window.propfolioRenderHome = renderHomeDashboard;
})();