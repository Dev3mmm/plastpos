# PlastPOS

Offline-first POS, inventory, manufacturing and accounts system for a small plastic bag manufacturing plant. Runs entirely on a local network — no internet required day-to-day. Works from any phone or computer's browser over the plant's WiFi.

Built for a manufacturer producing paper/plastic bags in 0.5kg, 1kg and 2kg sizes, but the product list, sizes and raw materials are all editable from the Inventory screen — nothing is hardcoded beyond the initial seed data.

## Modules

- **POS System** — tap-to-sell screen, cart, receipts, cash/mobile-money/credit payment
- **Inventory Management** — finished goods + raw materials, stock ledger, low-stock alerts
- **Manufacturing** — log production runs; a Bill of Materials auto-deducts raw material stock and prices each batch
- **Cash Book & Expense Tracking** — running cash-in-hand, manual expense/income entries, auto-posted sale/purchase entries
- **Purchases & Suppliers** — raw material intake, supplier records, running average material cost
- **Customer Management** — customer records, credit sales, balance tracking, payment recording
- **Reporting & Analytics** — sales, production, stock, cash flow, top customers, outstanding credit
- **Backup & Offline Functionality** — everything runs on a local SQLite file; one-click backup download + a scheduled backup script
- **Receipt Printing & Hardware Integration** — browser print (works with thermal receipt printers) and native phone share sheet (WhatsApp, SMS, etc.)
- **Offline AI Tips** — a fully local, rule-based insight engine (low stock, sales trend swings, credit follow-ups, cash sanity checks) — no internet, no API cost

## How it works

One small server (Node.js) runs on a single always-on computer connected to a local WiFi router. Everyone else — cashier, production staff, the owner — connects their phone to that WiFi and opens the app in a browser. It can also be "installed" to a phone's home screen as a Progressive Web App. All data lives in a single SQLite file on that computer; nothing leaves the local network.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full setup instructions (works on Windows, Ubuntu/Linux and macOS) and [docs/AI_TIPS.md](docs/AI_TIPS.md) for how the offline tips engine works and how to upgrade it to a local LLM later.

## Quick start (development)

```bash
cd backend
npm install
npm start
```

Then open `http://localhost:4000` in a browser. First run shows a Setup Wizard (business name, industry, admin PIN) — that's where the business identity gets configured, once, at install time.

Requires **Node.js 22.5 or newer** (uses Node's built-in SQLite support — no native build tools needed, so install works the same on any machine).

## Project layout

```
backend/    Express API + SQLite database + static file server
frontend/   Plain-JS Progressive Web App (no build step)
docs/       Deployment and architecture notes
```
