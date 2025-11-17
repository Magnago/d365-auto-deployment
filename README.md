# D365 F&O Automated Deployment Solution

A streamlined automated deployment solution for Dynamics 365 Finance & Operations that handles complete deployment workflows from TFVC source control to D365 operations.

## 🚀 Features

- **Automated Source Control**: TFVC branch operations (Dev → Dev-test)
- **Real D365 Build Integration**: Full X++ code compilation with xppc.exe
- **Database Synchronization**: Complete database sync using SyncEngine.exe
- **Report Deployment**: Automated SSRS report deployment
- **Cross-Environment Support**: Works with local (C:) and cloud (K:) environments
- **Notifications**: Email notification system for deployment status
- **Comprehensive Logging**: Detailed logs for troubleshooting and audit trails

## 📋 Prerequisites

### System Requirements
- **Windows Server** (2016 or later)
- **Node.js** 16.x or later
- **PowerShell** 5.1 or later
- **Visual Studio** 2019/2022 with Team Explorer (for TFVC)
- **D365 F&O** development environment

### Software Dependencies
```bash
# Install Node.js dependencies
npm install
```

## ⚙️ Configuration

### Environment Variables
Copy `.env.example` to `.env` and configure:

```env
# TFVC Configuration
TFVC_USERNAME=buildsvc@example.com
TFVC_PASSWORD=your-tfvc-password-or-pat
TFVC_PAT=optional-personal-access-token
TFVC_PROJECT_NAME=YourTFVCProject
SOURCE_BRANCH=Dev
TARGET_BRANCH=Dev-test
TFVC_WORKSPACE=AutoDeploymentWorkspace
# Optional when the workspace is owned by another account
TFVC_WORKSPACE_OWNER=YourDomain\ServiceAccount
TFVC_ALLOW_INTEGRATED_AUTH_FALLBACK=false
# (Default: true) set to false only if you need to skip service control
ENABLE_SERVICE_CONTROL=true
SERVICE_STOP_COMMANDS=net stop W3SVC,net stop SQLServerReportingServices,net stop DynamicsAxBatch,net stop Microsoft.Dynamics.AX.Framework.Tools.DMF.SSISHelperService.exe,net stop MR2012ProcessService
SERVICE_START_COMMANDS=net start W3SVC,net start SQLServerReportingServices,net start DynamicsAxBatch,net start Microsoft.Dynamics.AX.Framework.Tools.DMF.SSISHelperService.exe,net start MR2012ProcessService

# D365 Configuration
D365_MODEL=YourD365Model
ENVIRONMENT_TYPE=local

# Timeouts (in milliseconds)
BUILD_TIMEOUT=3600000
SYNC_TIMEOUT=1800000
REPORTS_TIMEOUT=900000
```

Set `SKIP_TFVC_MERGE_OPERATIONS=true` for environments where you want to bypass the descriptor update + TFVC merge step while still running build, sync, and report deployment.  
Service control is enabled by default; only set `ENABLE_SERVICE_CONTROL=false` if you explicitly do **not** want the pipeline to call `SERVICE_STOP_COMMANDS` before TFVC operations (to avoid locked DLLs) and `SERVICE_START_COMMANDS` after the pipeline finishes (even if it fails). Both command lists accept comma/semicolon/pipe separated values and default to the IIS, SSRS, batch, DMF helper, and MR services shown above.

### Environment Paths
Configure environment paths in `config/environments.json`:

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

> **Note:** When a Personal Access Token (PAT) is available, set `TFVC_PAT` (or point `TFVC_PASSWORD` to the PAT) so the automated merge can authenticate without relying on an existing Visual Studio session. Before running `npm run tfvc`, open Visual Studio (or `tf.exe`) and make sure the workspace defined by `TFVC_WORKSPACE` already exists locally with both `$/{project}/${SOURCE_BRANCH}` and `$/{project}/${TARGET_BRANCH}` mapped. The script now validates those mappings (and auto-detects the workspace owner, or you can override it via `TFVC_WORKSPACE_OWNER`) and fails (with a Teams notification) if the workspace is missing or incomplete, and it will stop immediately (also notifying Teams) if `tf merge` surfaces any conflicts so you can resolve them manually.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials and settings
```

### 3. Run Deployment
```bash
# Execute complete deployment pipeline
npm run dev
```

### Build Standalone Executable (Windows)
```bash
# Install deps once
npm install

# Produce dist/d365-auto-deployment.exe (includes JS + config assets)
npm run build:exe
```
Copy the resulting `dist/d365-auto-deployment.exe`, your `.env`, and the `config/` directory to any Windows server (with PowerShell + D365 prerequisites) and run the EXE directly—no Node.js installation required on that target machine.

## 📁 Project Structure

```
├── src/
│   ├── deployment-pipeline.js     # Main deployment orchestrator
│   ├── core/
│   │   ├── tfvc-simple.js         # TFVC operations (workspace, merge)
│   │   ├── logger.js              # Logging system
│   │   ├── notification-service.js # Email notifications
│   │   └── powershell-runner.js   # PowerShell execution wrapper
│   └── modules/
│       ├── d365-build.js          # D365 model compilation
│       ├── d365-sync.js           # Database synchronization
│       └── d365-reports.js        # Report deployment
├── config/
│   └── environments.json          # Environment configuration
├── deployment-reports/            # Deployment execution reports
├── .env.example                   # Environment variables template
└── package.json                   # Dependencies and scripts
```

## 🔄 Deployment Workflow

The automated pipeline executes these steps in sequence:

1. **Stop Services (optional)**: Runs `SERVICE_STOP_COMMANDS` (typically IIS/SSRS/Batch/DMF/MR) to release locks before TFVC operations.
2. **Workspace Setup**: Check/create TFVC workspace and map branches.
3. **Source Merge**: Merge changes from source to target branch.
4. **D365 Build**: Compile the specified model using xppc.exe.
5. **Database Sync**: Synchronize database schema using SyncEngine.exe.
6. **Report Deployment**: Deploy SSRS reports for the model.
7. **Start Services (always attempted)**: Runs `SERVICE_START_COMMANDS` to bring services back up even when earlier steps fail.
8. **Notifications**: Send deployment status via email.

## 📊 Monitoring & Logging

### Deployment Reports
Each execution generates:
- `deployment-{timestamp}.json` - Detailed execution report
- `deployment-{timestamp}-summary.txt` - Human-readable summary

### Real-time Logging
- Console output with step-by-step progress
- Structured logging with timestamps and metadata
- Error tracking and troubleshooting information

## 🔧 Troubleshooting

### Common Issues

1. **TF30063 Authorization Errors**
   - Ensure TFVC credentials are correct
   - Check for 2-factor authentication conflicts
   - Verify Visual Studio authentication

2. **D365 Build Failures**
   - Check D365 F&O installation paths
   - Verify model name and permissions
   - Review xppc.exe availability

3. **Database Sync Issues**
   - Confirm database connectivity
   - Check SyncEngine.exe path
   - Verify SQL Server permissions

### Log Locations
- Console: Real-time deployment output
- Reports: `deployment-reports/` directory
- Logs: Generated automatically with each execution

## 📝 Scripts

### Available NPM Scripts
```bash
npm run dev          # Run full deployment pipeline
npm test             # Run TFVC connection test
npm start            # Alias for npm run dev
```

## 🔐 Security

- Credentials stored in environment variables (.env file)
- No hardcoded passwords or sensitive data
- TFVC authentication uses secure login methods
- PowerShell execution with proper error handling

## 📈 Performance

- **Build Time**: Typically 1-5 minutes per model
- **Database Sync**: 5-30 minutes depending on changes
- **Report Deployment**: 2-10 minutes
- **Total Duration**: 10-45 minutes average

## 🤝 Contributing

1. Follow the existing code structure
2. Test all TFVC operations thoroughly
3. Update documentation for new features
4. Maintain backward compatibility

## 📄 License

This project is proprietary software for your organization.

---

**Support**: For issues or questions, contact your deployment engineering team.
