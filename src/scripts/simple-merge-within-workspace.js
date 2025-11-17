require('dotenv').config();
const { spawn } = require('child_process');

class SimpleMergeWithinWorkspace {
    constructor() {
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;

        this.sourceBranchPath = `$/` + this.projectName + `/` + this.sourceBranch;
        this.targetBranchPath = `$/` + this.projectName + `/` + this.targetBranch;
    }

    async execute() {
        console.log('🔀 Simple TFVC Merge Within Existing Workspace');
        console.log('==============================================\n');
        console.log(`Source: ${this.sourceBranchPath}`);
        console.log(`Target: ${this.targetBranchPath}`);

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Step 1: Check current workspace status
            console.log('\n📋 Checking workspace context...');
            const workspaceResult = await this.runTF(tfPath, 'info');

            if (!workspaceResult.success) {
                throw new Error('No workspace context. Please run this from within Visual Studio or from a mapped directory.');
            }

            console.log('✅ Working in workspace context');
            console.log('Workspace info:', workspaceResult.stdout);

            // Step 2: Perform merge directly
            console.log(`\n🔀 Merging from ${this.sourceBranch} to ${this.targetBranch}`);
            const mergeResult = await this.runTF(tfPath, 'merge', [
                this.sourceBranchPath,
                this.targetBranchPath,
                '/recursive',
                '/force'
            ]);

            if (!mergeResult.success) {
                throw new Error(`Merge failed: ${mergeResult.stderr}`);
            }

            console.log('✅ Merge completed successfully');
            console.log('📄 Merge output:', mergeResult.stdout || '(No output from merge command)');
            if (mergeResult.stderr) {
                console.log('📄 Merge warnings:', mergeResult.stderr);
            }

            // Step 3: Check for pending changes
            console.log('\n📋 Checking for pending changes...');
            const statusResult = await this.runTF(tfPath, 'status');

            let changesCheckedIn = false;
            let changeset = null;

            if (statusResult.success && statusResult.stdout.trim()) {
                console.log('✅ Pending changes found, checking them in...');
                console.log('📄 Pending changes:', statusResult.stdout);

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const checkinComment = `Auto-deployment merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

                const checkinResult = await this.runTF(tfPath, 'checkin', [
                    '/comment:"' + checkinComment + '"',
                    '/recursive',
                    '/noprompt'
                ]);

                if (!checkinResult.success) {
                    throw new Error(`Check-in failed: ${checkinResult.stderr}`);
                }

                console.log('✅ Changes checked in successfully');
                console.log('📝 Check-in comment:', checkinComment);
                changesCheckedIn = true;

                // Try to parse changeset number
                const changesetMatch = checkinResult.stdout.match(/changeset\s+(\d+)/i);
                changeset = changesetMatch ? parseInt(changesetMatch[1]) : null;
                if (changeset) {
                    console.log('🔢 Changeset number:', changeset);
                }
            } else {
                console.log('ℹ️  No pending changes to check in (branches are already in sync)');
            }

            return {
                success: true,
                message: changesCheckedIn
                    ? 'TFVC merge and check-in completed successfully'
                    : 'TFVC merge completed - no changes needed',
                details: {
                    changesCheckedIn,
                    changeset,
                    mergeOutput: mergeResult.stdout,
                    hasChanges: statusResult.success && statusResult.stdout.trim().length > 0
                }
            };

        } catch (error) {
            console.error('❌ TFVC merge failed:', error.message);
            throw error;
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

    async runTF(tfPath, command, args = []) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];
            // Only add login if we have credentials
            if (this.username && this.password) {
                commandArgs.push('/login:' + this.username + ',' + this.password);
            }

            console.log(`Running: tf ${commandArgs.join(' ')}`);

            const tf = spawn('tf', commandArgs, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 120000
            });

            tf.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
            });

            tf.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                if (output.trim() && !output.includes('All changes are up to date')) {
                    console.log('Warning:', output.trim());
                }
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
    const merger = new SimpleMergeWithinWorkspace();
    merger.execute()
        .then((result) => {
            console.log('\n🎉 TFVC merge completed successfully!');
            console.log(`✅ Result: ${result.message}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC merge failed:', error.message);
            console.log('\n💡 To fix this issue:');
            console.log('1. Open Visual Studio');
            console.log('2. Connect to source control');
            console.log('3. Navigate to your workspace directory');
            console.log('4. Run this script again from that directory');
            process.exit(1);
        });
}

module.exports = SimpleMergeWithinWorkspace;
