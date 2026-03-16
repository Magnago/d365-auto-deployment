# Copies the required TFS .NET client assemblies from Visual Studio into lib/tfs.
# Run this once when setting up the project on a new machine.
# These DLLs enable PAT authentication with Azure DevOps TFVC
# using BasicAuthCredential (bypasses TF.exe's broken ADAL auth).

param([switch]$Force)

$ErrorActionPreference = "Stop"
$libDir = Join-Path $PSScriptRoot "lib\tfs"

if ((Test-Path (Join-Path $libDir "Microsoft.TeamFoundation.Client.dll")) -and -not $Force) {
    Write-Host "lib\tfs already exists. Use -Force to overwrite."
    exit 0
}

$tfDir = $null
$candidates = @(
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer"
)

foreach ($c in $candidates) {
    if (Test-Path (Join-Path $c "Microsoft.TeamFoundation.Client.dll")) {
        $tfDir = $c
        break
    }
}

if (-not $tfDir) {
    Write-Error "Visual Studio with Team Explorer not found. Cannot copy TFS assemblies."
    exit 1
}

Write-Host "Source: $tfDir"

$dlls = @(
    "Microsoft.TeamFoundation.Client.dll",
    "Microsoft.TeamFoundation.Common.dll",
    "Microsoft.TeamFoundation.VersionControl.Client.dll",
    "Microsoft.TeamFoundation.VersionControl.Common.dll",
    "Microsoft.TeamFoundation.VersionControl.Common.Integration.dll",
    "Microsoft.TeamFoundation.Core.WebApi.dll",
    "Microsoft.TeamFoundation.Diff.dll",
    "Microsoft.TeamFoundation.ProjectManagement.dll",
    "Microsoft.TeamFoundation.Work.WebApi.dll",
    "Microsoft.TeamFoundation.WorkItemTracking.Client.dll",
    "Microsoft.TeamFoundation.WorkItemTracking.Client.DataStoreLoader.dll",
    "Microsoft.TeamFoundation.WorkItemTracking.Client.QueryLanguage.dll",
    "Microsoft.TeamFoundation.WorkItemTracking.Common.dll",
    "Microsoft.TeamFoundation.WorkItemTracking.Proxy.dll",
    "Microsoft.TeamFoundation.WorkItemTracking.WebApi.dll",
    "Microsoft.VisualStudio.Services.Common.dll",
    "Microsoft.VisualStudio.Services.WebApi.dll",
    "Microsoft.VisualStudio.Services.Client.Interactive.dll",
    "Microsoft.IdentityModel.Clients.ActiveDirectory.dll",
    "Microsoft.IdentityModel.Logging.dll",
    "Microsoft.IdentityModel.Tokens.dll",
    "System.IdentityModel.Tokens.Jwt.dll",
    "System.Net.Http.Formatting.dll",
    "Microsoft.ServiceBus.dll",
    "Newtonsoft.Json.dll"
)

if (-not (Test-Path $libDir)) {
    New-Item -ItemType Directory -Path $libDir -Force | Out-Null
}

$copied = 0
foreach ($dll in $dlls) {
    $src = Join-Path $tfDir $dll
    if (Test-Path $src) {
        Copy-Item $src $libDir -Force
        $copied++
    } else {
        Write-Warning "Not found: $dll"
    }
}

Write-Host "Copied $copied DLLs to lib\tfs"
