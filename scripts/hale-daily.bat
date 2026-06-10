@echo off
REM HALE-Daily-Pull — täglich Tagesabrechnung beide USt-Sätze
REM Eingerichtet 2026-05-27 als Windows Task Scheduler "Hale-Daily-Pull" (täglich 09:05)
REM Pull-Skript ist headed (Browser sichtbar) weil headless mit dem HALE-UI nicht klappt
cd /d "C:\Taxi App\taxi-App-github"

REM v6.63.256: HALE_PASS aus .env (nicht mehr hardcoded in scripts/hale-*.js)
for /f "tokens=1,2 delims==" %%A in (.env) do (
    if "%%A"=="HALE_PASS" set HALE_PASS=%%B
    if "%%A"=="GMAIL_PASS" set GMAIL_PASS=%%B
    if "%%A"=="GMX_PASS" set GMX_PASS=%%B
)

REM Tag = gestern (Pull holt immer den Vortag, weil heute noch nicht abgeschlossen)
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value ^| find "="') do set dt=%%a
set Y=%dt:~0,4%
set M=%dt:~4,2%
set D=%dt:~6,2%

REM Gestern berechnen via PowerShell (zuverlässig über Monatsgrenzen)
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Date).AddDays(-1).ToString('yyyy-MM-dd')"') do set YESTERDAY=%%i

echo === HALE-Daily-Pull %DATE% %TIME% — Tag %YESTERDAY% ===

set DATES=%YESTERDAY%
set MODE=daily-7
node scripts\hale-pull-pdf-v2.js

set MODE=daily-19
node scripts\hale-pull-pdf-v2.js

echo === Fertig %TIME% ===
