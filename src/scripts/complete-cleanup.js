require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class CompleteCleanup {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
    }

    async execute() {
        console.log('🧹 Complete TFVC and Visual Studio Cleanup');
        console.log('========================================\n');

        try {
            // Step 1: Close Visual Studio
            await this.closeVisualStudio();

            // Step 2: Find and delete ALL workspaces for this user
            await this.deleteAllWorkspaces();

            // Step 3: Delete ALL workspaces for any user on this collection
            await this.deleteAllCollectionWorkspaces();

            // Step 4: Clear ALL Visual Studio cache
            await this.clearAllVisualStudioCache();

            // Step 5: Clear TFVC cache
            await this.clearTFVCCache();

            // Step 6: Clear registry data
            await this.clearRegistryData();

            // Step 7: Remove local workspace folders
            await this.removeLocalWorkspaceFolders();

            console.log('\n✅ Complete cleanup finished!');
            console.log('\n💡 Next steps:');
            console.log('1. Restart your computer (recommended)');
            console.log('2. Start Visual Studio');
            console.log('3. Connect to: https://your-org.visualstudio.com/');
            console.log('4. Create a completely new workspace');

        } catch (error) {
            console.error('❌ Cleanup failed:', error.message);
            throw error;
        }
    }

    async closeVisualStudio() {
        console.log('1. Closing Visual Studio...');

        return new Promise((resolve) => {
            const tasklist = spawn('tasklist', ['/fi', 'imagename eq devenv.exe', '/fo', 'csv', '/nh'], { shell: true });

            let output = '';
            tasklist.stdout.on('data', (data) => {
                output += data.toString();
            });

            tasklist.on('close', (code) => {
                if (output.trim()) {
                    console.log('   Force closing Visual Studio...');
                    const taskkill = spawn('taskkill', ['/im', 'devenv.exe', '/f'], { shell: true });
                    taskkill.on('close', () => resolve());
                    taskkill.on('error', () => resolve());
                } else {
                    console.log('✅ Visual Studio is not running');
                    resolve();
                }
            });

            tasklist.on('error', () => resolve());
        });
    }

    async deleteAllWorkspaces() {
        console.log('\n2. Deleting all workspaces for user...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('⚠️  TF.exe not found, skipping workspace deletion');
            return;
        }

        try {
            // Get all workspaces for this user across all collections
            const result = await this.runTF(tfPath, 'workspaces', [
                '/owner:*',
                '/computer:*'
            ]);

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
                            console.log(`   ⚠️  Failed to delete ${workspace.name}: ${deleteResult.stderr}`);
                        }
                    } catch (error) {
                        console.log(`   ⚠️  Error deleting ${workspace.name}: ${error.message}`);
                    }
                }
            } else {
                console.log('✅ No workspaces found for user');
            }

        } catch (error) {
            console.log(`⚠️  Failed to list workspaces: ${error.message}`);
        }
    }

    async deleteAllCollectionWorkspaces() {
        console.log('\n3. Deleting all workspaces on collection...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            return;
        }

        try {
            // Try to delete any workspace that might be on the collection
            const collectionResult = await this.runTF(tfPath, 'workspaces', [
                '/collection:' + this.collectionUrl
            ]);

            if (collectionResult.success && collectionResult.stdout.trim()) {
                const workspaces = this.parseWorkspaceList(collectionResult.stdout);
                console.log(`   Found ${workspaces.length} workspace(s) on collection`);

                for (const workspace of workspaces) {
                    try {
                        console.log(`   Deleting from collection: ${workspace.name}`);
                        const deleteResult = await this.runTF(tfPath, 'workspace', [
                            '/delete',
                            workspace.fullName,
                            '/collection:' + this.collectionUrl,
                            '/noprompt'
                        ]);

                        if (deleteResult.success) {
                            console.log(`   ✅ Deleted from collection: ${workspace.name}`);
                        } else {
                            console.log(`   ⚠️  Failed to delete from collection ${workspace.name}: ${deleteResult.stderr}`);
                        }
                    } catch (error) {
                        console.log(`   ⚠️  Error deleting from collection ${workspace.name}: ${error.message}`);
                    }
                }
            } else {
                console.log('✅ No workspaces found on collection');
            }

        } catch (error) {
            console.log(`⚠️  Failed to delete collection workspaces: ${error.message}`);
        }
    }

    async clearAllVisualStudioCache() {
        console.log('\n4. Clearing ALL Visual Studio cache...');

        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

        const cachePaths = [
            path.join(localAppData, 'Microsoft', 'VisualStudio'),
            path.join(roamingAppData, 'Microsoft', 'VisualStudio'),
            path.join(localAppData, 'Microsoft', 'VSCommon'),
            path.join(localAppData, 'Microsoft', 'VSApplicationInsights'),
            path.join(localAppData, 'Microsoft', 'VisualStudio Services'),
            path.join(localAppData, 'Microsoft', 'Team Foundation'),
            path.join(localAppData, 'Microsoft', 'Team Foundation Server'),
            path.join(localAppData, 'Microsoft', 'v14log'),
            path.join(localAppData, 'Microsoft', 'v15log'),
            path.join(localAppData, 'Microsoft', 'v16log'),
            path.join(localAppData, 'Microsoft', 'v17log')
        ];

        for (const cachePath of cachePaths) {
            try {
                if (fs.existsSync(cachePath)) {
                    console.log(`   Deleting: ${cachePath}`);
                    await this.deleteFolder(cachePath);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not delete ${cachePath}: ${error.message}`);
            }
        }

        console.log('✅ Visual Studio cache cleared');
    }

    async clearTFVCCache() {
        console.log('\n5. Clearing TFVC cache...');

        const tfCachePaths = [
            path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Team Foundation'),
            path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'VSCommon'),
            path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Team Foundation Server')
        ];

        for (const cachePath of tfCachePaths) {
            try {
                if (fs.existsSync(cachePath)) {
                    console.log(`   Deleting TF cache: ${cachePath}`);
                    await this.deleteFolder(cachePath);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not delete TF cache ${cachePath}: ${error.message}`);
            }
        }

        console.log('✅ TFVC cache cleared');
    }

    async clearRegistryData() {
        console.log('\n6. Clearing registry data...');

        try {
            const regCommands = [
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VSCommon" /f',
                'reg delete "HKCU\\Software\\Microsoft\\Team Foundation" /f',
                'reg delete "HKCU\\Software\\Microsoft\\TFS" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VSTelemetry" /f'
            ];

            for (const regCmd of regCommands) {
                console.log(`   Running: ${regCmd}`);
                await this.runCommand(regCmd);
            }

            console.log('✅ Registry data cleared');

        } catch (error) {
            console.log(`   ⚠️  Registry cleanup failed: ${error.message}`);
        }
    }

    async removeLocalWorkspaceFolders() {
        console.log('\n7. Removing local workspace folders...');

        const workspacePaths = [
            path.join(os.homedir(), 'Documents', 'D365-Workspace'),
            path.join(os.homedir(), 'Documents', 'Visual Studio 2022'),
            path.join('C:\\', 'D365-Workspaces'),
            path.join('C:\\', 'Dev'),
            path.join('C:\\', 'AosService', 'PackagesLocalDirectory')
        ];

        for (const workspacePath of workspacePaths) {
            try {
                if (fs.existsSync(workspacePath)) {
                    console.log(`   Checking workspace folder: ${workspacePath}`);

                    // Only delete if it contains TFVC metadata
                    const tfPath = path.join(workspacePath, '$tf');
                    if (fs.existsSync(tfPath)) {
                        console.log(`   Deleting TFVC metadata from: ${workspacePath}`);
                        await this.deleteFolder(tfPath);
                    }
                }
            } catch (error) {
                console.log(`   ⚠️  Could not clean workspace folder ${workspacePath}: ${error.message}`);
            }
        }

        console.log('✅ Local workspace folders cleaned');
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

            console.log(`   Running: tf ${commandArgs.join(' ')}`);

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
    const cleanup = new CompleteCleanup();
    cleanup.execute()
        .then(() => {
            console.log('\n🎉 Complete cleanup finished!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Cleanup failed:', error.message);
            process.exit(1);
        });
}

module.exports = CompleteCleanup;
