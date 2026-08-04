# PlastPOS

Offline-first POS, inventory, manufacturing and accounts system for a small plastic bag manufacturing plant. Runs entirely on a local network — no internet required day-to-day. Works from any phone or computer's browser over the plant's WiFi.

Built for a manufacturer producing paper/plastic bags in 0.5kg, 1kg and 2kg sizes, but the product list, sizes and raw materials are all editable from the Inventory screen — nothing is hardcoded beyond the initial seed data.

## The production chain

Each physical stage of making a bag is its own login role, so everyone only sees their own section and the admin sees the whole chain:

1. **Input** — feeds raw material (e.g. plastic beads) in, logs rolls produced out, with a photo and the supplying company
2. **Cutting** — cuts rolls into bag packets by size; a Bill of Materials auto-deducts roll stock and prices the batch, with an optional photo
3. **Distribution** — takes finished packets out by vehicle to a person/place, optionally collecting payment (cash/M-Pesa/bank) on the spot or later
4. **Cashier / POS** — walk-in sales at the shop

Every worker gets their own dashboard: today's/this week's output, a 7-day trend chart, and their pay status. Admin's dashboard shows a full activity feed across every section, who's clocked in, 14-day production and profit/loss charts, and flags any section that logged nothing the previous day.

## Modules

- **POS System** — tap-to-sell screen, cart, receipts, cash/mobile-money/credit payment
- **Inventory Management** — finished goods + raw materials, stock ledger, low-stock alerts
- **Manufacturing (multi-stage)** — Input → Cutting → Distribution, each with its own login, photo proof, and stock/cash effects (see above)
- **Cash Book & Expense Tracking** — running cash-in-hand, manual expense/income entries, auto-posted sale/purchase/dispatch-payment/wage entries
- **Purchases & Suppliers** — raw material intake (admin or the Input worker), supplier records, running average material cost
- **Customer Management** — customer records, credit sales, balance tracking, payment recording
- **Payroll** — piece-rate pay per worker based on logged output; admin marks payments (with optional proof photo); workers can flag "I wasn't paid this" for admin to follow up on
- **Shifts** — clock in/out per worker, optional schedule, and a same-WiFi alarm that rings while the app is open on that phone
- **Reporting & Analytics** — sales, production, stock, cash flow, top customers, outstanding credit, 14-day production/profit charts
- **System access control** — admin can instantly lock the app to everyone but themselves, and see/kick any active login session
- **Backup & Offline Functionality** — everything runs on a local SQLite file; one-click backup download + a scheduled backup script
- **Receipt Printing & Hardware Integration** — browser print (works with thermal receipt printers) and native phone share sheet (WhatsApp, SMS, etc.)
- **Offline AI Tips** — a fully local, rule-based insight engine (low stock, sales trend swings, credit follow-ups, cash sanity checks, "section X logged nothing yesterday") — no internet, no API cost

## How it works

One small server (Node.js) runs on a single always-on computer connected to a local WiFi router. Everyone else — cashier, production staff, the owner — connects their phone to that WiFi and opens the app in a browser. It can also be "installed" to a phone's home screen as a Progressive Web App. All data lives in a single SQLite file on that computer; nothing leaves the local network.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full setup instructions (works on Windows, Ubuntu/Linux and macOS) and [docs/AI_TIPS.md](docs/AI_TIPS.md) for how the offline tips engine works and how to upgrade it to a local LLM later.

## Quick start

**Windows:** double-click `install.bat` once (checks/installs Node.js, installs dependencies, adds a `PlastPOS` desktop shortcut and prints this computer's WiFi address for phones). After that, double-click the desktop shortcut (or `start-plastpos.bat`) any time to run it.

**Any platform (manual):**
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
