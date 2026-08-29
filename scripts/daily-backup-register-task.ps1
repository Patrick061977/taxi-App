# v6.63.1014: Registriert daily-backup.ps1 als Windows Scheduled Task
#
# Task-Konfiguration:
#   - Name: TaxiApp-DailyBackup
#   - Trigger: Taeglich 22:00
#   - Action: PowerShell -File "...\daily-backup.ps1"
#   - Runs only when user is logged on (kein Passwort noetig)
#   - MissedRuns: Fuehrt beim naechsten Login aus wenn PC beim Trigger aus war
#
# Aufruf (einmalig):
#   powershell -File "C:\Taxi App\taxi-App-github\scripts\daily-backup-register-task.ps1"
#
# Deregistrieren:
#   Unregister-ScheduledTask -TaskName "TaxiApp-DailyBackup" -Confirm:$false

$ErrorActionPreference = 'Stop'

$taskName = 'TaxiApp-DailyBackup'
$scriptPath = 'C:\Taxi App\taxi-App-github\scripts\daily-backup.ps1'

if (-not (Test-Path $scriptPath)) {
    Write-Error "Backup-Script nicht gefunden: $scriptPath"
    exit 1
}

# Alten Task loeschen falls vorhanden
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Alter Task entfernt: $taskName"
}

# Trigger: taeglich 22:00
$trigger = New-ScheduledTaskTrigger -Daily -At '22:00'

# Action: PowerShell mit -NoProfile fuer schnellen Start
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

# Settings: Bei verpasstem Run nachholen, kein Abbruch bei Netzstoerung, kein Task-Blocking
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

# Principal: nur wenn User eingeloggt (kein Passwort noetig)
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Description 'Taxi-App: taeglicher Backup-ZIP nach OneDrive\Backups (nur wenn Session-Aenderungen vorhanden)' `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Output "OK: Task '$taskName' registriert - laeuft taeglich 22:00"
Write-Output ""
Write-Output "Ueberpruefen: Get-ScheduledTask -TaskName '$taskName' | Select-Object State, LastRunTime, NextRunTime"
Write-Output "Manuell testen: Start-ScheduledTask -TaskName '$taskName'"
Write-Output "Backup ohne Change-Detection: powershell -File '$scriptPath' -Force"
