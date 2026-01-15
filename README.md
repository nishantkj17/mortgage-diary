MortgageDiary
===============

A very small, minimalist single-file web app to track mortgage/loan monthly interest and remaining balance per account.

How it stores data
- Uses your browser's `localStorage` under the key `mortgageDiaryData_v1` (local to the machine/browser).

Files
- [MortgageDiary/index.html](MortgageDiary/index.html)
- [MortgageDiary/app.js](MortgageDiary/app.js)
- [MortgageDiary/style.css](MortgageDiary/style.css)

Usage
1. Open `index.html` in your browser.
2. Create an account using the left-side "New account name" input.
3. Select the account from the dropdown and add entries with a date, interest paid, and optional remaining balance.
4. Entries are displayed in the table and the chart shows interest paid and remaining balance over time.

## Hosting Options

### Option 1: IIS + Node.js Backend (Recommended)

**Step 1: Start the API Server**

Open a PowerShell terminal and run:

```powershell
cd c:\repos\MortgageDiary
npm install
node server.js
```

Or use the startup script:

```powershell
.\start_server.ps1
```

The API server will run on `http://localhost:5001` (keep this terminal open).

**Step 2: Access the Web App**

The IIS site is already configured at `http://localhost:8081`

Open your browser and go to: `http://localhost:8081`

### Option 2: Simple HTTP Server (Python)

If you just want to test without IIS:

```powershell
# Terminal 1 - Start API server
node server.js

# Terminal 2 - Start web server
python -m http.server 8000
```

Then open `http://localhost:8000`

## Features

- **Multi-browser access**: Data stored in `data/mortgage_data.json` on the server
- **CSV Export**: Download backup of all data
- **CSV Import**: Restore or bulk-import data from CSV
- **Multiple accounts**: Track different loans separately
- **Historical entries**: Add past and current month data
- **Visual charts**: Line graphs for interest and remaining balance

## Data Storage

Data is stored in: `c:\repos\MortgageDiary\data\mortgage_data.json`

This allows you to:
- Access from any browser (Chrome, Edge, Firefox)
- Keep data even if you clear browser cache
- Easily backup by copying the JSON file
- Deploy to Azure/AWS by moving the server

Notes & next steps
- Data is local to the browser; for deployment to Azure/AWS you'd add an API and a database.
- Export/import and authentication are intentionally omitted to keep it minimal.
- If you want, I can add CSV export/import and a tiny Node/Flask backend for persistence.
