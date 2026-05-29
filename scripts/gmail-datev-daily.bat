@echo off
REM Gmail-Daily-DATEV-Forward — täglich Rechnungen aus taxiwydra@googlemail.com an DATEV
REM Eingerichtet 2026-05-29 als Windows Task Scheduler "Gmail-Datev-Forward" (täglich 09:20)
cd /d "C:\Taxi App\taxi-App-github"
echo === Gmail-Datev-Forward %DATE% %TIME% ===
node scripts\gmail-daily-datev-forward.js --apply
echo === Fertig %TIME% ===
