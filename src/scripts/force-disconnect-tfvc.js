require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ForceDisconnectTFVC {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
    }

    async execute() {
        console.log('🔌 Force Disconnecting Visual Studio from TFVC Workspaces');
        console.log('======================================================\n');

        try {
            // Step 1: Close Visual Studio if running
            await this.closeVisualStudio();

            // Step 2: List all workspaces for this user
            const workspaces = await this.listWorkspaces();

            if (workspaces.length === 0) {
                console.log('ℹ️  No workspaces found for this user');
            } else {
                console.log(`Found ${workspaces.length} workspace(s):`);
                workspaces.forEach(ws => console.log(`  - ${ws.name} (${ws.collection})`));
                console.log('');
            }

            // Step 3: Remove all workspaces for this user
            for (const workspace of workspaces) {
                await this.removeWorkspace(workspace);
            }

            // Step 4: Clear TFVC cache and connection data
            await this.clearTFVCConnectionData();

            // Step 5: Clear Visual Studio solution cache
            await this.clearSolutionCache();

            // Step 6: Remove workspace mappings from registry
            await this.clearRegistryData();

            console.log('\n✅ Force disconnect completed successfully!');
            console.log('\n💡 Next steps:');
            console.log('1. Start Visual Studio');
            console.log('2. Go to Team Explorer → Connect to Team Projects');
            console.log('3. Connect to: https://your-org.visualstudio.com/');
            console.log('4. Select your Your TFVC Project');
            console.log('5. Create a NEW workspace or select an existing one');
            console.log('6. Map your branches to local folders');
            console.log('7. Open your solution');

        } catch (error) {
            console.error('❌ Force disconnect failed:', error.message);
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
                    console.log('   Closing Visual Studio instances...');
                    const taskkill = spawn('taskkill', ['/im', 'devenv.exe', '/f'], { shell: true });
                    taskkill.on('close', (closeCode) => {
                        if (closeCode === 0) {
                            console.log('✅ Visual Studio closed');
                        } else {
                            console.log('⚠️  Could not close Visual Studio');
                        }
                        resolve();
                    });

                    taskkill.on('error', () => {
                        resolve();
                    });
                } else {
                    console.log('✅ Visual Studio is not running');
                    resolve();
                }
            });

            tasklist.on('error', () => {
                resolve();
            });
        });
    }

    async listWorkspaces() {
        console.log('\n2. Listing TFVC workspaces...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return [];
        }

        try {
            const result = await this.runTF(tfPath, 'workspaces', [
                '/owner:' + this.username,
                '/collection:' + this.collectionUrl
            ]);

            if (!result.success) {
                console.log(`⚠️  Could not list workspaces: ${result.stderr}`);
                return [];
            }

            const workspaces = this.parseWorkspaceList(result.stdout);
            return workspaces;

        } catch (error) {
            console.log(`⚠️  Failed to list workspaces: ${error.message}`);
            return [];
        }
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

                    // Skip workspace templates and system workspaces
                    if (!name.includes('Template') && !name.includes('Temporary')) {
                        workspaces.push({
                            name: name,
                            collection: collection,
                            fullName: `${name};${collection}`
                        });
                    }
                }
            }
        }

        return workspaces;
    }

    async removeWorkspace(workspace) {
        console.log(`3. Removing workspace: ${workspace.name}`);

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Remove the workspace
            const result = await this.runTF(tfPath, 'workspace', [
                '/delete',
                workspace.fullName,
                '/noprompt'
            ]);

            if (result.success) {
                console.log(`✅ Removed workspace: ${workspace.name}`);
            } else {
                console.log(`⚠️  Could not remove workspace ${workspace.name}: ${result.stderr}`);
            }

        } catch (error) {
            console.log(`⚠️  Failed to remove workspace ${workspace.name}: ${error.message}`);
        }
    }

    async clearTFVCConnectionData() {
        console.log('\n4. Clearing TFVC connection data...');

        const connectionPaths = [
            path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Microsoft', 'Team Foundation'),
            path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Microsoft', 'VSCommon'),
            path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'Microsoft', 'VisualStudio'),
            path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Microsoft', 'VisualStudio')
        ];

        for (const cachePath of connectionPaths) {
            try {
                if (fs.existsSync(cachePath)) {
                    console.log(`   Clearing: ${cachePath}`);
                    await this.deleteFolder(cachePath);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not clear ${cachePath}: ${error.message}`);
            }
        }

        console.log('✅ TFVC connection data cleared');
    }

    async clearSolutionCache() {
        console.log('\n5. Clearing solution cache...');

        const vsCachePath = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Microsoft', 'VisualStudio');

        if (fs.existsSync(vsCachePath)) {
            try {
                const items = fs.readdirSync(vsCachePath);

                for (const item of items) {
                    if (item.startsWith('v17') || item.startsWith('v16')) {
                        const componentPath = path.join(vsCachePath, item);

                        // Clear ComponentModelCache
                        const cachePath = path.join(componentPath, 'ComponentModelCache');
                        if (fs.existsSync(cachePath)) {
                            console.log(`   Clearing ComponentModelCache: ${cachePath}`);
                            await this.deleteFolder(cachePath);
                        }

                        // Clear .vs folder data
                        const vsFolderPath = path.join(componentPath, '.vs');
                        if (fs.existsSync(vsFolderPath)) {
                            console.log(`   Clearing .vs cache: ${vsFolderPath}`);
                            await this.deleteFolder(vsFolderPath);
                        }
                    }
                }
            } catch (error) {
                console.log(`   ⚠️  Could not clear solution cache: ${error.message}`);
            }
        }

        console.log('✅ Solution cache cleared');
    }

    async clearRegistryData() {
        console.log('\n6. Clearing Visual Studio registry data...');

        try {
            // Clear Visual Studio recent projects and connections
            const regCommands = [
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio\\15.0\\TeamFoundation" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio\\16.0\\TeamFoundation" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio\\17.0\\TeamFoundation" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio\\RecentProjects" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio\\15.0\\MRUItems" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio\\16.0\\MRUItems" /f',
                'reg delete "HKCU\\Software\\Microsoft\\VisualStudio\\17.0\\MRUItems" /f'
            ];

            for (const regCmd of regCommands) {
                await this.runCommand(regCmd);
            }

            console.log('✅ Registry data cleared');

        } catch (error) {
            console.log(`   ⚠️  Could not clear registry data: ${error.message}`);
        }
    }

    async deleteFolder(folderPath) {
        return new Promise((resolve) => {
            const rd = spawn('rd', ['/s', '/q', `"${folderPath}"`], { shell: true });

            rd.on('close', (code) => {
                resolve();
            });

            rd.on('error', () => {
                resolve();
            });
        });
    }

    async runCommand(command) {
        return new Promise((resolve) => {
            const cmd = spawn(command, [], { shell: true, stdio: 'pipe' });

            cmd.on('close', (code) => {
                resolve();
            });

            cmd.on('error', () => {
                resolve();
            });
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
    const disconnector = new ForceDisconnectTFVC();
    disconnector.execute()
        .then(() => {
            console.log('\n🎉 Force disconnect completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Force disconnect failed:', error.message);
            process.exit(1);
        });
}

module.exports = ForceDisconnectTFVC;

