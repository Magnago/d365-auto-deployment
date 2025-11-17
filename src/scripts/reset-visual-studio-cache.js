require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class ResetVisualStudioCache {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
    }

    async execute() {
        console.log('🔄 Resetting Visual Studio TFVC Cache');
        console.log('=====================================\n');

        try {
            // Step 1: Close Visual Studio if running
            await this.closeVisualStudio();

            // Step 2: Clear TFVC cache folders
            await this.clearTFCache();

            // Step 3: Clear Visual Studio cache
            await this.clearVisualStudioCache();

            // Step 4: Reset workspace context
            await this.resetWorkspaceContext();

            // Step 5: Test TFVC connection
            await this.testTFVCConnection();

            console.log('\n✅ Visual Studio cache reset completed successfully!');
            console.log('\n💡 Next steps:');
            console.log('1. Restart Visual Studio');
            console.log('2. Go to Team Explorer');
            console.log('3. Connect to source control (if needed)');
            console.log('4. Your branches should now appear correctly');

        } catch (error) {
            console.error('❌ Failed to reset Visual Studio cache:', error.message);
            throw error;
        }
    }

    async closeVisualStudio() {
        console.log('1. Checking for running Visual Studio instances...');

        return new Promise((resolve) => {
            const tasklist = spawn('tasklist', ['/fi', 'imagename eq devenv.exe', '/fo', 'csv', '/nh'], { shell: true });

            let output = '';
            tasklist.stdout.on('data', (data) => {
                output += data.toString();
            });

            tasklist.on('close', (code) => {
                if (output.trim()) {
                    console.log('⚠️  Visual Studio is running. Attempting to close it...');

                    // Try to close Visual Studio gracefully
                    const taskkill = spawn('taskkill', ['/im', 'devenv.exe', '/f'], { shell: true });
                    taskkill.on('close', (closeCode) => {
                        if (closeCode === 0) {
                            console.log('✅ Visual Studio closed successfully');
                        } else {
                            console.log('⚠️  Could not close Visual Studio automatically');
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

    async clearTFCache() {
        console.log('\n2. Clearing TFVC cache...');

        const cachePaths = [
            path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Team Foundation'),
            path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'VSCommon'),
            path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'VisualStudio'),
            path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Team Foundation Server')
        ];

        for (const cachePath of cachePaths) {
            try {
                if (fs.existsSync(cachePath)) {
                    console.log(`   Clearing: ${cachePath}`);
                    await this.deleteFolder(cachePath);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not clear ${cachePath}: ${error.message}`);
            }
        }

        console.log('✅ TFVC cache cleared');
    }

    async clearVisualStudioCache() {
        console.log('\n3. Clearing Visual Studio cache...');

        const vsCachePaths = [
            path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'VisualStudio'),
            path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'VisualStudio')
        ];

        // Look for component cache folders
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const microsoftPath = path.join(localAppData, 'Microsoft');

        if (fs.existsSync(microsoftPath)) {
            const items = fs.readdirSync(microsoftPath);
            const vsCacheFolders = items.filter(item =>
                item.startsWith('VisualStudio') ||
                item.startsWith('VSApplicationInsights') ||
                item.startsWith('v17') ||
                item.startsWith('v16')
            );

            for (const folder of vsCacheFolders) {
                const folderPath = path.join(microsoftPath, folder);
                try {
                    console.log(`   Clearing: ${folderPath}`);
                    await this.deleteFolder(folderPath);
                } catch (error) {
                    console.log(`   ⚠️  Could not clear ${folderPath}: ${error.message}`);
                }
            }
        }

        console.log('✅ Visual Studio cache cleared');
    }

    async deleteFolder(folderPath) {
        return new Promise((resolve, reject) => {
            const rd = spawn('rd', ['/s', '/q', `"${folderPath}"`], { shell: true });

            rd.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Delete failed with code ${code}`));
                }
            });

            rd.on('error', (error) => {
                reject(error);
            });
        });
    }

    async resetWorkspaceContext() {
        console.log('\n4. Resetting workspace context...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('⚠️  TF.exe not found, skipping workspace reset');
            return;
        }

        try {
            // Refresh workspace mappings
            console.log('   Refreshing workspace mappings...');
            const refreshResult = await this.runTF(tfPath, 'workfold', ['/refresh']);

            if (refreshResult.success) {
                console.log('✅ Workspace context refreshed');
            } else {
                console.log(`⚠️  Could not refresh workspace: ${refreshResult.stderr}`);
            }

            // Get workspace info
            console.log('   Getting workspace information...');
            const workfoldResult = await this.runTF(tfPath, 'workfold');

            if (workfoldResult.success) {
                console.log('✅ Current workspace mappings:');
                console.log(workfoldResult.stdout);
            } else {
                console.log(`⚠️  Could not get workspace info: ${workfoldResult.stderr}`);
            }

        } catch (error) {
            console.log(`⚠️  Workspace reset failed: ${error.message}`);
        }
    }

    async testTFVCConnection() {
        console.log('\n5. Testing TFVC connection...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Test basic TFVC connectivity
            const infoResult = await this.runTF(tfPath, 'info');

            if (infoResult.success) {
                console.log('✅ TFVC connection working');
                console.log('   Workspace info:', infoResult.stdout);
            } else {
                console.log('❌ TFVC connection failed:', infoResult.stderr);
            }

        } catch (error) {
            console.log(`❌ TFVC connection test failed: ${error.message}`);
        }
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
    const resetter = new ResetVisualStudioCache();
    resetter.execute()
        .then(() => {
            console.log('\n🎉 Visual Studio cache reset completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Reset failed:', error.message);
            process.exit(1);
        });
}

module.exports = ResetVisualStudioCache;