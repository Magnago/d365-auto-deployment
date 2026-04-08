@echo off
echo Creating scheduled task "D365 Auto Deployment" to run daily at 8:00 PM EST...

schtasks /create /tn "D365 Auto Deployment" /tr "powershell.exe -ExecutionPolicy Bypass -File \"C:\d365-auto-deployment\run-pipeline.ps1\"" /sc daily /st 20:00 /rl highest /f

if %errorlevel% equ 0 (
    echo Task created successfully.
) else (
    echo Failed to create the task. Make sure you are running as Administrator.
)

pause
