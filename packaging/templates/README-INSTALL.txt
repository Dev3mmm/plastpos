PlastPOS - Portable Installer
==============================

This flash drive has everything needed. No internet connection required
on the computer you install it on.

TO INSTALL ON A COMPUTER
-------------------------
1. Plug in this flash drive.
2. Double-click "Install-To-This-PC.bat".
3. It copies PlastPOS onto that computer, adds a "PlastPOS" Desktop
   shortcut, and starts the app automatically.
4. From then on, just use the Desktop shortcut - you don't need this
   flash drive again on that computer.

You can repeat this on as many computers as you like - each one gets
its own independent copy and its own data.

FIRST TIME OPENING
-------------------
A "Set up your business" screen appears - enter your business name,
industry, and create the first admin login (name + 4-digit PIN).
This only happens once, ever, on that computer.

FOR PHONES ON THE SAME WIFI
-----------------------------
Once it's running, a black window stays open showing a line like:
  From phones on WiFi: http://<this-computer's-LAN-IP>:4000
Open that address in a phone's browser while the phone is connected
to the same WiFi router as this computer.

RUNNING DIRECTLY FROM THE FLASH DRIVE (not recommended)
----------------------------------------------------------
You can double-click "Start-PlastPOS.bat" on the flash drive itself
to try it without installing. Your data then gets saved onto the
flash drive, which is slower and risks corruption if the drive is
removed while the app is running. Always use "Install-To-This-PC.bat"
for actual day-to-day use in the plant.

REMOVING PLASTPOS FROM A COMPUTER
------------------------------------
Open the PlastPOS folder in your Documents/Home folder (or wherever it
was installed) and double-click "Uninstall.bat". You will be asked to
choose:
  1. Remove everything, including all saved data - permanent.
  2. Remove the program only, keep all saved data in case you install
     PlastPOS again later.
  3. Cancel.

REINSTALLING / UPDATING
--------------------------
Running "Install-To-This-PC.bat" again on a computer that already has
PlastPOS will update it to whatever is on this flash drive, and will
always keep the existing saved data - it will ask you to confirm first.

TROUBLESHOOTING
-----------------
If Windows shows a security warning when you double-click the .bat
files ("Windows protected your PC"), click "More info" then "Run
anyway" - this happens because the files came from a flash drive,
not because anything is wrong with them.
