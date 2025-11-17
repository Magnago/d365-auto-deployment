require('dotenv').config();

// Use your personal account credentials
process.env.TFVC_USERNAME = 'buildsvc@example.com';
process.env.TFVC_PASSWORD = 'YOUR_TFVC_PAT_OR_PASSWORD';

const { spawn } = require('child_process');

class DirectMergeTest {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.patToken = process.env.TFVC_PASSWORD;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
    }

    async test() {
        console.log('ðŸ”„ Direct TFVC Merge Test');
        console.log('==========================\n');
        console.log(`Username: ${this.username}`);
        console.log(`Source: $/${this.projectName}/${this.sourceBranch}`);
        console.log(`Target: $/${this.projectName}/${this.targetBranch}`);
        console.log('');

        try {
            // Step 1: Perform merge directly
            await this.performMerge();

            // Step 2: Check status and check-in if needed
            await this.checkStatusAndCheckin();

            console.log('\nðŸŽ‰ Direct merge test completed successfully!');

        } catch (error) {
            console.error('\nðŸ’¥ Direct merge test failed:', error.message);
        }
    }

    async performMerge() {
        console.log('1. Performing merge...');

        const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
        const targetPath = `$/` + this.projectName + `/` + this.targetBranch;

        console.log(`   Merging: ${sourcePath} â†’ ${targetPath}`);

        const mergeResult = await this.runTFCommand('merge', [
            sourcePath,
            targetPath,
            '/recursive',
            '/force'
        ]);

        if (mergeResult.success) {
            console.log('   âœ… Merge command executed successfully');
            console.log('   Merge output:', mergeResult.stdout || '(No output - branches may be in sync)');

            if (mergeResult.stderr) {
                console.log('   Merge warnings:', mergeResult.stderr);
            }
        } else {
            console.log('   âŒ Merge failed:', mergeResult.stderr);
            throw new Error(`Merge failed: ${mergeResult.stderr}`);
        }
    }

    async checkStatusAndCheckin() {
        console.log('\n2. Checking for pending changes...');

        const statusResult = await this.runTFCommand('status', ['/recursive']);

        if (statusResult.success && statusResult.stdout.trim()) {
            console.log('   âœ… Pending changes found!');
            console.log('   Status output:', statusResult.stdout);

            // Check in the changes
            console.log('\n3. Checking in changes...');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const checkinComment = `Automated merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

            const checkinResult = await this.runTFCommand('checkin', [
                '/comment:"' + checkinComment + '"',
                '/recursive',
                '/noprompt'
            ]);

            if (checkinResult.success) {
                console.log('   âœ… Changes checked in successfully!');
                console.log('   Check-in comment:', checkinComment);
                console.log('   Check-in output:', checkinResult.stdout);

                // Extract changeset number
                const changesetMatch = checkinResult.stdout.match(/changeset\s+(\d+)/i);
                if (changesetMatch) {
                    console.log('   ðŸ”¢ Changeset number:', changesetMatch[1]);
                }

                console.log('\nðŸŽ‰ MERGE AND CHECK-IN COMPLETED SUCCESSFULLY!');
                console.log(`   âœ… Source: ${this.sourceBranch}`);
                console.log(`   âœ… Target: ${this.targetBranch}`);
                console.log(`   âœ… Changeset: ${changesetMatch ? changesetMatch[1] : 'Unknown'}`);
            } else {
                console.log('   âŒ Check-in failed:', checkinResult.stderr);
                throw new Error(`Check-in failed: ${checkinResult.stderr}`);
            }
        } else {
            console.log('   â„¹ï¸  No pending changes (branches may already be in sync)');
            console.log('   ðŸŽ‰ MERGE COMPLETED - No changes needed');
        }
    }

    async runTFCommand(command, args = []) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];

            // Add login credentials
            if (this.username && this.patToken) {
                commandArgs.push('/login:' + this.username + ',' + this.patToken);
            }

            console.log(`   Running: tf ${commandArgs.join(' ')}`);

            const tfPath = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe';
            const tf = spawn('"' + tfPath + '"', commandArgs, {
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
                const success = code === 0;

                if (success) {
                    console.log(`   âœ… Success`);
                    if (stdout.trim()) {
                        console.log(`   Output: ${stdout.substring(0, 500)}${stdout.length > 500 ? '...' : ''}`);
                    }
                } else {
                    console.log(`   âŒ Failed (code: ${code})`);
                    if (stderr.trim()) {
                        console.log(`   Error: ${stderr.substring(0, 500)}${stderr.length > 500 ? '...' : ''}`);
                    }
                }

                resolve({
                    success,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    code
                });
            });

            tf.on('error', (error) => {
                console.log(`   âŒ Command error: ${error.message}`);
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
    const tester = new DirectMergeTest();
    tester.test();
}

module.exports = DirectMergeTest;


