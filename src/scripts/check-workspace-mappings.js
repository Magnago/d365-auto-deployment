require('dotenv').config();
const { spawn } = require('child_process');

class CheckWorkspaceMappings {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
    }

    async check() {
        console.log('🗺️  Checking Workspace Mappings');
        console.log('===============================\n');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Check current workspace mappings
            console.log('📋 Current workspace mappings:');
            const workfoldResult = await this.runTF(tfPath, 'workfold', [
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Workfold result:');
            console.log('Success:', workfoldResult.success);
            console.log('Stdout:', workfoldResult.stdout);
            console.log('Stderr:', workfoldResult.stderr);

            // Check workspace details to confirm which one we're using
            console.log('\n📋 Workspace details:');
            const workspaceResult = await this.runTF(tfPath, 'workspaces', [
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Workspaces result:');
            console.log('Success:', workspaceResult.success);
            console.log('Stdout:', workspaceResult.stdout);
            console.log('Stderr:', workspaceResult.stderr);

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
    const checker = new CheckWorkspaceMappings();
    checker.check();
}

module.exports = CheckWorkspaceMappings;