@echo off
:: LepiOS Chrome Debug Launcher
:: Starts Chrome with remote debugging on port 9222 so Puppeteer can connect.
:: Drop into Windows Startup folder:
::   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
::
:: Chrome must be launched THIS WAY first (before opening Chrome normally)
:: for Puppeteer to connect. If Chrome is already running, close it first.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --remote-allow-origins=* ^
  --no-first-run ^
  --no-default-browser-check
