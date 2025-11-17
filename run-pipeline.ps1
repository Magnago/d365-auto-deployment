param(
    [string]$WorkingDir = "C:\Workspace\d365-auto-deployment"
)

try {
    Set-Location -Path $WorkingDir
} catch {
    Write-Error "Failed to change directory to $WorkingDir. $_"
    exit 1
}

Write-Host "[$(Get-Date -Format o)] Starting npm run dev in $WorkingDir"

$process = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -NoNewWindow -Wait -PassThru

if ($process.ExitCode -ne 0) {
    Write-Error "npm run dev failed with exit code $($process.ExitCode)"
    exit $process.ExitCode
}

Write-Host "[$(Get-Date -Format o)] npm run dev completed successfully"
