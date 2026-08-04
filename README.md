# PlastPOS

Offline-first manufacturing, inventory and accounts system for a small plastic bag plant that sells purely by delivery (no shop till). Runs entirely on a local network — no internet required day-to-day. Works from any phone or computer's browser over the plant's WiFi.

Built for a manufacturer producing paper/plastic bags in 0.5kg, 1kg and 2kg sizes, but the product list, sizes and raw materials are all editable from the Inventory screen — nothing is hardcoded beyond the initial seed data.

## The production chain

Each physical stage of making a bag is its own login role, so everyone only sees their own section and their own history - admin alone sees everything. A worker must press **Start my shift** before any of this is available to them; **End my shift** closes it again, and a shift auto-closes itself after 12 hours (server clock, not something admin sets by hand) if nobody clocks out - only one shift per 12-hour window is allowed, so nobody can clock in/out repeatedly to fake extra shifts.

1. **Plant Operator** — picks which machine, feeds raw material in (e.g. plastic beads - by sack count if the material is sack-based, converted to kg automatically), logs rolls produced out, with a photo and the supplying company. Also logs one electricity meter reading per day.
2. **Packaging** — cuts rolls into bag packets by size; a Bill of Materials auto-deducts roll stock and prices the batch, with an optional photo. Shift (morning/afternoon/night) is guessed from the clock automatically.
3. **Picking** — collects the packed packets from Packaging (an internal handoff, separate job from Delivery) - a confirmation/traceability record and the basis for Picking's pay.
4. **Delivery** — sees the queue of customer orders waiting to go out, takes packets by vehicle to a person/place, optionally collecting payment (cash/M-Pesa/bank) on the spot or later, and gets a printable/shareable delivery slip.

Every worker gets their own dashboard: today's/this week's output, a 7-day trend chart, and their pay status - each sees only their own numbers, never a coworker's. Admin's dashboard shows a full activity feed across every section, who's clocked in (and whether they've actually logged work), daily/weekly/monthly production and profit/loss charts, what it cost to run the plant today (materials + wages + electricity + other spending), and flags any section that logged nothing the previous day. Money/client information (cash balance, credit owed, sales trends) is admin-only everywhere - workers only ever see stock and order tips relevant to their own job.

## Pay types

Each person's pay rate can be set to whichever matches how they're actually paid: **per unit** made/handled, **per shift** worked (flat rate, e.g. Plant Operator on a 12-hour shift), **per delivery trip** (flat rate, e.g. Delivery), or a **fixed monthly salary** (a simple paid/not-yet-paid state for the current calendar month, not tied to any count). Admin pays from the Payroll screen; a worker's "owed" figure flips straight to paid the moment admin records payment.

## Modules

- **Inventory Management** — finished goods + raw materials, stock ledger, low-stock alerts, on-page edit forms for stock/cost (no popups); a material can be marked as sold in sacks of a fixed weight, so Purchases and the Plant Operator's log both work in sack counts while stock stays tracked in kg underneath
- **Manufacturing (multi-stage)** — Plant Operator → Packaging → Picking → Delivery, each with its own login, shift gate, photo proof, and stock/cash effects (see above)
- **Machines** — admin maintains the list of machines; the Plant Operator picks one every time they log work, so output is traceable per machine
- **Customer Orders** — a customer can order ahead of stock being ready; Delivery sees a fulfilment queue (pre-filled from the customer's saved location), and Packaging/Plant Operator get an actionable tip if there isn't enough made yet
- **Cash Book & Expense Tracking** — running cash-in-hand, manual expense/income entries, auto-posted purchase/delivery-payment/wage entries
- **Purchases & Suppliers** — raw material intake, admin-only (kept separate from the Plant Operator's machine-work logging, which is a different job)
- **Customer Management** — customer records with a saved delivery location, credit sales, balance tracking, payment recording
- **Payroll** — see Pay types above; admin marks payments (with optional proof photo); workers can flag "I wasn't paid this" for admin to follow up on
- **Shifts** — clock in/out gates each worker's page (12-hour auto-close, one shift per window), each worker sets their own alarm time from their dashboard, and a same-WiFi alarm that rings while the app is open on that phone
- **Running costs** — materials used + wages paid + electricity + other spending, totalled per day, admin-only
- **Reporting & Analytics** — production, stock, cash flow, top customers, outstanding credit, daily/weekly/monthly charts, flashing red/green indicators on warnings and cash figures
- **System access control** — admin can instantly lock the app to everyone but themselves, see/kick any active login session, and reset anyone's PIN if they get locked out
- **Backup & Offline Functionality** — everything runs on a local SQLite file; one-click backup download + a scheduled backup script
- **Receipt Printing & Hardware Integration** — browser print (works with thermal receipt printers) and native phone share sheet (WhatsApp, SMS, etc.) for delivery slips
- **Offline AI Tips** — a fully local, rule-based insight engine (low stock, understocked orders, "section X logged nothing yesterday") for workers, plus sales/credit/cash tips for admin — no internet, no API cost

## Staff accounts

Admin adds each person from Settings, picks their role and pay type, and can leave the PIN blank to have a simple one made up automatically (shown once, with a Share button to send it over WhatsApp/SMS). If someone forgets their PIN, they tap "I forgot my PIN" on the login screen, which pings admin's dashboard to reset it - no email/SMS server involved. Every login shows a short welcome message (customisable in Settings) and a time-of-day greeting.

## How it works

One small server (Node.js) runs on a single always-on computer connected to a local WiFi router. Everyone else — cashier, production staff, the owner — connects their phone to that WiFi and opens the app in a browser. It can also be "installed" to a phone's home screen as a Progressive Web App. All data lives in a single SQLite file on that computer; nothing leaves the local network.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full setup instructions (works on Windows, Ubuntu/Linux and macOS) and [docs/AI_TIPS.md](docs/AI_TIPS.md) for how the offline tips engine works and how to upgrade it to a local LLM later.

## Quick start

**Windows, this machine already has the code:** double-click `install.bat` once (checks/installs Node.js, installs dependencies, adds a `PlastPOS` desktop shortcut and prints this computer's WiFi address for phones). After that, double-click the desktop shortcut (or `start-plastpos.bat`) any time to run it.

**Carrying it to a different Windows machine on a flash drive (no internet needed there at all):**
```powershell
powershell -ExecutionPolicy Bypass -File packaging\build-portable.ps1
```
Builds a self-contained `dist/PlastPOS-USB/` folder with a bundled Node.js runtime and all dependencies already installed — nothing needs to be downloaded or installed on the target machine. Copy that folder onto a flash drive, plug it into any Windows PC, and run `Install-To-This-PC.bat`. See `packaging/templates/README-INSTALL.txt` (included on the drive) for the plain-English version. Each machine gets its own independent copy and data.

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
