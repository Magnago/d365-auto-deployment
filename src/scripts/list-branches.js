require('dotenv').config();
const logger = require('../core/logger');
const { spawn } = require('child_process');

class ListBranches {
    constructor() {
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
    }

    async list() {
        console.log('🌿 TFVC Branch Explorer');
        console.log('=======================\n');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        console.log(`✅ Using TF at: ${tfPath}`);
        console.log(`📂 Project: $/${this.projectName}`);

        try {
            // List all branches/folders in the project
            console.log('\n📋 Listing all branches in project:');
            const branches = await this.runTF(tfPath, 'dir', [
                `$/` + this.projectName,
                '/collection:' + this.collectionUrl,
                '/folders',
                '/recursive',
                '/noprompt'
            ]);

            if (branches.success) {
                console.log('Project structure:');
                console.log(branches.stdout);
            } else {
                console.log('Failed to list branches:', branches.stderr);
            }

            // Try to get recent changesets to understand activity
            console.log('\n📊 Recent changesets in project:');
            const history = await this.runTF(tfPath, 'history', [
                `$/` + this.projectName,
                '/collection:' + this.collectionUrl,
                '/noprompt',
                '/format:detailed',
                '/stopafter:10'
            ]);

            if (history.success && history.stdout) {
                console.log('Recent activity:');
                console.log(history.stdout);
            } else {
                console.log('No recent activity found or failed to get history');
            }

        } catch (error) {
            console.error('❌ Branch listing failed:', error.message);
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
            if (this.username && this.password) {
                commandArgs.push('/login:' + this.username + ',' + this.password);
            }

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
    const lister = new ListBranches();
    lister.list();
}

module.exports = ListBranches;
