require('dotenv').config();
const logger = require('../core/logger');
const { spawn } = require('child_process');

class TestMergeVerbose {
    constructor() {
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;

        this.sourceBranchPath = `$/` + this.projectName + `/` + this.sourceBranch;
        this.targetBranchPath = `$/` + this.projectName + `/` + this.targetBranch;
    }

    async test() {
        console.log('🔧 Verbose TFVC Merge Test');
        console.log('==========================\n');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        console.log(`✅ Using TF at: ${tfPath}`);
        console.log(`📂 Source: ${this.sourceBranchPath}`);
        console.log(`📂 Target: ${this.targetBranchPath}`);

        try {
            // Test 1: Get latest changeset for entire project
            console.log('\n🔍 Testing project history:');
            const projectHistory = await this.runTF(tfPath, 'history', [
                `$/` + this.projectName,
                '/collection:' + this.collectionUrl,
                '/noprompt',
                '/version:W'
            ]);

            if (projectHistory.success) {
                console.log('Project history:');
                console.log(projectHistory.stdout);
            } else {
                console.log('Project history failed:', projectHistory.stderr);
            }

            // Test 2: Check if source branch exists
            console.log('\n🔍 Testing source branch existence:');
            const sourceInfo = await this.runTF(tfPath, 'properties', [
                this.sourceBranchPath,
                '/collection:' + this.collectionUrl,
                '/noprompt'
            ]);

            if (sourceInfo.success) {
                console.log('Source branch info:');
                console.log(sourceInfo.stdout);
            } else {
                console.log('Source branch check failed:', sourceInfo.stderr);
            }

            // Test 3: Check if target branch exists
            console.log('\n🔍 Testing target branch existence:');
            const targetInfo = await this.runTF(tfPath, 'properties', [
                this.targetBranchPath,
                '/collection:' + this.collectionUrl,
                '/noprompt'
            ]);

            if (targetInfo.success) {
                console.log('Target branch info:');
                console.log(targetInfo.stdout);
            } else {
                console.log('Target branch check failed:', targetInfo.stderr);
            }

            // Test 4: Try a specific merge with version ranges
            console.log('\n🔀 Testing specific merge:');
            const mergeTest = await this.runTF(tfPath, 'merge', [
                this.sourceBranchPath,
                this.targetBranchPath,
                '/collection:' + this.collectionUrl,
                '/recursive',
                '/version:W~W',
                '/noprompt',
                '/preview'
            ]);

            if (mergeTest.success) {
                console.log('Merge preview successful:');
                console.log(mergeTest.stdout);
            } else {
                console.log('Merge preview failed:', mergeTest.stderr);
            }

        } catch (error) {
            console.error('❌ Test failed:', error.message);
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

            const commandArgs = [command, ...args];
            // Use username/password authentication
            if (this.username && this.password) {
                commandArgs.push('/login:' + this.username + ',' + this.password);
            }

            console.log(`Running: ${tfPath} ${commandArgs.join(' ')}`);

            const tf = spawn(`"${tfPath}"`, commandArgs, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 60000
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
    const tester = new TestMergeVerbose();
    tester.test();
}

module.exports = TestMergeVerbose;
