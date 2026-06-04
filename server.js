const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5001;

// ── Storage mode ─────────────────────────────────────────────────────────────
// Priority: MongoDB (MONGODB_URI) > Azure Blob (AZURE_STORAGE_CONNECTION_STRING) > local JSON
const MONGODB_URI  = process.env.MONGODB_URI;
const USE_MONGO    = !!MONGODB_URI;
const USE_BLOB     = !USE_MONGO && !!process.env.AZURE_STORAGE_CONNECTION_STRING;
const DATA_FILE    = path.join(__dirname, 'data', 'mortgage_data.json');
const BUDGET_FILE  = path.join(__dirname, 'data', 'budget_data.json');
const BUDGET_EMPTY = { categories: [], months: {} };

// ── MongoDB schemas ───────────────────────────────────────────────────────────
const { Schema } = mongoose;

const entrySchema = new Schema(
  { id: String, date: String, interest: Number, balance: Schema.Types.Mixed,
    principal: Schema.Types.Mixed, principalType: String, notes: String },
  { _id: false, strict: false }
);
const accountSchema = new Schema(
  { id: { type: String, required: true }, name: String, entries: [entrySchema],
    tenant: { type: Schema.Types.Mixed, default: {} },
    transactions: { type: [Schema.Types.Mixed], default: [] } },
  { versionKey: false, strict: false }
);
accountSchema.index({ id: 1 }, { unique: true });
const Account = mongoose.model('Account', accountSchema);

const categorySchema = new Schema(
  { id: { type: String, required: true }, name: String },
  { versionKey: false }
);
categorySchema.index({ id: 1 }, { unique: true });
const Category = mongoose.model('Category', categorySchema);

const budgetMonthSchema = new Schema(
  { month: { type: String, required: true },
    budget:   { type: [Schema.Types.Mixed], default: [] },
    expenses: { type: [Schema.Types.Mixed], default: [] } },
  { versionKey: false }
);
budgetMonthSchema.index({ month: 1 }, { unique: true });
const BudgetMonth = mongoose.model('BudgetMonth', budgetMonthSchema);

// ── Azure Blob setup ──────────────────────────────────────────────────────────
let blockBlobClient, budgetBlobClient;
if (USE_BLOB) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
  );
  const CONTAINER_NAME        = process.env.AZURE_STORAGE_CONTAINER        || 'mortgage-data';
  const BUDGET_CONTAINER_NAME = process.env.AZURE_BUDGET_STORAGE_CONTAINER || 'budget-data';

  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
  blockBlobClient = containerClient.getBlockBlobClient('mortgage_data.json');
  containerClient.createIfNotExists()
    .then(() => console.log(`Blob container "${CONTAINER_NAME}" ready`))
    .catch(e => console.error('Blob container init error:', e));

  const budgetContainerClient = blobServiceClient.getContainerClient(BUDGET_CONTAINER_NAME);
  budgetBlobClient = budgetContainerClient.getBlockBlobClient('budget_data.json');
  budgetContainerClient.createIfNotExists()
    .then(() => console.log(`Blob container "${BUDGET_CONTAINER_NAME}" ready`))
    .catch(e => console.error('Budget blob container init error:', e));
}

// ── Local file fallback ───────────────────────────────────────────────────────
if (!USE_MONGO && !USE_BLOB) {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: [] }));
  if (!fs.existsSync(BUDGET_FILE)) fs.writeFileSync(BUDGET_FILE, JSON.stringify(BUDGET_EMPTY, null, 2));
}

async function readBudget() {
  if (USE_MONGO) {
    const [categories, monthDocs] = await Promise.all([
      Category.find({}).select('-_id').lean(),
      BudgetMonth.find({}).select('-_id').lean()
    ]);
    const months = {};
    monthDocs.forEach(({ month, budget, expenses }) => { months[month] = { budget, expenses }; });
    return { categories, months };
  }
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
  if (USE_MONGO) {
    const { categories = [], months = {} } = data;
    if (categories.length > 0) {
      await Category.bulkWrite(
        categories.map(cat => ({
          updateOne: { filter: { id: cat.id }, update: { $set: cat }, upsert: true }
        }))
      );
    }
    await Category.deleteMany({ id: { $nin: categories.map(c => c.id) } });

    const monthEntries = Object.entries(months);
    if (monthEntries.length > 0) {
      await BudgetMonth.bulkWrite(
        monthEntries.map(([month, val]) => ({
          updateOne: {
            filter: { month },
            update: { $set: { month, budget: val.budget || [], expenses: val.expenses || [] } },
            upsert: true
          }
        }))
      );
    }
    await BudgetMonth.deleteMany({ month: { $nin: Object.keys(months) } });
    return;
  }
  const json = JSON.stringify(data, null, 2);
  if (USE_BLOB) {
    const buf = Buffer.from(json, 'utf8');
    await budgetBlobClient.upload(buf, buf.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    });
    return;
  }
  fs.writeFileSync(BUDGET_FILE, json);
}

async function readData() {
  if (USE_MONGO) {
    const accounts = await Account.find({}).select('-_id').lean();
    return { accounts };
  }
  if (USE_BLOB) {
    const buffer = await blockBlobClient.downloadToBuffer();
    return JSON.parse(buffer.toString('utf8'));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

async function writeData(data) {
  if (USE_MONGO) {
    const { accounts = [] } = data;
    if (accounts.length > 0) {
      await Account.bulkWrite(
        accounts.map(acc => ({
          updateOne: { filter: { id: acc.id }, update: { $set: acc }, upsert: true }
        }))
      );
    }
    await Account.deleteMany({ id: { $nin: accounts.map(a => a.id) } });
    return;
  }
  const json = JSON.stringify(data, null, 2);
  if (USE_BLOB) {
    const buf = Buffer.from(json, 'utf8');
    await blockBlobClient.upload(buf, buf.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    });
    return;
  }
  fs.writeFileSync(DATA_FILE, json);
}
// ────────────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

async function startServer() {
  if (USE_MONGO) {
    await mongoose.connect(MONGODB_URI);
    console.log('Storage: MongoDB connected');
  } else if (USE_BLOB) {
    console.log('Storage: Azure Blob Storage');
  } else {
    console.log(`Storage: local JSON files (${DATA_FILE})`);
  }
  app.listen(PORT, () => console.log(`PropFolio server running on http://localhost:${PORT}`));
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
