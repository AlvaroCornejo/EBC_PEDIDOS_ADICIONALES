# ============================================================
#  Instala la tarea programada en el Programador de tareas
#  de Windows para importar compras cada lunes a las 6:00 AM.
#
#  Ejecutar UNA VEZ como Administrador:
#    Right-click → "Ejecutar como administrador" en PowerShell
#    .\scripts\instalar-tarea-programada.ps1
# ============================================================

$TaskName   = "ImportarComprasEBC"
$ScriptPath = "C:\pedidos-app\scripts\ejecutar-importacion.bat"
$LogPath    = Join-Path $PSScriptRoot "importacion.log"

# Verificar que el bat existe
if (-not (Test-Path $ScriptPath)) {
    Write-Error "No se encontro el archivo: $ScriptPath"
    exit 1
}

# Eliminar tarea anterior si existe
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea anterior eliminada." -ForegroundColor Yellow
}

# Accion: ejecutar el .bat con cmd
$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$ScriptPath`""

# Disparador: cada lunes a las 6:00 AM
$Trigger = New-ScheduledTaskTrigger `
    -Weekly `
    -DaysOfWeek Monday `
    -At "06:00AM"

# Configuracion: ejecutar aunque el usuario no haya iniciado sesion
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# Registrar la tarea con el usuario actual
$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType S4U `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Importa el historial de compras EBC desde Excel a MongoDB Atlas. Se ejecuta cada lunes a las 6:00 AM." `
    -Force | Out-Null

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host " Tarea programada instalada correctamente" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Nombre  : $TaskName"
Write-Host "  Horario : Cada lunes a las 6:00 AM"
Write-Host "  Script  : $ScriptPath"
Write-Host "  Log     : $LogPath"
Write-Host ""
Write-Host "Puedes verla en: Programador de tareas > Biblioteca"
Write-Host ""

# Ofrecer ejecucion de prueba inmediata
$resp = Read-Host "¿Ejecutar ahora para probar? (S/N)"
if ($resp -match "^[Ss]") {
    Write-Host "Ejecutando..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 5
    Write-Host ""
    Write-Host "Ultimas lineas del log:" -ForegroundColor Cyan
    if (Test-Path $LogPath) {
        Get-Content $LogPath -Tail 15
    } else {
        Write-Host "(el log aun no existe, la tarea puede seguir corriendo)"
    }
}
