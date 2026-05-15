@echo off
:: LepiOS Local AI Worker — drop this into Windows Startup folder:
::   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
::
:: Or run manually to start now.

cd /d "c:\Users\Colin\Downloads\Claude_Code_Workspace_TEMPLATE (1)\lepios"
start "LepiOS AI Worker" /min node scripts\local-ai-worker.mjs
