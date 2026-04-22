param(
    [string]$WorkingDir = "C:\d365-auto-deployment"
)

try {
    Set-Location -Path $WorkingDir

    Write-Host "[$(Get-Date -Format o)] Starting npm run dev in $WorkingDir"

    npm run dev

    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm run dev failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Error "Error: $_"
}

Write-Host "[$(Get-Date -Format o)] npm run dev completed successfully"
