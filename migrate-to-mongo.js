/**
 * One-time migration: Azure Blob Storage (or local JSON files) → MongoDB / Cosmos DB
 * Safe to re-run — uses upsert, no duplicates created.
 *
 * ── Local dev (reads local JSON files) ──────────────────────────────────────
 *   $env:MONGODB_URI = "mongodb://localhost:27017/mortgage-diary"
 *   node migrate-to-mongo.js
 *
 * ── Production (reads from Azure Blob, writes to Cosmos DB) ─────────────────
 *   $env:AZURE_STORAGE_CONNECTION_STRING = "<your blob connection string>"
 *   $env:AZURE_STORAGE_CONTAINER         = "mortgage-data"   # optional, default shown
 *   $env:AZURE_BUDGET_STORAGE_CONTAINER  = "budget-data"     # optional, default shown
 *   $env:MONGODB_URI                     = "<your Cosmos DB connection string>"
 *   node migrate-to-mongo.js
 */
'use strict';

const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

const MONGODB_URI      = process.env.MONGODB_URI || 'mongodb://localhost:27017/mortgage-diary';
const BLOB_CONN_STR    = process.env.AZURE_STORAGE_CONNECTION_STRING;
const USE_BLOB         = !!BLOB_CONN_STR;
const CONTAINER_NAME        = process.env.AZURE_STORAGE_CONTAINER        || 'mortgage-data';
const BUDGET_CONTAINER_NAME = process.env.AZURE_BUDGET_STORAGE_CONTAINER || 'budget-data';
const { Schema } = mongoose;

// ── Blob helpers ──────────────────────────────────────────────────────────────
async function downloadBlob(containerName, blobName) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const client = BlobServiceClient.fromConnectionString(BLOB_CONN_STR)
    .getContainerClient(containerName)
    .getBlockBlobClient(blobName);
  const buffer = await client.downloadToBuffer();
  return JSON.parse(buffer.toString('utf8'));
}

// ── Schemas (mirror server.js) ────────────────────────────────────────────────
const accountSchema = new Schema(
  { id: { type: String, required: true }, name: String,
    entries:      { type: [Schema.Types.Mixed], default: [] },
    tenant:       { type: Schema.Types.Mixed,   default: {} },
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
  { month:    { type: String, required: true },
    budget:   [Schema.Types.Mixed],
    expenses: [Schema.Types.Mixed] },
  { versionKey: false }
);
budgetMonthSchema.index({ month: 1 }, { unique: true });
const BudgetMonth = mongoose.model('BudgetMonth', budgetMonthSchema);

// ── Migration ─────────────────────────────────────────────────────────────────
async function migrate() {
  const displayUri = MONGODB_URI.replace(/\/\/[^@]*@/, '//<credentials>@');
  console.log(`Source : ${USE_BLOB ? 'Azure Blob Storage' : 'local JSON files'}`);
  console.log(`Target : ${displayUri}`);
  console.log('');
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB connected.\n');

  // ── Mortgage accounts ────────────────────────────────────────────────────────
  let mortgageData;
  if (USE_BLOB) {
    console.log(`Reading mortgage data from blob container "${CONTAINER_NAME}"...`);
    mortgageData = await downloadBlob(CONTAINER_NAME, 'mortgage_data.json');
  } else {
    const mortgageFile = path.join(__dirname, 'data', 'mortgage_data.json');
    if (!fs.existsSync(mortgageFile)) { console.warn('  mortgage_data.json not found — skipping\n'); mortgageData = { accounts: [] }; }
    else mortgageData = JSON.parse(fs.readFileSync(mortgageFile, 'utf8'));
  }
  const { accounts = [] } = mortgageData;
  console.log(`Migrating ${accounts.length} mortgage account(s)...`);
  let totalEntries = 0, totalTxns = 0;
  for (const acc of accounts) {
    await Account.updateOne({ id: acc.id }, { $set: acc }, { upsert: true });
    totalEntries += (acc.entries      || []).length;
    totalTxns    += (acc.transactions || []).length;
  }
  console.log(`  ✓ ${accounts.length} account(s) | ${totalEntries} mortgage entries | ${totalTxns} tenant transactions\n`);

  // ── Budget ───────────────────────────────────────────────────────────────────
  let budgetData;
  if (USE_BLOB) {
    console.log(`Reading budget data from blob container "${BUDGET_CONTAINER_NAME}"...`);
    budgetData = await downloadBlob(BUDGET_CONTAINER_NAME, 'budget_data.json');
  } else {
    const budgetFile = path.join(__dirname, 'data', 'budget_data.json');
    if (!fs.existsSync(budgetFile)) { console.warn('  budget_data.json not found — skipping\n'); budgetData = { categories: [], months: {} }; }
    else budgetData = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
  }
  const { categories = [], months = {} } = budgetData;

  console.log(`Migrating ${categories.length} budget category(ies)...`);
  for (const cat of categories) {
    await Category.updateOne({ id: cat.id }, { $set: cat }, { upsert: true });
  }
  console.log(`  ✓ ${categories.length} category(ies)\n`);

  const monthKeys = Object.keys(months);
  console.log(`Migrating ${monthKeys.length} budget month(s)...`);
  let totalBudgetItems = 0, totalExpenses = 0;
  for (const month of monthKeys) {
    const val = months[month];
    await BudgetMonth.updateOne(
      { month },
      { $set: { month, budget: val.budget || [], expenses: val.expenses || [] } },
      { upsert: true }
    );
    totalBudgetItems += (val.budget   || []).length;
    totalExpenses    += (val.expenses || []).length;
  }
  console.log(`  ✓ ${monthKeys.length} month(s) | ${totalBudgetItems} budget items | ${totalExpenses} expense records\n`);

  await mongoose.disconnect();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Migration complete! All production data is now in MongoDB.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

migrate().catch(err => {
  console.error('\nMigration failed:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
