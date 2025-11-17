require('dotenv').config();
const { spawn } = require('child_process');

class CleanupWorkspaces {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.workspaceName = 'AutoDeployment-YourD365Model';
    }

    async cleanup() {
        console.log('ðŸ§¹ Cleaning Up TFVC Workspaces');
        console.log('============================\n');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('âŒ TF.exe not found');
            return;
        }

        try {
            // List all workspaces first
            console.log('ðŸ“‹ Listing all workspaces:');
            const workspacesResult = await this.runTF(tfPath, 'workspaces', [
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Current workspaces:');
            console.log(workspacesResult.stdout);
            console.log('');

            // Check if AutoDeployment-YourD365Model workspace exists
            if (workspacesResult.stdout.includes(this.workspaceName)) {
                console.log(`ðŸ—‘ï¸  Found workspace ${this.workspaceName}, removing it...`);

                const deleteResult = await this.runTF(tfPath, 'workspace', [
                    '/delete',
                    this.workspaceName,
                    '/noprompt',
                    '/login:' + this.username + ',' + this.password
                ]);

                if (deleteResult.success) {
                    console.log('âœ… Workspace deleted successfully');
                } else {
                    console.log('âŒ Failed to delete workspace:', deleteResult.stderr);
                }
            } else {
                console.log(`â„¹ï¸  Workspace ${this.workspaceName} not found`);
            }

            // List remaining workspaces
            console.log('\nðŸ“‹ Remaining workspaces:');
            const remainingResult = await this.runTF(tfPath, 'workspaces', [
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log(remainingResult.stdout);

            console.log('\nâœ… Cleanup completed. Visual Studio should now work properly.');

        } catch (error) {
            console.error('âŒ Cleanup failed:', error.message);
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
    const cleanup = new CleanupWorkspaces();
    cleanup.cleanup();
}

module.exports = CleanupWorkspaces;

