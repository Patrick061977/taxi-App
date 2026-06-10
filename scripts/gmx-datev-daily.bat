@echo off
REM GMX-Daily-DATEV-Forward — täglich Rechnungen aus taxiwydra@gmx.de an DATEV
REM Eingerichtet 2026-05-27 als Windows Task Scheduler "GMX-Datev-Forward" (täglich 09:15)
cd /d "C:\Taxi App\taxi-App-github"
echo === GMX-Datev-Forward %DATE% %TIME% ===
node scripts\gmx-daily-datev-forward.js --apply
echo === Fertig %TIME% ===
