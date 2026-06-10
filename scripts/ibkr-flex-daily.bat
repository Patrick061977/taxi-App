@echo off
REM IBKR-Flex-Daily — taeglich 09:00 die letzten 7 Tage Activity-Flex-Statements
REM aus Gmail ziehen + nach graham-value/data/flex/ entpacken + Summary bauen.
REM
REM Eingerichtet 2026-06-10 (Patrick 16:57: "Für aktuelle Trades gibt es doch
REM einen trade log bei interaktive / jeden Tag aktualisieren").
REM
REM Windows Task Scheduler: "IBKR-Flex-Daily" — Trigger: taeglich 09:00.
REM (IBKR sendet das Activity-Flex ~08:46 deutsche Zeit, 09:00 ist nach Eingang.)

cd /d "C:\Taxi App\taxi-App-github"

for /f "tokens=1,2 delims==" %%A in (.env) do (
    if "%%A"=="GMAIL_PASS" set GMAIL_PASS=%%B
)

echo === IBKR-Flex-Daily %DATE% %TIME% ===
node scripts\ibkr-flex-pull-7days.js
echo === Fertig %TIME% ===
