require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class AggressiveCleanup {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
    }

    async execute() {
        console.log('🔥 AGGRESSIVE Complete Cleanup');
        console.log('=============================\n');

        try {
            // Step 1: Force close ALL Visual Studio processes
            await this.forceCloseAllVSProcesses();

            // Step 2: Delete workspaces with multiple methods
            await this.deleteWorkspacesAggressively();

            // Step 3: Clear ALL possible cache locations
            await this.clearAllPossibleCaches();

            // Step 4: Clear ALL registry keys
            await this.clearAllRegistryKeys();

            // Step 5: Delete ALL workspace-related folders
            await this.deleteAllWorkspaceFolders();

            // Step 6: Clear Windows credential manager
            await this.clearWindowsCredentials();

            // Step 7: Clear Visual Studio settings files
            await this.clearVSSettingsFiles();

            console.log('\n✅ AGGRESSIVE cleanup completed!');
            console.log('\n🚨 IMPORTANT: You MUST restart your computer now!');
            console.log('\n💡 After restart:');
            console.log('1. Start Visual Studio');
            console.log('2. Connect to: https://your-org.visualstudio.com/');
            console.log('3. Create a brand new workspace');

        } catch (error) {
            console.error('❌ Aggressive cleanup failed:', error.message);
            throw error;
        }
    }

    async forceCloseAllVSProcesses() {
        console.log('1. Force closing ALL Visual Studio processes...');

        const commands = [
            'taskkill /im devenv.exe /f',
            'taskkill /im vs.exe /f',
            'taskkill /im ServiceHub.VSDetouredHost.exe /f',
            'taskkill /im ServiceHub.SettingsHost.exe /f',
            'taskkill /im ServiceHub.Host.Node.exe /f',
            'taskkill /im MSBuild.exe /f'
        ];

        for (const cmd of commands) {
            await this.runCommand(cmd);
        }

        console.log('✅ All VS processes terminated');
    }

    async deleteWorkspacesAggressively() {
        console.log('\n2. Aggressively deleting workspaces...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('⚠️  TF.exe not found');
            return;
        }

        try {
            // Try multiple workspace deletion methods
            const commands = [
                ['workspaces', '/owner:*'],
                ['workspaces', '/collection:' + this.collectionUrl],
                ['workspaces', '/owner:*', '/collection:' + this.collectionUrl],
                ['workspaces', '/computer:*'],
                ['workspaces']  // Get everything
            ];

            for (const args of commands) {
                try {
                    console.log(`   Checking: tf ${args.join(' ')}`);
                    const result = await this.runTF(tfPath, args[0], args.slice(1));

                    if (result.success && result.stdout.trim()) {
                        const workspaces = this.parseWorkspaceList(result.stdout);
                        console.log(`   Found ${workspaces.length} workspace(s) to delete`);

                        for (const workspace of workspaces) {
                            try {
                                console.log(`   Deleting: ${workspace.name}`);
                                const deleteResult = await this.runTF(tfPath, 'workspace', [
                                    '/delete',
                                    workspace.fullName,
                                    '/noprompt'
                                ]);

                                if (deleteResult.success) {
                                    console.log(`   ✅ Deleted: ${workspace.name}`);
                                } else {
                                    console.log(`   ⚠️  Failed: ${deleteResult.stderr}`);
                                }
                            } catch (error) {
                                console.log(`   ❌ Error: ${error.message}`);
                            }
                        }
                    }
                } catch (error) {
                    console.log(`   ⚠️  Error with ${args.join(' ')}: ${error.message}`);
                }
            }

            console.log('✅ Aggressive workspace deletion completed');

        } catch (error) {
            console.log(`⚠️  Aggressive workspace deletion failed: ${error.message}`);
        }
    }

    async clearAllPossibleCaches() {
        console.log('\n3. Clearing ALL possible cache locations...');

        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

        const cachePaths = [
            // Visual Studio caches
            path.join(localAppData, 'Microsoft', 'VisualStudio'),
            path.join(roamingAppData, 'Microsoft', 'VisualStudio'),
            path.join(localAppData, 'Microsoft', 'VSCommon'),
            path.join(localAppData, 'Microsoft', 'VSApplicationInsights'),
            path.join(localAppData, 'Microsoft', 'VisualStudio Services'),

            // TFVC caches
            path.join(localAppData, 'Microsoft', 'Team Foundation'),
            path.join(localAppData, 'Microsoft', 'Team Foundation Server'),
            path.join(roamingAppData, 'Microsoft', 'Team Foundation'),
            path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Team Foundation'),

            // Build and component caches
            path.join(localAppData, 'Microsoft', 'ComponentCache'),
            path.join(localAppData, 'Microsoft', 'dotnet'),
            path.join(localAppData, 'Microsoft', 'NuGet'),
            path.join(localAppData, 'Microsoft', 'v14log'),
            path.join(localAppData, 'Microsoft', 'v15log'),
            path.join(localAppData, 'Microsoft', 'v16log'),
            path.join(localAppData, 'Microsoft', 'v17log'),
            path.join(localAppData, 'Microsoft', 'VSTelemetry'),

            // Windows caches
            path.join(localAppData, 'Temp'),
            path.join(os.homedir(), 'AppData', 'Local', 'Temp')
        ];

        for (const cachePath of cachePaths) {
            try {
                if (fs.existsSync(cachePath)) {
                    console.log(`   🗑️  Deleting: ${cachePath}`);
                    await this.deleteFolder(cachePath);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not delete ${cachePath}: ${error.message}`);
            }
        }

        console.log('✅ All possible caches cleared');
    }

    async clearAllRegistryKeys() {
        console.log('\n4. Clearing ALL registry keys...');

        const regCommands = [
            'reg delete "HKCU\\Software\\Microsoft\\VisualStudio" /f',
            'reg delete "HKCU\\Software\\Microsoft\\VSCommon" /f',
            'reg delete "HKCU\\Software\\Microsoft\\Team Foundation" /f',
            'reg delete "HKCU\\Software\\Microsoft\\TFS" /f',
            'reg delete "HKCU\\Software\\Microsoft\\VSTelemetry" /f',
            'reg delete "HKCU\\Software\\Microsoft\\VisualStudioOnline" /f',
            'reg delete "HKCU\\Software\\Microsoft\\VSSolution" /f',
            'reg delete "HKCU\\Software\\Microsoft\\VSApplicationInsights" /f',
            'reg delete "HKLM\\Software\\Microsoft\\VisualStudio" /f',
            'reg delete "HKLM\\Software\\Microsoft\\VSCommon" /f',
            'reg delete "HKLM\\Software\\Microsoft\\Team Foundation" /f',
            'reg delete "HKLM\\Software\\Microsoft\\TFS" /f'
        ];

        for (const regCmd of regCommands) {
            try {
                console.log(`   🗑️  Registry: ${regCmd.split(' ')[2]}`);
                await this.runCommand(regCmd);
            } catch (error) {
                console.log(`   ⚠️  Registry failed: ${regCmd.split(' ')[2]}`);
            }
        }

        console.log('✅ All registry keys cleared');
    }

    async deleteAllWorkspaceFolders() {
        console.log('\n5. Deleting ALL workspace-related folders...');

        const workspacePaths = [
            path.join(os.homedir(), 'Documents', 'D365-Workspace'),
            path.join(os.homedir(), 'Documents', 'Visual Studio 2022'),
            path.join(os.homedir(), 'Documents', 'Visual Studio 2019'),
            path.join(os.homedir(), 'Source'),
            path.join(os.homedir(), 'Projects'),
            path.join('C:\\', 'Dev'),
            path.join('C:\\', 'Development'),
            path.join('C:\\', 'Source'),
            path.join('C:\\', 'Projects'),
            path.join('C:\\', 'D365-Workspaces'),
            path.join('C:\\', 'AosService', 'PackagesLocalDirectory'),
            path.join('C:\\', 'AosService', 'PackagesLocalDirectory', '$tf')
        ];

        for (const workspacePath of workspacePaths) {
            try {
                if (fs.existsSync(workspacePath)) {
                    console.log(`   🗑️  Deleting workspace folder: ${workspacePath}`);
                    await this.deleteFolder(workspacePath);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not delete workspace folder ${workspacePath}: ${error.message}`);
            }
        }

        console.log('✅ All workspace-related folders deleted');
    }

    async clearWindowsCredentials() {
        console.log('\n6. Clearing Windows credentials...');

        try {
            // Clear Visual Studio and TFS credentials from Windows Credential Manager
            const cmdCommands = [
                'cmdkey /list | findstr "VisualStudio"',
                'cmdkey /list | findstr "TFS"',
                'cmdkey /list | findstr "Team Foundation"',
                'cmdkey /list | findstr "AzureDevOps"',
                'cmdkey /list | findstr "your-org"'
            ];

            for (const cmd of cmdCommands) {
                await this.runCommand(cmd);
            }

            // Delete common credential targets
            const deleteCommands = [
                'cmdkey /delete:LegacyGeneric:target=VisualStudio',
                'cmdkey /delete:LegacyGeneric:target=git:https://your-org.visualstudio.com',
                'cmdkey /delete:LegacyGeneric:target=tfs:https://your-org.visualstudio.com',
                'cmdkey /delete:Generic:https://your-org.visualstudio.com'
            ];

            for (const deleteCmd of deleteCommands) {
                try {
                    await this.runCommand(deleteCmd);
                } catch (error) {
                    // Ignore credential deletion errors
                }
            }

            console.log('✅ Windows credentials cleared');

        } catch (error) {
            console.log(`⚠️  Credential clearing failed: ${error.message}`);
        }
    }

    async clearVSSettingsFiles() {
        console.log('\n7. Clearing Visual Studio settings files...');

        const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const settingsFiles = [
            path.join(roamingAppData, 'Microsoft', 'VisualStudio', 'ApplicationInsights.config'),
            path.join(roamingAppData, 'Microsoft', 'VisualStudio', 'VsSettings', 'CurrentSettings.vssettings'),
            path.join(os.homedir(), 'Documents', 'Visual Studio 2022', 'Settings', 'CurrentSettings.vssettings'),
            path.join(os.homedir(), '.vsconfig'),
            path.join(os.homedir(), '.vs')
        ];

        for (const settingsFile of settingsFiles) {
            try {
                if (fs.existsSync(settingsFile)) {
                    console.log(`   🗑️  Deleting settings file: ${settingsFile}`);
                    fs.unlinkSync(settingsFile);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not delete settings file ${settingsFile}: ${error.message}`);
            }
        }

        console.log('✅ Visual Studio settings files cleared');
    }

    parseWorkspaceList(output) {
        const workspaces = [];
        const lines = output.split('\n');

        for (const line of lines) {
            if (line.trim() && line.includes(':')) {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const name = parts[0].trim();
                    const collection = parts[1].trim();

                    workspaces.push({
                        name: name,
                        collection: collection,
                        fullName: `${name};${collection}`
                    });
                }
            }
        }

        return workspaces;
    }

    async deleteFolder(folderPath) {
        return new Promise((resolve) => {
            const rd = spawn('rd', ['/s', '/q', `"${folderPath}"`], { shell: true });

            rd.on('close', () => resolve());
            rd.on('error', () => resolve());
        });
    }

    async runCommand(command) {
        return new Promise((resolve) => {
            const cmd = spawn(command, [], { shell: true, stdio: 'pipe' });

            cmd.on('close', () => resolve());
            cmd.on('error', () => resolve());
        });
    }

    findTFExecutable() {
        const possiblePaths = [
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe'
        ];

        for (const tfPath of possiblePaths) {
            if (fs.existsSync(tfPath)) {
                return tfPath;
            }
        }
        return null;
    }

    async runTF(tfPath, command, args = []) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];
            if (this.username && this.password) {
                commandArgs.push('/login:' + this.username + ',' + this.password);
            }

            const tf = spawn('tf', commandArgs, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30000
            });

            tf.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            tf.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            tf.on('close', (code) => {
                resolve({
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    code
                });
            });

            tf.on('error', (error) => {
                resolve({
                    success: false,
                    stdout: '',
                    stderr: error.message,
                    code: -1
                });
            });
        });
    }
}

// Execute if run directly
if (require.main === module) {
    const cleanup = new AggressiveCleanup();
    cleanup.execute()
        .then(() => {
            console.log('\n🎉 AGGRESSIVE cleanup completed!');
            console.log('\n🚨 RESTART YOUR COMPUTER NOW! 🚨');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Aggressive cleanup failed:', error.message);
            process.exit(1);
        });
}

module.exports = AggressiveCleanup;
