const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5001;
const DATA_FILE = path.join(__dirname, 'data', 'mortgage_data.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: [] }));
}

app.use(cors());
app.use(express.json());

// Serve static frontend files (index.html, style.css, app.js, etc.)
app.use(express.static(__dirname));

// Explicit root handler to ensure GET / serves the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Get all data
app.get('/api/data', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (err) {
    console.error('Error reading data:', err);
    res.status(500).json({ error: 'Failed to read data' });
  }
});

// Save all data
app.post('/api/data', (req, res) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving data:', err);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// Export CSV
app.get('/api/export/csv', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let csv = 'Account,Date,Interest Paid,Principal Amount,Type,Notes\n';
    
    data.accounts.forEach(account => {
      (account.entries || []).forEach(entry => {
        const accountName = (account.name || '').replace(/"/g, '""');
        const principal = entry.principal !== null && entry.principal !== undefined ? entry.principal : (entry.remaining !== null && entry.remaining !== undefined ? entry.remaining : '');
        const type = entry.principalType || 'payment';
        const notes = (entry.notes || '').replace(/"/g, '""');
        csv += `"${accountName}","${entry.date}",${entry.interest},${principal},"${type}","${notes}"\n`;
      });
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=mortgage_diary_export.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// Import CSV
app.post('/api/import/csv', (req, res) => {
  try {
    const { csvData } = req.body;
    const lines = csvData.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file is empty or invalid' });
    }
    
    // Skip header
    const dataLines = lines.slice(1);
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const accountMap = new Map();
    
    // Find or create accounts
    data.accounts.forEach(acc => accountMap.set(acc.name, acc));
    
    let skipped = 0;
    let added = 0;
    
    dataLines.forEach(line => {
      // Better CSV parsing - handle quoted fields properly
      const fields = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"' && inQuotes && nextChar === '"') {
          // Double quote escape
          current += '"';
          i++; // skip next quote
        } else if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          fields.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      fields.push(current.trim()); // Push last field
      
      const [accountName, date, interest, principal, type, notes] = fields;
      
      if (!accountName || !date || !interest) return;
      
      let account = accountMap.get(accountName);
      if (!account) {
        account = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          name: accountName,
          entries: []
        };
        data.accounts.push(account);
        accountMap.set(accountName, account);
      }
      
      // Check if entry for this month already exists
      const existingEntry = account.entries.find(e => e.date === date);
      if (existingEntry) {
        skipped++;
        return; // Skip duplicate
      }
      
      account.entries.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        date: date,
        interest: parseFloat(interest) || 0,
        principal: principal ? parseFloat(principal) : null,
        principalType: type || 'payment',
        notes: notes || ''
      });
      added++;
    });
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    const message = `Import complete: ${added} entries added, ${skipped} duplicates skipped`;
    res.json({ success: true, message: message });
  } catch (err) {
    console.error('Error importing CSV:', err);
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

app.listen(PORT, () => {
  console.log(`Mortgage Diary API server running on http://localhost:${PORT}`);
  console.log(`Data stored in: ${DATA_FILE}`);
});
