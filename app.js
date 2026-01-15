(function(){
  const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5001/api' : '/api';

  function uid(){return Date.now().toString(36) + Math.random().toString(36).slice(2,8)}

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
      alert('Failed to save data. Check if the server is running.');
    }
  }

  const qs = sel => document.querySelector(sel);
  const qsa = sel => Array.from(document.querySelectorAll(sel));

  let data = {accounts:[]};
  let currentAccountId = null;
  let chart = null;

  function formatMonthYear(dateStr) {
    // dateStr is YYYY-MM or YYYY-MM-DD
    const [year, month] = dateStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month)-1]} ${year}`;
  }

  function renderAll() {
    renderAccountsList();
    renderEntries();
    updateChart();
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

    if(!currentAccountId && data.accounts.length) currentAccountId = data.accounts[0].id;
    sel.value = currentAccountId || '';
  }

  async function createAccount(name){
    if(!name) return;
    const acc = {id:uid(), name:name, entries:[]};
    data.accounts.push(acc); 
    await save(data); 
    currentAccountId = acc.id; 
    renderAll();
  }

  async function deleteAccount(id){
    if(!id) return;
    const idx = data.accounts.findIndex(a=>a.id===id); if(idx===-1) return;
    if(!confirm('Delete account "'+data.accounts[idx].name+'" and its entries?')) return;
    data.accounts.splice(idx,1); 
    await save(data); 
    currentAccountId = data.accounts[0]?data.accounts[0].id:null; 
    renderAll();
  }

  function getCurrentAccount(){return data.accounts.find(a=>a.id===currentAccountId)}

  function renderEntries(){
    const tbl = qs('#entriesTable tbody'); tbl.innerHTML='';
    const acc = getCurrentAccount(); if(!acc) return;
    const rows = (acc.entries||[]).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    
    // Group entries by month
    const groupedByMonth = {};
    rows.forEach(entry=>{
      const monthKey = entry.date.substring(0, 7); // YYYY-MM
      if(!groupedByMonth[monthKey]) {
        groupedByMonth[monthKey] = [];
      }
      groupedByMonth[monthKey].push(entry);
    });
    
    // Render grouped entries
    Object.keys(groupedByMonth).sort().forEach(monthKey => {
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
        
        tr.innerHTML = `
          <td><strong>${monthYear}</strong></td>
          <td>${entry.interest.toFixed(2)}</td>
          <td>${principalVal}</td>
          <td>${typeCell}</td>
          <td>${entry.notes||''}</td>
          <td>
            <button data-id="${entry.id}" class="editEntry" title="Edit entry">✎</button>
            <button data-id="${entry.id}" class="delEntry" title="Delete entry">✕</button>
          </td>`;
        tbl.appendChild(tr);
        return; // Skip the grouped rendering
      }
      
      // Multiple entries: show grouped with expand/collapse
      // Calculate totals for the month
      const totalInterest = monthEntries.reduce((sum, e) => sum + e.interest, 0);
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
      
      headerRow.innerHTML = `
        <td><span class="expand-icon">${monthEntries.length > 1 ? '▶' : '\u00a0\u00a0'}</span> <strong>${monthYear}</strong></td>
        <td><strong>${totalInterest.toFixed(2)}</strong></td>
        <td colspan="2">${netDisplay}</td>
        <td><em>${monthEntries.length} transaction${monthEntries.length > 1 ? 's' : ''}</em></td>
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
        
        tr.innerHTML = `
          <td style="padding-left:30px">${entry.notes||'(transaction)'}</td>
          <td>${entry.interest.toFixed(2)}</td>
          <td>${principalVal}</td>
          <td>${typeCell}</td>
          <td></td>
          <td>
            <button data-id="${entry.id}" class="editEntry" title="Edit entry">✎</button>
            <button data-id="${entry.id}" class="delEntry" title="Delete entry">✕</button>
          </td>`;
        tbl.appendChild(tr);
      });
    });
  }

  async function addEntry(obj){
    const acc = getCurrentAccount(); if(!acc) return alert('No account selected');
    acc.entries = acc.entries || [];
    acc.entries.push(Object.assign({id:uid()}, obj));
    await save(data); 
    renderAll();
  }

  async function removeEntry(entryId){
    const acc = getCurrentAccount(); if(!acc) return;
    const idx = acc.entries.findIndex(e=>e.id===entryId); if(idx===-1) return; 
    acc.entries.splice(idx,1); 
    await save(data); 
    renderAll();
  }

  async function updateEntry(entryId, updates){
    const acc = getCurrentAccount(); if(!acc) return;
    const entry = acc.entries.find(e=>e.id===entryId);
    if(!entry) return;
    Object.assign(entry, updates);
    await save(data);
    renderAll();
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
    
    // Group entries by month for aggregation
    const groupedByMonth = {};
    rows.forEach(entry=>{
      const monthKey = entry.date.substring(0, 7); // YYYY-MM
      if(!groupedByMonth[monthKey]) {
        groupedByMonth[monthKey] = [];
      }
      groupedByMonth[monthKey].push(entry);
    });
    
    // Create arrays for chart with one point per month
    const labels = [];
    const interestData = [];
    const paymentBubbles = [];
    const withdrawalBubbles = [];
    
    Object.keys(groupedByMonth).sort().forEach(monthKey => {
      const monthEntries = groupedByMonth[monthKey];
      
      // Use the first entry's interest (interest is paid once per month, not per transaction)
      const monthInterest = monthEntries[0].interest;
      
      // Calculate net payment/withdrawal
      const totalPayment = monthEntries.reduce((sum, e) => {
        if(e.principal && e.principalType !== 'withdrawal') return sum + e.principal;
        return sum;
      }, 0);
      const totalWithdrawal = monthEntries.reduce((sum, e) => {
        if(e.principal && e.principalType === 'withdrawal') return sum + e.principal;
        return sum;
      }, 0);
      const netPrincipal = totalPayment - totalWithdrawal;
      
      labels.push(formatMonthYear(monthKey));
      interestData.push(monthInterest);
      
      // Show bubble based on net amount
      if(netPrincipal > 0) {
        paymentBubbles.push(monthInterest);
        withdrawalBubbles.push(null);
      } else if(netPrincipal < 0) {
        paymentBubbles.push(null);
        withdrawalBubbles.push(monthInterest);
      } else {
        paymentBubbles.push(null);
        withdrawalBubbles.push(null);
      }
    });

    const datasets = [
      {
        label:'Interest paid', 
        data:interestData, 
        borderColor:'#2b6df6', 
        backgroundColor:'rgba(43,109,246,0.06)', 
        yAxisID:'y', 
        fill:false, 
        type:'line',
        pointRadius:3,
        pointHoverRadius:5
      }
    ];

    // Add payment markers (green bubbles) - only if there are any payments
    const hasPayments = paymentBubbles.some(v => v !== null);
    if(hasPayments) {
      datasets.push({
        label:'Payment',
        data:paymentBubbles,
        backgroundColor:'#27ae60',
        pointBackgroundColor:'#27ae60',
        pointBorderColor:'#fff',
        pointBorderWidth:2,
        pointRadius:paymentBubbles.map(v => v === null ? 0 : 10),
        pointHoverRadius:paymentBubbles.map(v => v === null ? 0 : 12),
        yAxisID:'y',
        showLine:false
      });
    }

    // Add withdrawal markers (orange bubbles) - only if there are any withdrawals
    const hasWithdrawals = withdrawalBubbles.some(v => v !== null);
    if(hasWithdrawals) {
      datasets.push({
        label:'Withdrawal',
        data:withdrawalBubbles,
        backgroundColor:'#e67e22',
        pointBackgroundColor:'#e67e22',
        pointBorderColor:'#fff',
        pointBorderWidth:2,
        pointRadius:withdrawalBubbles.map(v => v === null ? 0 : 10),
        pointHoverRadius:withdrawalBubbles.map(v => v === null ? 0 : 12),
        yAxisID:'y',
        showLine:false
      });
    }

    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      chart = new Chart(ctx, {
        type:'line', 
        data:{labels:labels, datasets:datasets}, 
        options:{
          responsive:false,
          maintainAspectRatio:false,
          animation: false,
          plugins: {
            legend: {
              display: true
            }
          },
          interaction:{mode:'index',intersect:false},
          scales:{
            y:{
              type:'linear',
              position:'left',
              title:{display:true,text:'Interest'},
              beginAtZero: false
            },
            y1:{
              type:'linear',
              position:'right',
              title:{display:true,text:'Principal'},
              grid:{drawOnChartArea:false},
              beginAtZero: false
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
      const name = qs('#accountName').value.trim(); if(!name) return alert('Enter account name'); createAccount(name); qs('#accountName').value='';
    });

    qs('#selectAccount').addEventListener('change',(e)=>{ currentAccountId = e.target.value; renderEntries(); updateChart(); });
    
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
    });
    
    qs('#deleteAccount').addEventListener('click',()=>{ 
      if(!currentAccountId) return; 
      deleteAccount(currentAccountId);
      qs('#settingsModal').classList.remove('active'); // Close modal after delete
    });

    qs('#entryForm').addEventListener('submit',(ev)=>{
      ev.preventDefault();
      const btn = ev.target.querySelector('button[type="submit"]');
      const editId = btn.dataset.editId;
      
      const date = qs('#entryDate').value.substring(0, 7); if(!date) return alert('Select month & year'); // Ensure YYYY-MM format
      const interest = parseFloat(qs('#interestPaid').value) || 0;
      const principalRaw = qs('#principalAmount').value; 
      const principal = principalRaw===''?null:parseFloat(principalRaw);
      const principalType = qs('#isWithdrawal').checked ? 'withdrawal' : 'payment';
      const notes = qs('#notes').value;
      
      if(editId) {
        // Update existing entry
        const updateObj = {date:date, interest:interest, principal:principal, notes:notes};
        if(principal !== null && principal !== undefined) {
          updateObj.principalType = principalType;
        }
        updateEntry(editId, updateObj);
        btn.textContent = 'Add Entry';
        btn.style.background = '#2b6df6';
        delete btn.dataset.editId;
        // Hide cancel button
        const cancelBtn = qs('#cancelEdit');
        if(cancelBtn) cancelBtn.style.display = 'none';
      } else {
        // Add new entry
        const addObj = {date:date, interest:interest, principal:principal, notes:notes};
        if(principal !== null && principal !== undefined) {
          addObj.principalType = principalType;
        }
        addEntry(addObj);
      }
      
      qs('#entryDate').value=''; 
      qs('#interestPaid').value=''; 
      qs('#principalAmount').value=''; 
      qs('#isWithdrawal').checked = false;
      qs('#notes').value='';
    });

    qs('#entriesTable').addEventListener('click',(e)=>{
      if(e.target.matches('.delEntry')){
        const id = e.target.getAttribute('data-id'); 
        if(!id) return; 
        if(confirm('Delete entry?')) removeEntry(id);
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
        
        // Change submit button to update mode
        const form = qs('#entryForm');
        const btn = form.querySelector('button[type="submit"]');
        btn.textContent = 'Update Entry';
        btn.style.background = '#e67e22';
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
            btn.textContent = 'Add Entry';
            btn.style.background = '';
            delete btn.dataset.editId;
            cancelBtn.style.display = 'none';
          });
          btn.parentNode.appendChild(cancelBtn);
        }
        cancelBtn.style.display = 'inline-block';
        
        // Scroll to form
        form.scrollIntoView({behavior: 'smooth'});
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
        alert('Failed to export CSV: ' + e.message);
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
        alert(result.message || 'Import successful!');
        
        // Reload data
        data = await load();
        renderAll();
        e.target.value = '';
      } catch(err) {
        alert('Failed to import CSV: ' + err.message);
        e.target.value = '';
      }
    });

    // initial render
    init();
  });
})();