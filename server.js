const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5001;

// ── Storage abstraction ──────────────────────────────────────────────────────
// When AZURE_STORAGE_CONNECTION_STRING is set → use Blob Storage (production)
// Otherwise → fall back to local JSON file (local dev)
const USE_BLOB = !!process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME        = process.env.AZURE_STORAGE_CONTAINER        || 'mortgage-data';
const BUDGET_CONTAINER_NAME = process.env.AZURE_BUDGET_STORAGE_CONTAINER || 'budget-data';
const BLOB_NAME      = 'mortgage_data.json';
const DATA_FILE      = path.join(__dirname, 'data', 'mortgage_data.json');

// ── Budget data ────────────────────────────────────────────────────────────
// Uses a separate container (AZURE_BUDGET_STORAGE_CONTAINER, default: budget-data)
const BUDGET_FILE       = path.join(__dirname, 'data', 'budget_data.json');
const BUDGET_BLOB_NAME  = 'budget_data.json';
const BUDGET_EMPTY      = { categories: [], months: {} };
let budgetBlobClient;

let blockBlobClient;

if (USE_BLOB) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
  );

  // Mortgage container
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
  blockBlobClient = containerClient.getBlockBlobClient(BLOB_NAME);
  containerClient.createIfNotExists()
    .then(() => console.log(`Blob container "${CONTAINER_NAME}" ready`))
    .catch(e => console.error('Blob container init error:', e));

  // Budget container (separate)
  const budgetContainerClient = blobServiceClient.getContainerClient(BUDGET_CONTAINER_NAME);
  budgetBlobClient = budgetContainerClient.getBlockBlobClient(BUDGET_BLOB_NAME);
  budgetContainerClient.createIfNotExists()
    .then(() => console.log(`Blob container "${BUDGET_CONTAINER_NAME}" ready`))
    .catch(e => console.error('Budget blob container init error:', e));

  console.log('Storage: Azure Blob Storage');
} else {
  // Local file fallback
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: [] }));
  if (!fs.existsSync(BUDGET_FILE)) fs.writeFileSync(BUDGET_FILE, JSON.stringify(BUDGET_EMPTY, null, 2));
  console.log(`Storage: local file (${DATA_FILE})`);
}

async function readBudget() {
  if (USE_BLOB) {
    try {
      const buffer = await budgetBlobClient.downloadToBuffer();
      return JSON.parse(buffer.toString('utf8'));
    } catch (e) {
      if (e.statusCode === 404) return { ...BUDGET_EMPTY };
      throw e;
    }
  }
  if (!fs.existsSync(BUDGET_FILE)) return { ...BUDGET_EMPTY };
  return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
}
async function writeBudget(data) {
  const json = JSON.stringify(data, null, 2);
  if (USE_BLOB) {
    const buf = Buffer.from(json, 'utf8');
    await budgetBlobClient.upload(buf, buf.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    });
  } else {
    fs.writeFileSync(BUDGET_FILE, json);
  }
}

async function readData() {
  if (USE_BLOB) {
    const buffer = await blockBlobClient.downloadToBuffer();
    return JSON.parse(buffer.toString('utf8'));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

async function writeData(data) {
  const json = JSON.stringify(data, null, 2);
  if (USE_BLOB) {
    const buf = Buffer.from(json, 'utf8');
    await blockBlobClient.upload(buf, buf.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    });
  } else {
    fs.writeFileSync(DATA_FILE, json);
  }
}
// ────────────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Serve static frontend files (index.html, style.css, app.js, etc.)
app.use(express.static(__dirname));

// Root serves the SPA (single-page app combining home, property, and budget)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Get all data
app.get('/api/data', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch (err) {
    console.error('Error reading data:', err);
    res.status(500).json({ error: 'Failed to read data' });
  }
});

// Save all data
app.post('/api/data', async (req, res) => {
  try {
    await writeData(req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving data:', err);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// Export CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    const data = await readData();
    let csv = 'Account,Date,Interest Paid,Principal Amount,Type,Notes,Balance\n';
    
    data.accounts.forEach(account => {
      (account.entries || []).forEach(entry => {
        const accountName = (account.name || '').replace(/"/g, '""');
        const principal = entry.principal !== null && entry.principal !== undefined ? entry.principal : (entry.remaining !== null && entry.remaining !== undefined ? entry.remaining : '');
        const type = entry.principalType || 'payment';
        const notes = (entry.notes || '').replace(/"/g, '""');
        const balanceExport = entry.balance !== null && entry.balance !== undefined ? entry.balance : '';
        csv += `"${accountName}","${entry.date}",${entry.interest},${principal},"${type}","${notes}",${balanceExport}\n`;
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
app.post('/api/import/csv', async (req, res) => {
  try {
    const { csvData } = req.body;
    const lines = csvData.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file is empty or invalid' });
    }
    
    // Skip header
    const dataLines = lines.slice(1);
    const data = await readData();
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
      
      const [accountName, date, interest, principal, type, notes, balanceCsv] = fields;
      
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
        balance: balanceCsv !== undefined && balanceCsv !== '' ? parseFloat(balanceCsv) : null,
        principal: principal ? parseFloat(principal) : null,
        principalType: type || 'payment',
        notes: notes || ''
      });
      added++;
    });
    
    await writeData(data);
    const message = `Import complete: ${added} entries added, ${skipped} duplicates skipped`;
    res.json({ success: true, message: message });
  } catch (err) {
    console.error('Error importing CSV:', err);
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

// ── Budget API ───────────────────────────────────────────────────────────────

// Get all budget data
app.get('/api/budget', async (req, res) => {
  try { res.json(await readBudget()); }
  catch (e) { res.status(500).json({ error: 'Failed to read budget data' }); }
});

// Save all budget data
app.post('/api/budget', async (req, res) => {
  try { await writeBudget(req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: 'Failed to save budget data' }); }
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`PropFolio server running on http://localhost:${PORT}`);
  console.log(`Mode: ${USE_BLOB ? 'Azure Blob Storage' : 'local file'}`);
});
