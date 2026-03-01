@echo off
chcp 65001 >nul
title Funk Taxi Heringsdorf - Telegram Bot Deploy

:: ============================================
::  Dieses Skript macht ALLES automatisch:
::  1. Prueft ob Node.js da ist
::  2. Installiert Firebase CLI falls noetig
::  3. Loggt dich bei Firebase ein
::  4. Installiert alle Pakete
::  5. Deployt den Bot
::  6. Registriert den Webhook
::
::  Du musst NUR doppelklicken!
:: ============================================

:: Projektordner = dort wo diese .bat Datei liegt
set "PROJECT_DIR=%~dp0"
set "FUNCTIONS_DIR=%PROJECT_DIR%functions"
set "PROJECT_ID=taxi-heringsdorf"

:: Fallback: Falls die .bat Datei nicht im Projektordner liegt,
:: pruefe ob das aktuelle Verzeichnis der Projektordner ist
if not exist "%FUNCTIONS_DIR%\package.json" (
    if exist "%CD%\functions\package.json" (
        set "PROJECT_DIR=%CD%\"
        set "FUNCTIONS_DIR=%CD%\functions"
    )
)

:: Fallback 2: Pruefe ob wir bereits IM functions-Ordner sind
if not exist "%FUNCTIONS_DIR%\package.json" (
    if exist "%CD%\package.json" (
        for %%I in ("%CD%\..") do set "PROJECT_DIR=%%~fI\"
        for %%I in ("%CD%\..") do set "FUNCTIONS_DIR=%%~fI\functions"
    )
)

echo.
echo ============================================
echo   Funk Taxi Heringsdorf - Bot Deploy
echo ============================================
echo.

:: -----------------------------------------------
:: SCHRITT 1: Node.js pruefen
:: -----------------------------------------------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [FEHLER] Node.js ist nicht installiert!
    echo.
    echo So gehts:
    echo   1. Oeffne https://nodejs.org/
    echo   2. Lade die LTS-Version herunter
    echo   3. Installiere sie ^(einfach immer "Weiter" klicken^)
    echo   4. Starte dieses Skript danach nochmal
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js gefunden
node --version
echo.

:: -----------------------------------------------
:: SCHRITT 2: npm reparieren falls kaputt
:: -----------------------------------------------
:: Der haeufigste Windows-Fehler: npm will nach C:\ schreiben
:: Das passiert wenn npm-cache oder prefix falsch konfiguriert ist
echo [INFO] npm-Konfiguration wird geprueft...

:: Sicherstellen dass npm einen gueltigen Cache-Pfad hat
call npm config set cache "%APPDATA%\npm-cache" >nul 2>&1

:: Falls node_modules kaputt ist, loeschen wir es
if exist "%FUNCTIONS_DIR%\node_modules\.package-lock.json" (
    echo [OK] node_modules sieht gut aus
) else (
    if exist "%FUNCTIONS_DIR%\node_modules" (
        echo [INFO] node_modules scheint beschaedigt, wird bereinigt...
        rmdir /s /q "%FUNCTIONS_DIR%\node_modules" >nul 2>&1
    )
)
echo.

:: -----------------------------------------------
:: SCHRITT 3: Firebase CLI pruefen/installieren
:: -----------------------------------------------
where firebase >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Firebase CLI wird installiert...
    echo [INFO] Das kann 1-2 Minuten dauern...
    echo.
    call npm install -g firebase-tools
    if %errorlevel% neq 0 (
        echo.
        echo [FEHLER] Firebase CLI konnte nicht installiert werden.
        echo.
        echo Loesung: Rechtsklick auf diese Datei
        echo          -^> "Als Administrator ausfuehren"
        echo.
        pause
        exit /b 1
    )
    echo.
)
echo [OK] Firebase CLI gefunden
echo.

:: -----------------------------------------------
:: SCHRITT 4: Firebase Login
:: -----------------------------------------------
echo [INFO] Firebase Login wird geprueft...
call firebase projects:list >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ============================================
    echo   Firebase Login noetig
    echo ============================================
    echo.
    echo   Gleich oeffnet sich dein Browser.
    echo   Bitte mit deinem Google-Konto einloggen!
    echo.
    call firebase login
    if %errorlevel% neq 0 (
        echo [FEHLER] Login fehlgeschlagen. Bitte nochmal versuchen.
        pause
        exit /b 1
    )
    echo.
)
echo [OK] Firebase Login aktiv
echo.

:: -----------------------------------------------
:: SCHRITT 5: Ordner pruefen
:: -----------------------------------------------
if not exist "%FUNCTIONS_DIR%\package.json" (
    echo [FEHLER] Die Datei "functions\package.json" fehlt!
    echo.
    echo Gesucht in: %FUNCTIONS_DIR%
    echo.
    echo Moegliche Loesung:
    echo   1. Oeffne den taxi-App Ordner im Windows Explorer
    echo   2. Lege diese .bat Datei DIREKT in den taxi-App Ordner
    echo      ^(neben den "functions" Ordner und die index.html^)
    echo   3. Doppelklicke die .bat Datei dort erneut
    echo.
    echo ODER: Oeffne eine Eingabeaufforderung im taxi-App Ordner
    echo       und fuehre dieses Skript von dort aus.
    echo.
    pause
    exit /b 1
)
echo [OK] Projektordner gefunden: %PROJECT_DIR%
echo.

:: -----------------------------------------------
:: SCHRITT 6: npm install (mit automatischer Reparatur)
:: -----------------------------------------------
echo [INFO] Pakete werden installiert...
echo [INFO] Das kann beim ersten Mal 1-2 Minuten dauern...
echo.

cd /d "%FUNCTIONS_DIR%"

:: Alte package-lock.json loeschen (wurde evtl. auf Linux erstellt)
if exist "package-lock.json" (
    del /q "package-lock.json" >nul 2>&1
)

:: Erster Versuch
call npm install 2>"%TEMP%\taxi-npm-error.log"
if %errorlevel% equ 0 goto npm_ok

:: Fehlgeschlagen - Automatische Reparatur
echo [WARNUNG] Erster Versuch fehlgeschlagen, repariere automatisch...
echo.

:: Cache leeren
echo [INFO] npm Cache wird bereinigt...
call npm cache clean --force >nul 2>&1

:: node_modules komplett loeschen
if exist "node_modules" (
    echo [INFO] node_modules wird geloescht...
    rmdir /s /q "node_modules" >nul 2>&1
)

:: Zweiter Versuch
echo [INFO] Zweiter Versuch...
call npm install
if %errorlevel% equ 0 goto npm_ok

:: Immer noch fehlgeschlagen
echo.
echo [FEHLER] npm install funktioniert nicht.
echo.
echo Bitte probiere folgendes:
echo.
echo   1. Rechtsklick auf diese Datei
echo      -^> "Als Administrator ausfuehren"
echo.
echo   2. Falls das nicht hilft:
echo      - Windows-Taste druecken
echo      - "cmd" eintippen
echo      - Rechtsklick -^> "Als Administrator ausfuehren"
echo      - Dann eintippen:
echo        cd /d "%FUNCTIONS_DIR%"
echo        npm cache clean --force
echo        npm install
echo.
pause
exit /b 1

:npm_ok
echo [OK] Alle Pakete installiert!
echo.

:: Zurueck zum Projektordner fuer firebase deploy
cd /d "%PROJECT_DIR%"

:: -----------------------------------------------
:: SCHRITT 7: Cloud Function deployen
:: -----------------------------------------------
echo ============================================
echo   Bot wird auf Firebase hochgeladen...
echo ============================================
echo.
echo [INFO] Das dauert ca. 1-2 Minuten...
echo.

call firebase deploy --only functions
if %errorlevel% neq 0 (
    echo.
    echo [FEHLER] Deploy fehlgeschlagen!
    echo.
    echo Moegliche Ursachen:
    echo   - Firebase-Projekt "%PROJECT_ID%" existiert nicht
    echo   - Keine Berechtigung fuer das Projekt
    echo   - Kein Internet
    echo.
    echo Pruefe die Datei ".firebaserc" im Projektordner.
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Bot erfolgreich hochgeladen!
echo.

:: -----------------------------------------------
:: SCHRITT 8: Webhook bei Telegram registrieren
:: -----------------------------------------------
echo ============================================
echo   Webhook wird bei Telegram aktiviert...
echo ============================================
echo.

set "WEBHOOK_URL=https://europe-west1-%PROJECT_ID%.cloudfunctions.net/setupWebhook"

:: Pruefen ob curl vorhanden ist
where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Bitte oeffne diesen Link im Browser:
    echo %WEBHOOK_URL%
    echo.
    goto fertig
)

curl -s "%WEBHOOK_URL%"
echo.

:fertig
echo.
echo ============================================
echo.
echo   FERTIG! Dein Telegram Bot laeuft jetzt
echo   rund um die Uhr - auch ohne Browser!
echo.
echo ============================================
echo.
echo   Bei Problemen Webhook zuruecksetzen:
echo   https://europe-west1-%PROJECT_ID%.cloudfunctions.net/removeWebhook
echo.
pause
