# v6.63.1014: Taeglicher Backup-Job - 22:00 via Task Scheduler
#
# Patrick 29.08.: "am besten jeden Tag wenn wir eine Session gemacht haben separates zip"
#
# Logik:
#   1) Change-Detection: Wenn seit letztem ZIP nichts angefasst wurde → skip
#   2) Copy: Claude-Memory + .bridge_*.txt + WIP-Scripts + git-Patches
#   3) Firebase Auth Users Export (klein, kritisch)
#   4) Firebase Functions Config Export (klein, sensibel)
#   5) CLAUDE.md, .env (SENSITIVE-Praefix), Branch-Liste, letzte Commits
#   6) RESTORE_README.md schreiben
#   7) Alles in EIN ZIP → OneDrive\Backups\
#   8) Alte ZIPs > 30 Tage loeschen
#
# Manueller Aufruf:  powershell -File "C:\Taxi App\taxi-App-github\scripts\daily-backup.ps1"
# Force-Backup (auch ohne Aenderungen):  powershell -File "...\daily-backup.ps1" -Force
#
# Log: %TEMP%\taxi-app-backup.log (pro Lauf ueberschrieben)

param(
    [switch]$Force
)

# v1014: 'Continue' statt 'Stop' — sonst zerlegt PowerShell 5.1 den Skript bei
#   harmlosen git-stderr-Warnings (CRLF/LF-Endings, hint-Messages etc.), die es
#   als NativeCommandError durchreicht. Wir setzen 'Stop' nicht mehr, prüfen
#   stattdessen die Ergebnisse (Datei existiert? nicht leer?) explizit.
$ErrorActionPreference = 'Continue'
$repoRoot = 'C:\Taxi App\taxi-App-github'
$memoryDir = Join-Path $env:USERPROFILE '.claude\projects\C--Taxi-App-taxi-App-github\memory'
$backupDir = Join-Path $env:USERPROFILE 'OneDrive\Backups'
$stage = Join-Path $env:TEMP ('taxi-app-backup-staging-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$logFile = Join-Path $env:TEMP 'taxi-app-backup.log'

function Log($msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $msg"
    Write-Output $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

if (Test-Path $logFile) { Remove-Item $logFile -Force }

Log "=== Daily-Backup gestartet (Force=$Force) ==="

if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Log "Backup-Zielverzeichnis erstellt: $backupDir"
}

# --- Change-Detection ---
$lastZip = Get-ChildItem -Path $backupDir -Filter 'taxi-app-backup-*.zip' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $Force -and $lastZip) {
    $sinceTime = $lastZip.LastWriteTime
    Log "Letzter ZIP: $($lastZip.Name) vom $sinceTime"

    # Aenderungen seit letztem ZIP?
    $memoryChanged = $false
    if (Test-Path $memoryDir) {
        $memoryChanged = (Get-ChildItem $memoryDir -File | Where-Object { $_.LastWriteTime -gt $sinceTime }).Count -gt 0
    }
    $bridgeChanged = (Get-ChildItem -Path $repoRoot -Filter '.bridge_*.txt' -Force -File -ErrorAction SilentlyContinue |
                      Where-Object { $_.LastWriteTime -gt $sinceTime }).Count -gt 0

    Push-Location $repoRoot
    try {
        $gitChanges = (git status --short 2>$null | Measure-Object -Line).Lines
        $newCommits = 0
        $lastCommitSince = git log --since="$($sinceTime.ToString('yyyy-MM-ddTHH:mm:ss'))" --oneline 2>$null
        if ($lastCommitSince) { $newCommits = ($lastCommitSince | Measure-Object -Line).Lines }
    } finally {
        Pop-Location
    }

    Log "Change-Check: memory=$memoryChanged, bridge=$bridgeChanged, gitStatus=$gitChanges, neueCommits=$newCommits"

    if (-not ($memoryChanged -or $bridgeChanged -or $gitChanges -gt 0 -or $newCommits -gt 0)) {
        Log "Keine Aenderungen seit letztem ZIP - Skip Backup."
        Write-Output "SKIP: Keine Aenderungen seit $sinceTime"
        return
    }
    Log "Aenderungen erkannt - Backup laeuft."
} else {
    Log "Force=$Force oder kein Vor-ZIP - Backup laeuft."
}

# --- Staging ---
New-Item -ItemType Directory -Path $stage -Force | Out-Null
'memory','untracked-notes','untracked-scripts','uncommitted','repo-config','firebase-export' | ForEach-Object {
    New-Item -ItemType Directory -Path (Join-Path $stage $_) -Force | Out-Null
}

# --- Memory ---
if (Test-Path $memoryDir) {
    Copy-Item -Path (Join-Path $memoryDir '*') -Destination (Join-Path $stage 'memory') -Recurse -Force
    $memoryCount = (Get-ChildItem (Join-Path $stage 'memory') -File).Count
    Log "Memory kopiert: $memoryCount Files"
}

# --- Bridge-Notizen ---
Push-Location $repoRoot
try {
    $bridgeFiles = @(Get-ChildItem -Path $repoRoot -Filter '.bridge_*.txt' -Force -File -ErrorAction SilentlyContinue)
    foreach ($f in $bridgeFiles) {
        Copy-Item $f.FullName (Join-Path $stage 'untracked-notes\') -Force
    }
    Log "Bridge-Notizen: $($bridgeFiles.Count)"

    # --- Untracked Scripts ---
    $untrackedScripts = @(git ls-files --others --exclude-standard -- scripts/ 2>$null)
    $scriptCount = 0
    foreach ($rel in $untrackedScripts) {
        if ([string]::IsNullOrWhiteSpace($rel)) { continue }
        $abs = Join-Path $repoRoot $rel
        if (Test-Path $abs) {
            Copy-Item $abs (Join-Path $stage 'untracked-scripts\') -Force
            $scriptCount++
        }
    }
    Log "Untracked Scripts: $scriptCount"

    # --- Uncommitted ---
    git diff HEAD 2>$null | Out-File (Join-Path $stage 'uncommitted\current-branch-uncommitted.patch') -Encoding utf8
    git status --short 2>$null | Out-File (Join-Path $stage 'uncommitted\git-status.txt') -Encoding utf8
    git stash list 2>$null | Out-File (Join-Path $stage 'uncommitted\stash-list.txt') -Encoding utf8
    $stashLines = @(git stash list 2>$null)
    for ($i = 0; $i -lt $stashLines.Count; $i++) {
        git stash show -p "stash@{$i}" 2>$null | Out-File (Join-Path $stage "uncommitted\stash-$i.patch") -Encoding utf8
    }
    Log "Uncommitted-Patches: $($stashLines.Count) stashes"

    # --- Repo-Config ---
    if (Test-Path (Join-Path $repoRoot 'CLAUDE.md')) {
        Copy-Item (Join-Path $repoRoot 'CLAUDE.md') (Join-Path $stage 'repo-config\') -Force
    }
    if (Test-Path (Join-Path $repoRoot '.env')) {
        Copy-Item (Join-Path $repoRoot '.env') (Join-Path $stage 'repo-config\.env.SENSITIVE-CHECK-BEFORE-RESTORE') -Force
    }
    git branch -a 2>$null | Out-File (Join-Path $stage 'repo-config\all-branches.txt') -Encoding utf8
    git log --oneline --all -100 2>$null | Out-File (Join-Path $stage 'repo-config\recent-commits.txt') -Encoding utf8
    $currentBranch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
    $currentCommit = (git rev-parse --short HEAD 2>$null).Trim()

    # --- Firebase Auth Users Export (klein, kritisch) ---
    try {
        $authOut = Join-Path $stage 'firebase-export\auth-users.json'
        firebase auth:export $authOut --format=json 2>&1 | Out-Null
        if (Test-Path $authOut) {
            $userCount = (Get-Content $authOut | ConvertFrom-Json).users.Count
            Log "Firebase Auth Users exportiert: $userCount Users"
        }
    } catch {
        Log "WARN: Firebase Auth Export fehlgeschlagen: $_"
    }

    # --- Firebase Functions Config Export ---
    try {
        $cfgOut = Join-Path $stage 'firebase-export\functions-config.json'
        firebase functions:config:get 2>$null | Out-File $cfgOut -Encoding utf8
        if ((Get-Item $cfgOut).Length -gt 3) {
            Log "Firebase Functions Config exportiert"
        }
    } catch {
        Log "WARN: Functions Config Export fehlgeschlagen: $_"
    }

    # --- Firebase Kern-Settings (klein, wichtig) ---
    try {
        $env:MSYS_NO_PATHCONV = '1'
        $settingsOut = Join-Path $stage 'firebase-export\settings-snapshot.json'
        firebase database:get /settings 2>$null | Out-File $settingsOut -Encoding utf8
        if ((Get-Item $settingsOut).Length -gt 100) {
            Log "Firebase /settings snapshot exportiert"
        }
    } catch {
        Log "WARN: Settings-Export fehlgeschlagen: $_"
    }

} finally {
    Pop-Location
}

# --- RESTORE_README.md ---
# ASCII-safe (kein em-dash, keine Backticks) damit PowerShell-Parser nicht meckert
$now = Get-Date -Format 'dd.MM.yyyy HH:mm'
$lines = @()
$lines += "# Taxi-App Backup - Wiederherstellungs-Anleitung"
$lines += ""
$lines += "Erstellt:            $now"
$lines += "Erstellt von:        daily-backup.ps1 (v6.63.1014)"
$lines += "Aktueller Branch:    $currentBranch"
$lines += "Aktueller Commit:    $currentCommit"
$lines += "Repo:                https://github.com/Patrick061977/taxi-App"
$lines += ""
$lines += "## Was ist in diesem ZIP?"
$lines += ""
$lines += "  memory/            - Claude persistente Erinnerungen ($memoryCount Files)"
$lines += "  untracked-notes/   - Alle .bridge_*.txt (Telegram-Bridge-Notizen)"
$lines += "  untracked-scripts/ - One-Off Scripts nicht in git"
$lines += "  uncommitted/       - git-diff / git-stash Patches (WIP-Code)"
$lines += "  repo-config/       - CLAUDE.md, Branch-Liste, letzte 100 Commits, .env (SENSIBEL!)"
$lines += "  firebase-export/   - Auth-Users, Functions-Config, /settings-Snapshot"
$lines += ""
$lines += "## Was ist NICHT im ZIP (und wo es liegt)"
$lines += ""
$lines += "  Committed Code               -> GitHub                 (git clone)"
$lines += "  node_modules                 -> rekonstruierbar        (npm install)"
$lines += "  Firebase RTDB /rides usw.    -> Google Cloud           (firebase database:get)"
$lines += "  Firebase Storage             -> Google Cloud           (gsutil rsync)"
$lines += "  Android Release-Keystore     -> GitHub Secret          (Workflow keystore-export.yml)"
$lines += "  Google Apps Script Code      -> script.google.com      (Repo google-apps-script/)"
$lines += "  Domain umwelt-taxi-...       -> Strato-Konto           (Login-Daten aus KeePass)"
$lines += "  Strato FTP Creds             -> GitHub Secrets         (STRATO_FTP_*)"
$lines += "  Firebase-Projekt             -> Google-Konto           (firebase login)"
$lines += ""
$lines += "## Wiederherstellungs-Reihenfolge nach HDD-Crash"
$lines += ""
$lines += "  1) Windows + Git + Node.js LTS installieren"
$lines += "  2) git clone https://github.com/Patrick061977/taxi-App.git"
$lines += "     cd taxi-App && npm install"
$lines += "  3) ZIP entpacken -> Inhalte an folgende Zielorte:"
$lines += "     memory/*             -> %USERPROFILE%/.claude/projects/C--Taxi-App-taxi-App-github/memory/"
$lines += "     untracked-notes/*    -> C:/Taxi App/taxi-App-github/ (Root)"
$lines += "     untracked-scripts/*  -> C:/Taxi App/taxi-App-github/scripts/"
$lines += "     uncommitted/*.patch  -> git apply im Repo"
$lines += "     repo-config/.env.SENSITIVE-... -> nach PRUEFUNG als .env einspielen"
$lines += "  4) Auth: firebase login / gcloud auth login / gh auth login"
$lines += "  5) Android-Keystore: GitHub Actions -> Keystore Export -> manuell triggern"
$lines += "  6) Daily-Backup registrieren: scripts/daily-backup-register-task.ps1"
$lines += ""
$lines += "## Sensible Daten in diesem ZIP"
$lines += ""
$lines += "  .env                             - API-Keys (Finnhub, GMAIL, Firebase-SA)"
$lines += "  firebase-export/functions-config - Backend-Secrets"
$lines += "  firebase-export/auth-users.json  - User-Hashes (Firebase salted)"
$lines += ""
$lines += "Empfehlung: ZIP NICHT ungeschuetzt in Cloud-Ordnern liegen lassen."
$lines += "OneDrive at-rest-Encryption ist gut, aber E2E-Verschluesselung besser."

$lines -join [System.Environment]::NewLine | Out-File (Join-Path $stage 'RESTORE_README.md') -Encoding utf8
Log "RESTORE_README.md geschrieben"

# --- ZIP ---
$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$zipPath = Join-Path $backupDir "taxi-app-backup-$timestamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
$zipInfo = Get-Item $zipPath
$zipKB = [math]::Round($zipInfo.Length / 1KB, 1)
Log "ZIP: $zipPath ($zipKB KB)"

# --- Staging cleanup ---
Remove-Item $stage -Recurse -Force

# --- Alte ZIPs > 30 Tage weg ---
$cutoff = (Get-Date).AddDays(-30)
$oldZips = @(Get-ChildItem -Path $backupDir -Filter 'taxi-app-backup-*.zip' | Where-Object { $_.LastWriteTime -lt $cutoff })
foreach ($z in $oldZips) {
    Remove-Item $z.FullName -Force
    Log "Alter ZIP entfernt: $($z.Name)"
}
Log "Cleanup: $($oldZips.Count) alte ZIPs geloescht"

Log "=== Daily-Backup abgeschlossen ==="
Write-Output "OK: $zipPath ($zipKB KB)"
