# v6.63.1015: Woechentlicher Firebase-Voll-Backup - Sonntags 03:00
#
# Sichert Firebase RTDB-Daten in einen separaten ZIP-File. Getrennt vom
# taeglichen Session-Backup weil deutlich groesser (~50-200 MB) und andere
# Kadenz Sinn macht.
#
# Pfade die gesichert werden (jeweils als separate .json):
#   /customers        - CRM
#   /rides            - Live-Fahrten
#   /archiveRides     - Historische Fahrten (das ist der grosse Node)
#   /invoices         - Rechnungen
#   /vehicles         - Fahrzeuge inkl. Live-Position
#   /drivers          - Fahrer
#   /callHistory      - Anruf-Protokoll (letzte 1000 typischerweise)
#   /seoRouteOverrides - SEO-Route-Preis-Overrides
#   /pois             - POI-Favoriten
#
# Nicht gesichert:
#   /errorLogs       - riesig und noisy, kein Business-Wert
#   /telegram/pending - transient
#   /callPopup       - transient
#
# ZIP -> C:\Users\Taxi\OneDrive\Backups\firebase-rtdb-YYYY-MM-DD.zip
# Retention: 8 Wochen (2 Monate)
#
# Aufruf manuell:  powershell -File "C:\Taxi App\...\scripts\weekly-firebase-backup.ps1"

$ErrorActionPreference = 'Continue'

$repoRoot = 'C:\Taxi App\taxi-App-github'
$backupDir = Join-Path $env:USERPROFILE 'OneDrive\Backups'
$stage = Join-Path $env:TEMP ('firebase-rtdb-staging-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$logFile = Join-Path $env:TEMP 'firebase-rtdb-backup.log'

function Log($msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $msg"
    Write-Output $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

if (Test-Path $logFile) { Remove-Item $logFile -Force }
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Log "=== Firebase-RTDB-Backup gestartet ==="
Log "Staging: $stage"

$env:MSYS_NO_PATHCONV = '1'

$paths = @(
    'customers',
    'rides',
    'archiveRides',
    'invoices',
    'vehicles',
    'drivers',
    'callHistory',
    'seoRouteOverrides',
    'pois',
    'settings'
)

Push-Location $repoRoot
try {
    foreach ($p in $paths) {
        $outFile = Join-Path $stage "$p.json"
        Log "Exportiere /$p ..."
        try {
            firebase database:get "/$p" 2>$null | Out-File $outFile -Encoding utf8
            if (Test-Path $outFile) {
                $sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
                Log "  /$p -> $sizeMB MB"
            } else {
                Log "  /$p -> LEER (kein File erzeugt)"
            }
        } catch {
            Log "  WARN: /$p Export fehlgeschlagen: $_"
        }
    }
} finally {
    Pop-Location
}

# Info-Datei mit Metadaten
$meta = @()
$meta += "# Firebase RTDB Voll-Backup"
$meta += ""
$meta += "Erstellt:  $(Get-Date -Format 'dd.MM.yyyy HH:mm')"
$meta += "Projekt:   taxi-heringsdorf"
$meta += "Instance:  europe-west1"
$meta += ""
$meta += "Wiederherstellung eines Pfads:"
$meta += "  firebase database:set /RESTORE_TEST/customers customers.json"
$meta += "  (immer erst in TEST-Node schreiben, verifizieren, dann verschieben!)"
$meta += ""
$meta += "Voll-Restore in Live-DB nur nach ausdruecklicher Freigabe -"
$meta += "ueberschreibt sonst live-Daten."
$meta -join [System.Environment]::NewLine | Out-File (Join-Path $stage 'RESTORE_INFO.md') -Encoding utf8

# ZIP
$timestamp = Get-Date -Format 'yyyy-MM-dd'
$zipPath = Join-Path $backupDir "firebase-rtdb-$timestamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
$zipInfo = Get-Item $zipPath
$zipMB = [math]::Round($zipInfo.Length / 1MB, 2)
Log "ZIP: $zipPath ($zipMB MB)"

Remove-Item $stage -Recurse -Force

# Cleanup: nur letzte 8 Wochen behalten
$cutoff = (Get-Date).AddDays(-56)
$oldZips = @(Get-ChildItem -Path $backupDir -Filter 'firebase-rtdb-*.zip' | Where-Object { $_.LastWriteTime -lt $cutoff })
foreach ($z in $oldZips) {
    Remove-Item $z.FullName -Force
    Log "Alter Firebase-ZIP entfernt: $($z.Name)"
}
Log "Cleanup: $($oldZips.Count) alte Firebase-ZIPs geloescht"

Log "=== Firebase-RTDB-Backup abgeschlossen ==="
Write-Output "OK: $zipPath ($zipMB MB)"
