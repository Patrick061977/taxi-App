@echo off
REM Mail-Briefing-Daily — taeglich 08:00 GMX+Gmail letzte 24h klassifizieren
REM und als Telegram-Briefing an Patrick senden (via Claude-Bot).
REM Eingerichtet 2026-06-10 als Windows Task Scheduler "Mail-Briefing-Daily" (taeglich 08:00)
REM Loest GitHub-Actions ab — kein Secret-Setup mehr noetig, .env reicht.

cd /d "C:\Taxi App\taxi-App-github"

REM v6.63.256: ENV aus .env (GMAIL_PASS, GMX_PASS, TG_BOT_TOKEN, TG_CHAT_ID)
for /f "tokens=1,2 delims==" %%A in (.env) do (
    if "%%A"=="GMAIL_PASS" set GMAIL_PASS=%%B
    if "%%A"=="GMX_PASS" set GMX_PASS=%%B
    if "%%A"=="TG_BOT_TOKEN" set TG_BOT_TOKEN=%%B
    if "%%A"=="TG_CHAT_ID" set TG_CHAT_ID=%%B
)

echo === Mail-Briefing-Daily %DATE% %TIME% ===
node scripts\mail-briefing-daily.js
echo === Fertig %TIME% ===
