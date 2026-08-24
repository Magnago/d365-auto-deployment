# D365 F&O Automated Deployment Solution

A fully automated deployment pipeline for Dynamics 365 Finance & Operations that orchestrates TFVC source control operations, X++ compilation, database synchronization, SSRS report deployment, and Teams notifications.

## Features

- **TFVC Branch Operations** - Automated merge from source to target branch with conflict detection and version bumping
- **X++ Compilation** - Full model build using `xppc.exe`
- **Database Synchronization** - Schema sync via `SyncEngine.exe` against AxDB
- **SSRS Report Deployment** - Automated report deployment using D365's built-in PowerShell script
- **Service Control** - Automatic stop/start of IIS, SSRS, Batch, DMF, and MR services around deployments
- **Cross-Environment Support** - Works with local (C: drive) and cloud (K: drive) D365 environments
- **Teams Notifications** - Deployment start, success, and failure notifications via webhook
- **Comprehensive Logging** - Winston-based structured logging with file rotation
- **Standalone Executable** - Can be packaged as a Windows `.exe` for distribution without Node.js

## Prerequisites

- **Windows Server 2016+**
- **Node.js 16+**
- **PowerShell 5.1+**
- **Visual Studio 2019/2022** with Team Explorer (for TFS assemblies)
- **D365 F&O** development environment (provides `xppc.exe`, `SyncEngine.exe`, report deployment scripts)
- **TFVC workspace** already configured locally with source and target branches mapped

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up TFS Libraries

Copy the required .NET TFS assemblies from Visual Studio into `lib/tfs`:

```powershell
powershell -ExecutionPolicy Bypass -File setup-tfs-libs.ps1
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials and settings
```

### 4. Verify TFVC Authentication

```bash
npm run tfvc:auth
```

### 5. Run Deployment

```bash
# Full pipeline
npm run dev

# Or run individual steps
npm run tfvc       # TFVC merge only
npm run build      # D365 build only
npm run sync       # Database sync only
npm run reports    # Report deployment only
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure the following:

**TFVC / Source Control:**

```env
TFVC_COLLECTION_URL=https://your-organization.visualstudio.com/DefaultCollection
TFVC_PROJECT_NAME=YourD365Project
SOURCE_BRANCH=Dev
TARGET_BRANCH=Dev-test
TFVC_WORKSPACE=AutoDeploymentWorkspace
TFVC_WORKSPACE_OWNER=YourDomain\ServiceAccount   # Optional, if workspace owned by another account
TFVC_USERNAME=buildsvc@example.com
TFVC_PASSWORD=your-tfvc-password
TFVC_PAT=optional-personal-access-token           # Preferred over password
AZURE_PAT=optional-azure-devops-pat
TFVC_CREDENTIAL_MODE=auto                         # auto (PAT first), pat, or password
TFVC_ALLOW_INTEGRATED_AUTH_FALLBACK=false
```

**D365:**

```env
D365_MODEL=YourD365Model
D365_MODULE=YourD365Model
ENVIRONMENT_TYPE=auto                             # auto, local, or cloud
```

**Pipeline Steps:**

```env
ENABLE_TFVC_STEP=true
ENABLE_BUILD_STEP=true
ENABLE_PREFLIGHT_BUILD=true                       # compile before merging; abort if already broken
ENABLE_SYNC_STEP=true
ENABLE_REPORTS_STEP=true
SKIP_TFVC_MERGE_OPERATIONS=false                  # true = skip merge, only get latest on target
```

**Service Control:**

```env
ENABLE_SERVICE_CONTROL=true
SERVICE_STOP_COMMANDS=net stop W3SVC,net stop SQLServerReportingServices,net stop DynamicsAxBatch,net stop Microsoft.Dynamics.AX.Framework.Tools.DMF.SSISHelperService.exe,net stop MR2012ProcessService
SERVICE_START_COMMANDS=net start W3SVC,net start SQLServerReportingServices,net start DynamicsAxBatch,net start Microsoft.Dynamics.AX.Framework.Tools.DMF.SSISHelperService.exe,net start MR2012ProcessService,iisreset /start
SERVICE_COMMAND_TIMEOUT_MS=300000
```

**Notifications:**

```env
TEAMS_WEBHOOK_URL=https://<env>.environment.api.powerplatform.com/powerautomate/...
NOTIFICATION_ENABLED=true
TEAMS_REQUEST_TIMEOUT_MS=10000                    # optional, default 10000
```

The webhook must be a **Teams Workflows (Power Automate)** URL: in the target channel
choose `...` > `Workflows` > *"Post to a channel when a webhook request is received"*.

Legacy Office 365 connector URLs (`*.webhook.office.com`, `*.outlook.office.com`) are retired
and are **rejected on startup**. They answer `2xx` and silently discard every card, so a dead
connector is indistinguishable from a working one — the pipeline refuses them rather than
reporting deliveries that never happened.

Verify delivery at any time with `npm run notify:test`.

**Timeouts (milliseconds):**

```env
BUILD_TIMEOUT=3600000     # 1 hour
SYNC_TIMEOUT=1800000      # 30 minutes
REPORTS_TIMEOUT=900000    # 15 minutes
```

**Logging:**

```env
LOG_LEVEL=info
LOG_FILE_PATH=./logs/deployment.log
MAX_LOG_SIZE=10m
MAX_LOG_FILES=5
```

> **Note:** `TFVC_CREDENTIAL_MODE=auto` prefers `TFVC_PAT`/`AZURE_PAT` before `TFVC_PASSWORD`. The TFVC workspace defined by `TFVC_WORKSPACE` must already exist locally with both `$/{project}/{SOURCE_BRANCH}` and `$/{project}/{TARGET_BRANCH}` mapped.

Set `SKIP_TFVC_MERGE_OPERATIONS=true` for environments where you want to bypass the descriptor update + TFVC merge step while still running build, sync, and report deployment.
Service control is enabled by default; only set `ENABLE_SERVICE_CONTROL=false` if you explicitly do **not** want the pipeline to call `SERVICE_STOP_COMMANDS` before TFVC operations (to avoid locked DLLs) and `SERVICE_START_COMMANDS` after the pipeline finishes (even if it fails). Both command lists accept comma/semicolon/pipe separated values and default to the IIS, SSRS, batch, DMF helper, and MR services shown above. The runner automatically adds `/y` to any `net stop ...` commands so dependency prompts do not hang unattended, and every service command inherits the `SERVICE_COMMAND_TIMEOUT_MS` (default 5 minutes) safeguard.

### Environment Paths

Configure D365 paths in `config/environments.json`:

```json
{
  "local": {
    "aosService": "C:\\AosService",
    "packages": "C:\\AosService\\PackagesLocalDirectory",
    "webRoot": "C:\\AosService\\webroot",
    "binPath": "C:\\AosService\\PackagesLocalDirectory\\bin"
  },
  "cloud": {
    "aosService": "K:\\AosService",
    "packages": "K:\\AosService\\PackagesLocalDirectory",
    "webRoot": "K:\\AosService\\webroot",
    "binPath": "K:\\AosService\\PackagesLocalDirectory\\bin"
  }
}
```

### Notification Settings

Configure notification behavior in `config/deployment-config.json`:

```json
{
  "notifications": {
    "onStart": { "enabled": true, "channels": ["teams"], "includeDetails": true },
    "onSuccess": { "enabled": true, "channels": ["teams"], "includeDetails": true },
    "onFailure": { "enabled": true, "channels": ["teams"], "includeDetails": true, "includeLogs": true }
  }
}
```

## Deployment Pipeline

The pipeline executes these steps in sequence:

1. **Initialize** - Generate deployment ID, validate configuration
2. **Send Start Notification** - Post "Deployment Started" to Teams
3. **Stop Services** - Run `SERVICE_STOP_COMMANDS` to free locked DLLs *(if enabled)*
4. **Pre-flight Build Check** - Compile the target branch as it currently stands *(if enabled)*.
   If it fails the run aborts **before** any TFVC operation, so a broken build cannot collect
   another night's changesets on top of itself. See *Recovering from a broken build* below.
5. **TFVC Operation** *(if enabled)*
   - **Full merge mode:** Get latest from source → merge into target → check for conflicts → bump descriptor version → check in → get latest on target
   - **Skip merge mode** (`SKIP_TFVC_MERGE_OPERATIONS=true`): Get latest on target branch only
6. **Build** - Compile the D365 model using `xppc.exe` *(if enabled)*
7. **Database Sync** - Run `SyncEngine.exe` with `syncmode=fullall` against AxDB *(if enabled)*
8. **Deploy Reports** - Execute `DeployAllReportsToSSRS.ps1` *(if enabled)*
9. **Start Services** - Run `SERVICE_START_COMMANDS` (always attempted, even on failure)
10. **Completion Notification** - Post success or failure to Teams with execution time and error details

### Recovering from a broken build

The pre-flight check is a hard gate, so once the target branch does not compile it will also
block the changeset that *repairs* it. To let the fix through, run once with the gate off:

```env
ENABLE_PREFLIGHT_BUILD=false
```

Then set it back to `true`. Build failure notifications carry the actual `xppc.exe` diagnostics
(extracted from `<MODEL>.BuildModelResult.err.xml`), so the Teams card names the missing
artifact instead of showing only a phase timing table.

Each step can be independently enabled/disabled via `ENABLE_*_STEP` environment variables. On failure, the pipeline attempts to restart services before sending the failure notification.

## NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | Full pipeline | Run the complete deployment pipeline |
| `npm run tfvc` | TFVC only | Run TFVC merge operations |
| `npm run tfvc:auth` | Auth diagnostic | Troubleshoot TFVC authentication |
| `npm run build` | Build only | Compile the D365 model |
| `npm run sync` | Sync only | Run database synchronization |
| `npm run reports` | Reports only | Deploy SSRS reports |
| `npm run notify:test` | Webhook test | Post a test card to Teams and print the HTTP status. Takes `success` (default), `failure`, `warning` or `start` |
| `npm run build:exe` | Package | Build standalone Windows executable |

## Project Structure

```
src/
  deployment-pipeline.js          # Main pipeline orchestrator
  core/
    logger.js                     # Winston-based structured logging
    notification-service.js       # Teams webhook notifications
    powershell-runner.js          # PowerShell process execution wrapper
    d365-environment.js           # Environment detection (local/cloud)
  modules/
    d365-build.js                 # X++ compilation via xppc.exe
    d365-sync.js                  # Database sync via SyncEngine.exe
    d365-reports.js               # SSRS report deployment
  scripts/
    tfvc-merge.js                 # TFVC merge workflow orchestration
    tfvc-operations.ps1           # .NET-based TFVC operations (bypasses TF.exe)
    tfvc-auth-diagnose.ps1        # TFVC authentication diagnostic tool
    build-only.js                 # Standalone build entry point
    sync-only.js                  # Standalone sync entry point
    reports-only.js               # Standalone reports entry point
config/
  environments.json               # D365 path configuration per environment
  deployment-config.json          # Notification channel settings
setup-tfs-libs.ps1                # Copies TFS assemblies from Visual Studio
run-pipeline.ps1                  # PowerShell wrapper to launch the pipeline
.env.example                      # Environment variable template
```

## Building a Standalone Executable

```bash
npm run build:exe
```

This produces `dist/d365-auto-deployment.exe`. Copy the executable along with your `.env` file and `config/` directory to any Windows server with D365 prerequisites - no Node.js installation required.

## Troubleshooting

### TFVC Authentication

Run `npm run tfvc:auth` to diagnose authentication issues. Common problems:

- **TF30063 Authorization Errors** - Verify credentials, check for MFA conflicts, ensure PAT has Code (Read & Write) scope
- **Workspace not found** - Ensure the workspace exists locally and both branches are mapped
- **Implicit auth masking credentials** - Set `TFVC_CREDENTIAL_MODE=pat` to force PAT-only authentication

### D365 Build Failures

- Verify `xppc.exe` exists in `PackagesLocalDirectory\bin`
- Check that the model name matches the descriptor file
- Review build logs in the `logs/` directory
- `xppc.exe` writes diagnostics to `<MODEL>.BuildModelResult.err.xml` and
  `<MODEL>.BuildModelResult.log` inside the model folder, **not** to stdout. The usual cause of
  a sudden break is an incomplete check-in: a table or class referencing an EDT, enum or
  security duty that was never checked in alongside it
- A failing **Pre-flight Build Check** means the target branch was already broken before this
  run and nothing was merged — see *Recovering from a broken build*

### Teams Notifications

- Run `npm run notify:test` to exercise the webhook end to end; it prints the HTTP status
- `HTTP 202` plus nothing in the channel means the webhook is not bound to the channel you are
  watching — recreate the Workflows trigger
- A startup error about a *retired Office 365 connector* means `TEAMS_WEBHOOK_URL` is still a
  `*.webhook.office.com` connector URL and must be replaced with a Workflows URL

### Database Sync Issues

- Confirm SQL Server is running and AxDB is accessible
- Check `SyncEngine.exe` path in the environment configuration
- Verify the service account has database permissions

### Report Deployment

- Ensure SSRS is running and accessible
- Verify `DeployAllReportsToSSRS.ps1` exists at the expected path
- Check that registry values for BinDir/InstallDir are correct

### Log Locations

- **Console** - Real-time deployment output
- **File logs** - `logs/deployment.log` (configurable)
- **Deployment logs** - `logs/{deploymentId}/`

## Security

- Credentials are stored in environment variables (`.env` file) - never committed to source control
- PowerShell output is sanitized to remove credentials from logs
- TFVC authentication supports PAT (recommended) and password modes
- No hardcoded secrets in source code

## License

MIT
