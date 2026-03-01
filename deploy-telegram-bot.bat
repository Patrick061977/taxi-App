@echo off
chcp 65001 >nul
title Funk Taxi Heringsdorf - Telegram Bot Deploy
echo.
echo ============================================
echo   Funk Taxi Heringsdorf - Bot Deploy
echo ============================================
echo.

:: 1. Pruefen ob Node.js installiert ist
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [FEHLER] Node.js ist nicht installiert!
    echo.
    echo Bitte lade Node.js herunter:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js gefunden

:: 2. Pruefen ob Firebase CLI installiert ist, sonst installieren
where firebase >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Firebase CLI wird installiert...
    call npm install -g firebase-tools
    if %errorlevel% neq 0 (
        echo [FEHLER] Firebase CLI Installation fehlgeschlagen!
        pause
        exit /b 1
    )
)
echo [OK] Firebase CLI gefunden

:: 3. Firebase Login pruefen
echo.
echo [INFO] Firebase Login wird geprueft...
call firebase projects:list >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Du bist noch nicht eingeloggt.
    echo [INFO] Ein Browser-Fenster oeffnet sich gleich...
    echo [INFO] Bitte mit deinem Google-Konto einloggen!
    echo.
    call firebase login
    if %errorlevel% neq 0 (
        echo [FEHLER] Login fehlgeschlagen!
        pause
        exit /b 1
    )
)
echo [OK] Firebase Login aktiv

:: 4. In den Projektordner wechseln
cd /d "%~dp0"
echo [OK] Projektordner: %cd%

:: 5. Dependencies installieren
echo.
echo [INFO] Dependencies werden installiert...
cd functions
call npm install
if %errorlevel% neq 0 (
    echo [FEHLER] npm install fehlgeschlagen!
    pause
    exit /b 1
)
echo [OK] Dependencies installiert
cd ..

:: 6. Cloud Function deployen
echo.
echo ============================================
echo   Deploying Cloud Function...
echo ============================================
echo.
call firebase deploy --only functions
if %errorlevel% neq 0 (
    echo.
    echo [FEHLER] Deploy fehlgeschlagen!
    echo Moeglicherweise stimmt das Firebase-Projekt nicht.
    echo Pruefe .firebaserc und versuche es erneut.
    pause
    exit /b 1
)

echo.
echo [OK] Cloud Function erfolgreich deployed!

:: 7. Webhook bei Telegram registrieren
echo.
echo ============================================
echo   Webhook wird bei Telegram registriert...
echo ============================================
echo.

:: Projekt-ID aus .firebaserc lesen (Standard: taxi-heringsdorf)
set PROJECT_ID=taxi-heringsdorf
set WEBHOOK_URL=https://europe-west1-%PROJECT_ID%.cloudfunctions.net/setupWebhook

echo [INFO] Rufe auf: %WEBHOOK_URL%
echo.

curl -s "%WEBHOOK_URL%"

echo.
echo.
echo ============================================
echo   FERTIG!
echo ============================================
echo.
echo Dein Telegram Bot laeuft jetzt 24/7
echo ueber Firebase Cloud Functions.
echo.
echo Kein Browser-Tab mehr noetig!
echo.
echo Bei Problemen: removeWebhook aufrufen:
echo https://europe-west1-%PROJECT_ID%.cloudfunctions.net/removeWebhook
echo.
pause
