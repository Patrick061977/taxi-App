@echo off
REM ════════════════════════════════════════════════════════════════
REM  Funk Taxi Heringsdorf — Claude Code Starter
REM  Doppelklick → wechselt ins Repo + startet Claude Code im Terminal.
REM  Bridge-Polling startet Claude beim Session-Start automatisch
REM  (siehe CLAUDE.md PFLICHT bei JEDEM Session-Start).
REM ════════════════════════════════════════════════════════════════

cd /d "C:\Taxi App\taxi-App-github"

echo.
echo ════════════════════════════════════════════════════
echo  Funk Taxi Heringsdorf — Claude Code wird gestartet
echo ════════════════════════════════════════════════════
echo.
echo  Verzeichnis: %CD%
echo  Branch:
git branch --show-current
echo.
echo  Letzte Commits:
git log --oneline -3
echo.
echo ════════════════════════════════════════════════════
echo.

REM Claude Code starten — bleibt offen mit /k
cmd /k "claude"
