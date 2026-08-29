# v6.63.1015: Registriert weekly-firebase-backup.ps1 als Scheduled Task
# Sonntags 03:00 (nachts, damit Firebase-Query nicht mit Tages-Betrieb kollidiert)

$ErrorActionPreference = 'Stop'

$taskName = 'TaxiApp-WeeklyFirebaseBackup'
$scriptPath = 'C:\Taxi App\taxi-App-github\scripts\weekly-firebase-backup.ps1'

if (-not (Test-Path $scriptPath)) {
    Write-Error "Backup-Script nicht gefunden: $scriptPath"
    exit 1
}

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Alter Task entfernt: $taskName"
}

# Trigger: Woechentlich Sonntag 03:00
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '03:00'

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Description 'Taxi-App: woechentlicher Firebase RTDB Voll-Backup (Sonntags 03:00)' `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Output "OK: Task '$taskName' registriert - laeuft Sonntags 03:00"
