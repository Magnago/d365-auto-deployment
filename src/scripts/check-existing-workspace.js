require('dotenv').config();
const { spawn } = require('child_process');

class CheckExistingWorkspace {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
    }

    async check() {
        console.log('🔍 Checking Existing Workspace');
        console.log('=============================\n');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Use the existing workspace to see what we can access
            console.log('📋 Checking existing workspace details:');
            const workspaceDetail = await this.runTF(tfPath, 'workspaces', [
                'FELIPELOCALV41',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Workspace details:');
            console.log('Success:', workspaceDetail.success);
            console.log('Stdout:', workspaceDetail.stdout);
            console.log('Stderr:', workspaceDetail.stderr);

            // Try to list the project using the workspace
            console.log('\n📁 Listing project using workspace:');
            const projectList = await this.runTF(tfPath, 'dir', [
                '$/Your TFVC Project',
                '/workspace:FELIPELOCALV41',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Project list result:');
            console.log('Success:', projectList.success);
            console.log('Stdout:', projectList.stdout);
            console.log('Stderr:', projectList.stderr);

            // Try to get history of the project
            console.log('\n📊 Getting project history:');
            const projectHistory = await this.runTF(tfPath, 'history', [
                '$/Your TFVC Project',
                '/workspace:FELIPELOCALV41',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Project history result:');
            console.log('Success:', projectHistory.success);
            console.log('Stdout:', projectHistory.stdout);
            console.log('Stderr:', projectHistory.stderr);

        } catch (error) {
            console.error('❌ Check failed:', error.message);
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
            const fs = require('fs');
            if (fs.existsSync(tfPath)) {
                return tfPath;
            }
        }
        return null;
    }

    async runTF(tfPath, command, args) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            console.log(`Running: ${tfPath} ${command} ${args.join(' ')}`);

            const tf = spawn(`"${tfPath}"`, [command, ...args], {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30000
            });

            tf.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
            });

            tf.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
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
    const checker = new CheckExistingWorkspace();
    checker.check();
}

module.exports = CheckExistingWorkspace;
