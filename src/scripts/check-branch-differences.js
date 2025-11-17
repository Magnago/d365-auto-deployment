require('dotenv').config();
const { spawn } = require('child_process');

class CheckBranchDifferences {
    constructor() {
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;

        this.sourceBranchPath = `$/` + this.projectName + `/` + this.sourceBranch;
        this.targetBranchPath = `$/` + this.projectName + `/` + this.targetBranch;
    }

    async check() {
        console.log('🔍 Checking Branch Differences');
        console.log('===============================\n');
        console.log(`Source: ${this.sourceBranchPath}`);
        console.log(`Target: ${this.targetBranchPath}`);

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Test 1: Use folderdiff to see differences
            console.log('\n🔄 Checking folder differences:');
            const folderDiff = await this.runTF(tfPath, 'folderdiff', [
                this.sourceBranchPath,
                this.targetBranchPath,
                '/recursive',
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Folder diff result:');
            console.log('Success:', folderDiff.success);
            console.log('Stdout:', folderDiff.stdout);
            console.log('Stderr:', folderDiff.stderr);

            // Test 2: Try to list source branch files
            console.log('\n📁 Listing source branch files:');
            const sourceFiles = await this.runTF(tfPath, 'dir', [
                this.sourceBranchPath,
                '/recursive',
                '/files',
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Source files result:');
            console.log('Success:', sourceFiles.success);
            console.log('Stdout:', sourceFiles.stdout);
            console.log('Stderr:', sourceFiles.stderr);

            // Test 3: Try to list target branch files
            console.log('\n📁 Listing target branch files:');
            const targetFiles = await this.runTF(tfPath, 'dir', [
                this.targetBranchPath,
                '/recursive',
                '/files',
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Target files result:');
            console.log('Success:', targetFiles.success);
            console.log('Stdout:', targetFiles.stdout);
            console.log('Stderr:', targetFiles.stderr);

            // Test 4: Check source branch history
            console.log('\n📊 Source branch history:');
            const sourceHistory = await this.runTF(tfPath, 'history', [
                this.sourceBranchPath,
                '/noprompt',
                '/format:detailed',
                '/stopafter:5',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Source history result:');
            console.log('Success:', sourceHistory.success);
            console.log('Stdout:', sourceHistory.stdout);
            console.log('Stderr:', sourceHistory.stderr);

            // Test 5: Check target branch history
            console.log('\n📊 Target branch history:');
            const targetHistory = await this.runTF(tfPath, 'history', [
                this.targetBranchPath,
                '/noprompt',
                '/format:detailed',
                '/stopafter:5',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Target history result:');
            console.log('Success:', targetHistory.success);
            console.log('Stdout:', targetHistory.stdout);
            console.log('Stderr:', targetHistory.stderr);

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
    const checker = new CheckBranchDifferences();
    checker.check();
}

module.exports = CheckBranchDifferences;
