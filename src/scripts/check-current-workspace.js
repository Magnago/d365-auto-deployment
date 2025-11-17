require('dotenv').config();
const { spawn } = require('child_process');

class CheckCurrentWorkspace {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranchPath = `$/` + this.projectName + `/` + this.sourceBranch;
        this.targetBranchPath = `$/` + this.projectName + `/` + this.targetBranch;
    }

    async check() {
        console.log('🔍 Current TFVC Workspace Status');
        console.log('================================\n');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Check current workspace
            console.log('1. Current workspace status:');
            const workfoldResult = await this.runTF(tfPath, 'workfold', [
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Success:', workfoldResult.success);
            console.log('Output:', workfoldResult.stdout);
            if (workfoldResult.stderr) {
                console.log('Stderr:', workfoldResult.stderr);
            }

            // Check all workspaces
            console.log('\n2. All available workspaces:');
            const workspacesResult = await this.runTF(tfPath, 'workspaces', [
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Available workspaces:');
            console.log(workspacesResult.stdout);

            // Check branch properties
            console.log('\n3. Target branch properties:');
            const targetPropsResult = await this.runTF(tfPath, 'properties', [
                this.targetBranchPath,
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Target branch:');
            console.log('Success:', targetPropsResult.success);
            console.log('Output:', targetPropsResult.stdout);
            if (targetPropsResult.stderr) {
                console.log('Stderr:', targetPropsResult.stderr);
            }

            // Check source branch properties
            console.log('\n4. Source branch properties:');
            const sourcePropsResult = await this.runTF(tfPath, 'properties', [
                this.sourceBranchPath,
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Source branch:');
            console.log('Success:', sourcePropsResult.success);
            console.log('Output:', sourcePropsResult.stdout);
            if (sourcePropsResult.stderr) {
                console.log('Stderr:', sourcePropsResult.stderr);
            }

            console.log('\n✅ Workspace check completed');

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
    const checker = new CheckCurrentWorkspace();
    checker.check();
}

module.exports = CheckCurrentWorkspace;
