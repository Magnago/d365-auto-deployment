param(
    [string]$EnvFile = ".env",
    [string]$CollectionUrl,
    [string]$Username,
    [string]$Password,
    [string]$Pat,
    [string]$ComputerName,
    [string]$TfExePath,
    [ValidateSet("password", "pat", "auto")]
    [string]$CredentialMode = "auto",
    [switch]$SkipCacheCleanup,
    [switch]$RemoveWindowsCredentials,
    [switch]$VerifyExplicitCredentialUsage,
    [switch]$FailWhenImplicitAuthDetected,
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host "=== $Message ==="
}

function Import-DotEnv {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }

        $separator = $line.IndexOf("=")
        if ($separator -lt 1) {
            return
        }

        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()

        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Resolve-TfDir {
    $candidates = @(
        "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
        "C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
        "C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
        "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "Microsoft.TeamFoundation.Client.dll")) {
            return $candidate
        }
    }

    throw "TFS client assemblies not found. Install Visual Studio with Team Explorer."
}

function Normalize-CollectionUrl {
    param([string]$RawUrl)

    if (-not $RawUrl) {
        return $RawUrl
    }

    $uri = [System.Uri]$RawUrl
    $builder = [System.UriBuilder]$uri
    if ($builder.Host.ToLowerInvariant().EndsWith("visualstudio.com") -and ($builder.Path -eq "/" -or [string]::IsNullOrWhiteSpace($builder.Path))) {
        $builder.Path = "/DefaultCollection"
    }

    return $builder.Uri.ToString().TrimEnd("/")
}

function Get-SelectedCredential {
    param(
        [string]$Mode,
        [string]$PasswordValue,
        [string]$PatValue
    )

    switch ($Mode) {
        "password" {
            if (-not $PasswordValue) {
                throw "CredentialMode=password requires TFVC_PASSWORD or -Password."
            }
            return @{ Source = "password"; Value = $PasswordValue }
        }
        "pat" {
            if (-not $PatValue) {
                throw "CredentialMode=pat requires TFVC_PAT, AZURE_PAT, or -Pat."
            }
            return @{ Source = "pat"; Value = $PatValue }
        }
        default {
            if ($PatValue) {
                return @{ Source = "pat"; Value = $PatValue }
            }
            if ($PasswordValue) {
                return @{ Source = "password"; Value = $PasswordValue }
            }
            throw "No credential value found. Provide -Password, -Pat, or values in the .env file."
        }
    }
}

function Pause-BeforeExit {
    if (-not $NoPause) {
        Write-Host ""
        Read-Host "Press Enter to close this window"
    }
}

try {
    Import-DotEnv -Path $EnvFile

    $CollectionUrl = if ($CollectionUrl) { $CollectionUrl } else { $env:TFVC_COLLECTION_URL }
    $Username = if ($Username) { $Username } else { $env:TFVC_USERNAME }
    $Password = if ($Password) { $Password } else { $env:TFVC_PASSWORD }
    $Pat = if ($Pat) { $Pat } else { if ($env:TFVC_PAT) { $env:TFVC_PAT } else { $env:AZURE_PAT } }
    $ComputerName = if ($ComputerName) { $ComputerName } else { $env:COMPUTERNAME }
    $Workspace = $env:TFVC_WORKSPACE
    $WorkspaceOwner = $env:TFVC_WORKSPACE_OWNER

    $CollectionUrl = Normalize-CollectionUrl -RawUrl $CollectionUrl

    if (-not $CollectionUrl) { throw "TFVC collection URL is required." }
    if (-not $ComputerName) { throw "Computer name is required." }

    $selectedCredential = Get-SelectedCredential -Mode $CredentialMode -PasswordValue $Password -PatValue $Pat

    Write-Section "TFVC Auth Diagnostic"
    Write-Host "Collection: $CollectionUrl"
    Write-Host "Computer: $ComputerName"
    Write-Host "Username: $Username"
    Write-Host "Workspace: $Workspace"
    Write-Host "Credential source: $($selectedCredential.Source)"

    # --- Method 1: .NET BasicAuthCredential (recommended) ---
    Write-Section "Method 1: .NET BasicAuthCredential (recommended)"
    $tfDir = $null
    $bundledDir = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "lib\tfs"
    if (Test-Path (Join-Path $bundledDir "Microsoft.TeamFoundation.Client.dll")) {
        $tfDir = $bundledDir
    } else {
        $tfDir = Resolve-TfDir
    }
    Write-Host "TFS assemblies: $tfDir"

    @(
        "Microsoft.TeamFoundation.Client.dll",
        "Microsoft.TeamFoundation.Common.dll",
        "Microsoft.TeamFoundation.VersionControl.Client.dll",
        "Microsoft.VisualStudio.Services.Common.dll",
        "Microsoft.VisualStudio.Services.WebApi.dll"
    ) | ForEach-Object {
        [System.Reflection.Assembly]::LoadFrom((Join-Path $tfDir $_)) | Out-Null
    }

    try {
        $netCred = New-Object System.Net.NetworkCredential("", $selectedCredential.Value)
        $basicCred = New-Object Microsoft.TeamFoundation.Client.BasicAuthCredential($netCred)
        $tfsCredentials = New-Object Microsoft.TeamFoundation.Client.TfsClientCredentials($basicCred)
        $tfsCredentials.AllowInteractive = $false
        $tpc = New-Object Microsoft.TeamFoundation.Client.TfsTeamProjectCollection([Uri]$CollectionUrl, $tfsCredentials)
        $tpc.Authenticate()
        Write-Host "Authentication: SUCCESS"
        Write-Host "Authenticated as: $($tpc.AuthorizedIdentity.DisplayName) ($($tpc.AuthorizedIdentity.UniqueName))"

        $vcs = $tpc.GetService([Microsoft.TeamFoundation.VersionControl.Client.VersionControlServer])

        if ($Workspace) {
            try {
                $owner = if ($WorkspaceOwner) { $WorkspaceOwner } else { $null }
                $ws = $vcs.GetWorkspace($Workspace, $owner)
                Write-Host "Workspace '$Workspace' found (Owner: $($ws.OwnerName), Computer: $($ws.Computer))"
                foreach ($folder in $ws.Folders) {
                    Write-Host "  $($folder.ServerItem) => $($folder.LocalItem)"
                }
            } catch {
                Write-Host "Workspace '$Workspace' not found: $($_.Exception.Message)"
            }
        }

        $tpc.Dispose()
        Write-Host ""
        Write-Host "*** .NET BasicAuthCredential works. The deployment pipeline will use this method. ***"
    } catch {
        Write-Host "FAILED: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "BasicAuthCredential also failed. Check that:"
        Write-Host "  1. The PAT is valid and not expired"
        Write-Host "  2. The PAT has the correct scopes (Code: Full)"
        Write-Host "  3. The collection URL is correct"
    }

    # --- Method 2: TF.exe /login (for reference) ---
    Write-Section "Method 2: TF.exe /login (known broken with PAT on VS 2019)"
    $tfExePath = Join-Path $tfDir "TF.exe"
    if (Test-Path $tfExePath) {
        Write-Host "TF.exe: $tfExePath"
        $loginArg = "/login:{0},{1}" -f $Username, $selectedCredential.Value
        try {
            $output = & $tfExePath workspaces /collection:$CollectionUrl /format:brief "/computer:$ComputerName" /owner:* /noprompt $loginArg 2>&1
            Write-Host "TF.exe /login: Exit code $LASTEXITCODE"
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Output: $($output -join ' ')"
                Write-Host ""
                Write-Host "This is expected. TF.exe's VssBasicCredential/ADAL auth is broken for PATs"
                Write-Host "on Azure DevOps Services with VS 2019. The pipeline uses .NET BasicAuthCredential instead."
            } else {
                Write-Host "TF.exe /login also works on this machine."
            }
        } catch {
            Write-Host "TF.exe error: $($_.Exception.Message)"
        }
    }

    Write-Section "Result"
    Write-Host "TFVC auth diagnostic complete."
    Pause-BeforeExit
    exit 0
} catch {
    Write-Section "Result"
    Write-Host "TFVC auth diagnostic failed: $($_.Exception.Message)"
    Pause-BeforeExit
    exit 1
}
