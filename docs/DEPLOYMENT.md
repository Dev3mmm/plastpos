# Deployment

PlastPOS is a normal Node.js web app, so it installs identically on **Windows, Ubuntu/Linux and macOS** — the only OS-specific step is how you install Node.js itself and how you set the app to auto-start. Phones (Android or iPhone) need nothing installed at all — they just open a browser.

## 1. Pick the server machine

One computer runs the app at all times. Recommendations from planning this out:

- Any machine with an SSD (not a spinning HDD), 8GB+ RAM, running Windows 10/11, Ubuntu Server, or macOS.
- Pair it with a small UPS (~650VA) if it's not a laptop — the #1 cause of a POS "hanging" is a power cut corrupting state mid-write, not the hardware itself.
- Place it away from dust/heat if it's on the actual plant floor.

## 2. Install Node.js (22.5+)

- **Windows**: download the LTS installer from nodejs.org and run it — no extra build tools needed.
- **Ubuntu/Debian**: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`
- **macOS**: `brew install node@22`

Confirm with `node --version` (must be 22.5.0 or higher).

## 3. Get the code and install dependencies

```bash
git clone <this-repo-url> plastpos
cd plastpos/backend
npm install
npm start
```

No native compiler, no Visual Studio, no build-essential required — the database driver is Node's own built-in SQLite.

## 4. First run: the Setup Wizard

Open `http://localhost:4000` on the server machine itself. The very first screen is the Setup Wizard — **this is where you type in the business name, industry, address, phone and currency**, plus create the first admin PIN login. It only appears once; after that the app goes straight to the login screen.

## 5. Put it on the plant's WiFi

1. Connect the server machine to the router by **Ethernet cable**, not WiFi — more stable.
2. Find its LAN IP: `ipconfig` (Windows) or `ip addr` (Linux) — look for something like `192.168.1.10`.
3. On any phone connected to that same router's WiFi, open a browser and go to `http://192.168.1.10:4000`.
4. Optionally "Add to Home Screen" from the phone's browser menu — it then opens full-screen like an installed app.

No internet connection is needed on the router at all — it only needs to exist as a local network.

## 6. Keep it running without hanging

Software self-healing matters more than any single hardware choice:

**Windows** — use Task Scheduler to run `npm start` at startup, "restart on failure" enabled. Simplest option for a small deployment.

**Ubuntu/Linux** — run it under systemd:

```ini
# /etc/systemd/system/plastpos.service
[Unit]
Description=PlastPOS
After=network.target

[Service]
WorkingDirectory=/home/pi/plastpos/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2
Environment=PORT=4000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now plastpos
```

With `Restart=always`, a crash recovers in ~2 seconds unattended. Add a nightly reboot via cron (`0 3 * * * reboot`) as cheap extra insurance against long-run memory creep.

## 7. Backups

- **From the app**: Settings → Backup → "Download backup (.db)" — takes a safe, consistent snapshot even while the app is running.
- **Scheduled**: `node backend/scripts/backup.js /path/to/usb-drive` — run manually, or via cron/Task Scheduler on a schedule. Point it at a USB stick or a synced folder so a copy exists off the machine.

## 8. Receipt printing / sharing

- **Print**: the receipt screen's Print button uses the browser's normal print dialog — works with any printer set up on the phone/computer, including USB or Bluetooth thermal receipt printers configured as a system printer.
- **Share**: the Share button uses the phone's native share sheet, so the cashier can send the receipt straight to a customer over WhatsApp, SMS, or anything else installed. This works even though the phone is on the plant's offline WiFi, because most phones auto-fallback to mobile data for that one send.

## 9. Staff accounts

Log in as the admin (created during setup) → Settings → "Add staff" to create cashier/production PIN logins with restricted access.
