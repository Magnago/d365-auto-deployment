require('dotenv').config();
const logger = require('../core/logger');
const { spawn } = require('child_process');

class BranchDiagnostic {
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

    async diagnose() {
        console.log('🔍 Advanced TFVC Branch Diagnostic');
        console.log('=====================================\n');

        try {
            // 1. Check source branch history
            console.log('📋 Source Branch History:');
            const sourceHistory = await this.executeTFCommand('tf', [
                'history',
                this.sourceBranchPath,
                '/collection:' + this.collectionUrl,
                '/recursive',
                '/noprompt',
                '/format:detailed'
            ]);
            console.log(sourceHistory.success ? sourceHistory.stdout : `❌ Failed: ${sourceHistory.stderr}`);

            // 2. Check target branch history
            console.log('\n📋 Target Branch History:');
            const targetHistory = await this.executeTFCommand('tf', [
                'history',
                this.targetBranchPath,
                '/collection:' + this.collectionUrl,
                '/recursive',
                '/noprompt',
                '/format:detailed'
            ]);
            console.log(targetHistory.success ? targetHistory.stdout : `❌ Failed: ${targetHistory.stderr}`);

            // 3. List files in source branch
            console.log('\n📁 Files in Source Branch:');
            const sourceFiles = await this.executeTFCommand('tf', [
                'dir',
                this.sourceBranchPath,
                '/collection:' + this.collectionUrl,
                '/recursive',
                '/files',
                '/noprompt'
            ]);
            console.log(sourceFiles.success ? sourceFiles.stdout : `❌ Failed: ${sourceFiles.stderr}`);

            // 4. List files in target branch
            console.log('\n📁 Files in Target Branch:');
            const targetFiles = await this.executeTFCommand('tf', [
                'dir',
                this.targetBranchPath,
                '/collection:' + this.collectionUrl,
                '/recursive',
                '/files',
                '/noprompt'
            ]);
            console.log(targetFiles.success ? targetFiles.stdout : `❌ Failed: ${targetFiles.stderr}`);

            // 5. Check difference between branches
            console.log('\n🔄 Differences between branches:');
            const diffResult = await this.executeTFCommand('tf', [
                'folderdiff',
                this.sourceBranchPath,
                this.targetBranchPath,
                '/collection:' + this.collectionUrl,
                '/recursive',
                '/noprompt'
            ]);
            console.log(diffResult.success ? diffResult.stdout : `❌ Failed: ${diffResult.stderr}`);

            // 6. Try a different merge approach
            console.log('\n🔀 Testing merge with verbose output:');
            const mergeTest = await this.executeTFCommand('tf', [
                'merge',
                this.sourceBranchPath,
                this.targetBranchPath,
                '/collection:' + this.collectionUrl,
                '/recursive',
                '/noprompt',
                '/preview'
            ]);
            console.log(mergeTest.success ? mergeTest.stdout : `❌ Failed: ${mergeTest.stderr}`);
            if (mergeTest.stderr) {
                console.log(`Stderr: ${mergeTest.stderr}`);
            }

        } catch (error) {
            console.error('❌ Diagnostic failed:', error.message);
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

    async executeTFCommand(command, args) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const tfPath = this.findTFExecutable();
            if (!tfPath) {
                resolve({
                    success: false,
                    stdout: '',
                    stderr: 'TF executable not found',
                    code: -1
                });
                return;
            }

            const commandArgs = [...args];
            if (this.username && this.password) {
                commandArgs.push('/login:' + this.username + ',' + this.password);
            }

            const tf = spawn(`"${tfPath}"`, [command, ...commandArgs], {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 60000
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
    const diagnostic = new BranchDiagnostic();
    diagnostic.diagnose();
}

module.exports = BranchDiagnostic;
