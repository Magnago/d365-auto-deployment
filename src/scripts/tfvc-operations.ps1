
# TFVC Operations via .NET Client Libraries
# Bypasses TF.exe which has broken PAT auth (VssBasicCredential/ADAL issue)
# Uses BasicAuthCredential + TfsClientCredentials which properly sends HTTP Basic auth
#
# Usage: powershell -ExecutionPolicy Bypass -File tfvc-operations.ps1 -Operation <op> [-JsonArgs <json>]
#
# Operations:
#   workspaces  - List workspaces
#   getlatest   - Get latest for a branch path
#   merge       - Merge source into target branch
#   status      - Get pending changes
#   checkin     - Check in pending changes
#   edit        - Pend edit on a file
#   conflicts   - Query merge conflicts

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("workspaces","getlatest","merge","status","checkin","edit","conflicts")]
    [string]$Operation,

    [string]$JsonArgs = "{}",
    [string]$EnvFile = "",
    [string]$CollectionUrl = "",
    [string]$Pat = "",
    [string]$WorkspaceName = "",
    [string]$WorkspaceOwner = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- Load .env ---
function Import-DotEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $sep = $line.IndexOf("=")
        if ($sep -lt 1) { return }
        $name = $line.Substring(0, $sep).Trim()
        $value = $line.Substring($sep + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

if ($EnvFile -and (Test-Path $EnvFile)) {
    Import-DotEnv -Path $EnvFile
} else {
    $defaultEnv = Join-Path (Get-Location) ".env"
    if (Test-Path $defaultEnv) { Import-DotEnv -Path $defaultEnv }
}

# --- Resolve parameters ---
if (-not $CollectionUrl) { $CollectionUrl = $env:TFVC_COLLECTION_URL }
if (-not $Pat) { $Pat = if ($env:TFVC_PAT) { $env:TFVC_PAT } else { $env:AZURE_PAT } }
if (-not $WorkspaceName) { $WorkspaceName = $env:TFVC_WORKSPACE }
if (-not $WorkspaceOwner) { $WorkspaceOwner = $env:TFVC_WORKSPACE_OWNER }

# Normalize collection URL
if ($CollectionUrl) {
    $uri = [System.Uri]$CollectionUrl
    if ($uri.Host -and $uri.Host.ToLower().EndsWith("visualstudio.com") -and ($uri.AbsolutePath -eq "/" -or [string]::IsNullOrWhiteSpace($uri.AbsolutePath))) {
        $CollectionUrl = "$($uri.Scheme)://$($uri.Host)/DefaultCollection"
    }
    $CollectionUrl = $CollectionUrl.TrimEnd("/")
}

if (-not $CollectionUrl) { throw "Collection URL is required" }
if (-not $Pat) { throw "PAT is required (set TFVC_PAT or AZURE_PAT)" }
if (-not $WorkspaceName) { throw "Workspace name is required (set TFVC_WORKSPACE)" }

# --- Load TFS assemblies ---
# Look in bundled lib/tfs first (self-contained), then fall back to Visual Studio
$tfDir = $null
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
$bundledDir = Join-Path (Split-Path (Split-Path $scriptDir -Parent) -Parent) "lib\tfs"

$candidates = @($bundledDir) + @(
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer",
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
if (-not $tfDir) { throw "TFS client assemblies not found. Place them in lib/tfs or install Visual Studio with Team Explorer." }

@(
    "Microsoft.TeamFoundation.Client.dll",
    "Microsoft.TeamFoundation.Common.dll",
    "Microsoft.TeamFoundation.VersionControl.Client.dll",
    "Microsoft.VisualStudio.Services.Common.dll",
    "Microsoft.VisualStudio.Services.WebApi.dll"
) | ForEach-Object {
    [System.Reflection.Assembly]::LoadFrom((Join-Path $tfDir $_)) | Out-Null
}

# --- Connect ---
$netCred = New-Object System.Net.NetworkCredential("", $Pat)
$basicCred = New-Object Microsoft.TeamFoundation.Client.BasicAuthCredential($netCred)
$tfsCredentials = New-Object Microsoft.TeamFoundation.Client.TfsClientCredentials($basicCred)
$tfsCredentials.AllowInteractive = $false
$tpc = New-Object Microsoft.TeamFoundation.Client.TfsTeamProjectCollection([Uri]$CollectionUrl, $tfsCredentials)
$tpc.Authenticate()
$vcs = $tpc.GetService([Microsoft.TeamFoundation.VersionControl.Client.VersionControlServer])

# --- Get workspace ---
function Get-TfvcWorkspace {
    $owner = if ($WorkspaceOwner) { $WorkspaceOwner } else { $null }
    return $vcs.GetWorkspace($WorkspaceName, $owner)
}

# --- Parse args ---
$args_obj = $JsonArgs | ConvertFrom-Json

# --- Output helper ---
function Write-JsonResult {
    param([hashtable]$Result)
    $Result | ConvertTo-Json -Depth 10 -Compress
}

# --- Operations ---
try {
    switch ($Operation) {
        "workspaces" {
            $ws = Get-TfvcWorkspace
            $folders = @()
            foreach ($f in $ws.Folders) {
                $folders += @{ serverItem = $f.ServerItem; localItem = $f.LocalItem }
            }
            Write-JsonResult @{
                success = $true
                name = $ws.Name
                owner = $ws.OwnerName
                computer = $ws.Computer
                folders = $folders
            }
        }

        "getlatest" {
            $branchPath = $args_obj.branchPath
            if (-not $branchPath) { throw "branchPath is required" }

            $ws = Get-TfvcWorkspace
            $itemSpec = New-Object Microsoft.TeamFoundation.VersionControl.Client.ItemSpec($branchPath, [Microsoft.TeamFoundation.VersionControl.Client.RecursionType]::Full)
            $getRequest = New-Object Microsoft.TeamFoundation.VersionControl.Client.GetRequest($itemSpec, [Microsoft.TeamFoundation.VersionControl.Client.VersionSpec]::Latest)

            $getOptions = [Microsoft.TeamFoundation.VersionControl.Client.GetOptions]::Overwrite -bor [Microsoft.TeamFoundation.VersionControl.Client.GetOptions]::GetAll
            $getStatus = $ws.Get($getRequest, $getOptions)

            Write-JsonResult @{
                success = $true
                branchPath = $branchPath
                numFiles = $getStatus.NumFiles
                numUpdated = $getStatus.NumUpdated
                numConflicts = $getStatus.NumConflicts
                numFailures = $getStatus.NumFailures
                noActionNeeded = $getStatus.NoActionNeeded
            }
        }

        "merge" {
            $sourcePath = $args_obj.sourcePath
            $targetPath = $args_obj.targetPath
            if (-not $sourcePath -or -not $targetPath) { throw "sourcePath and targetPath are required" }

            $ws = Get-TfvcWorkspace
            $mergeStatus = $ws.Merge(
                $sourcePath,
                $targetPath,
                $null,  # versionFrom
                $null,  # versionTo
                [Microsoft.TeamFoundation.VersionControl.Client.LockLevel]::Unchanged,
                [Microsoft.TeamFoundation.VersionControl.Client.RecursionType]::Full,
                [Microsoft.TeamFoundation.VersionControl.Client.MergeOptions]::None
            )

            $conflicts = $ws.QueryConflicts(@($targetPath), $true)

            Write-JsonResult @{
                success = $true
                sourcePath = $sourcePath
                targetPath = $targetPath
                numFiles = $mergeStatus.NumFiles
                numUpdated = $mergeStatus.NumUpdated
                numConflicts = $conflicts.Length
                noActionNeeded = $mergeStatus.NoActionNeeded
            }
        }

        "status" {
            $path = $args_obj.path
            if (-not $path) { throw "path is required" }

            $ws = Get-TfvcWorkspace
            $pendingChanges = $ws.GetPendingChanges($path, [Microsoft.TeamFoundation.VersionControl.Client.RecursionType]::Full)

            $changes = @()
            foreach ($pc in $pendingChanges) {
                $changes += @{
                    serverItem = $pc.ServerItem
                    localItem = $pc.LocalItem
                    changeType = $pc.ChangeType.ToString()
                }
            }

            Write-JsonResult @{
                success = $true
                path = $path
                count = $pendingChanges.Length
                changes = $changes
            }
        }

        "conflicts" {
            $path = $args_obj.path
            if (-not $path) { throw "path is required" }

            $ws = Get-TfvcWorkspace
            $conflicts = $ws.QueryConflicts(@($path), $true)

            $conflictList = @()
            foreach ($c in $conflicts) {
                $conflictList += @{
                    serverItem = $c.YourServerItem
                    type = $c.ConflictType.ToString()
                    resolution = $c.Resolution.ToString()
                }
            }

            Write-JsonResult @{
                success = $true
                path = $path
                count = $conflicts.Length
                conflicts = $conflictList
            }
        }

        "edit" {
            $filePath = $args_obj.filePath
            if (-not $filePath) { throw "filePath is required" }

            $ws = Get-TfvcWorkspace
            $result = $ws.PendEdit($filePath)

            Write-JsonResult @{
                success = $true
                filePath = $filePath
                pendedCount = $result
            }
        }

        "checkin" {
            $path = $args_obj.path
            $comment = $args_obj.comment
            if (-not $path) { throw "path is required" }
            if (-not $comment) { $comment = "Auto-deployment checkin" }

            $ws = Get-TfvcWorkspace
            $pendingChanges = $ws.GetPendingChanges($path, [Microsoft.TeamFoundation.VersionControl.Client.RecursionType]::Full)

            if ($pendingChanges.Length -eq 0) {
                Write-JsonResult @{
                    success = $true
                    message = "No pending changes to check in"
                    changeset = $null
                }
                return
            }

            $changeset = $ws.CheckIn($pendingChanges, $comment)

            Write-JsonResult @{
                success = $true
                changeset = $changeset
                comment = $comment
                filesCheckedIn = $pendingChanges.Length
            }
        }
    }
} catch {
    $errorResult = @{
        success = $false
        error = $_.Exception.Message
    }
    if ($_.Exception.InnerException) {
        $errorResult.innerError = $_.Exception.InnerException.Message
    }
    Write-JsonResult $errorResult
    exit 1
} finally {
    if ($tpc) { $tpc.Dispose() }
}
