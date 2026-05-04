@echo off
REM v6.62.256: 1-Klick-Starter fuer den Belegtransfer-Watcher
REM Doppelklick auf diese Datei → Watcher laeuft, Konsole bleibt offen
REM Ablegen als Verknuepfung in shell:startup fuer Auto-Start beim PC-Hochfahren

cd /d "%~dp0\.."
echo ===================================================
echo   Belegtransfer-Watcher startet...
echo   Watch-Ordner: C:\Users\Taxi\OneDrive\Belege\Eingang
echo ===================================================
echo.
echo Konsole geschlossen = Watcher gestoppt
echo Strg+C = Sauber beenden
echo.

node "%~dp0belegtransfer.js"

REM Falls der Watcher abbricht, bleibt das Fenster offen damit man den Fehler sieht
echo.
echo ===================================================
echo   Watcher beendet. Druecke eine Taste zum Schliessen.
echo ===================================================
pause >nul
