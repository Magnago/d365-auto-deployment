require('dotenv').config();

// Use your personal account credentials
process.env.TFVC_USERNAME = 'buildsvc@example.com';
process.env.TFVC_PASSWORD = 'YOUR_TFVC_PAT_OR_PASSWORD';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class CompleteAutoMerge {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.patToken = process.env.TFVC_PASSWORD;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.tfPath = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe';
        this.workspacePath = 'C:\\AosService\\PackagesLocalDirectory';
    }

    async execute() {
        console.log('ðŸš€ Complete Auto TFVC Merge');
        console.log('==========================\n');
        console.log(`Username: ${this.username}`);
        console.log(`Source: $/${this.projectName}/${this.sourceBranch}`);
        console.log(`Target: $/${this.projectName}/${this.targetBranch}`);
        console.log(`Workspace: ${this.workspacePath}`);
        console.log('');

        try {
            // Step 1: Setup workspace mappings if needed
            await this.setupWorkspaceMappings();

            // Step 2: Test branch access
            await this.testBranchAccess();

            // Step 3: Perform merge
            await this.performMerge();

            // Step 4: Check-in changes
            await this.checkInChanges();

            console.log('\nðŸŽ‰ COMPLETE AUTOMATED TFVC MERGE FINISHED!');

        } catch (error) {
            console.error('âŒ Complete auto merge failed:', error.message);
        }
    }

    async setupWorkspaceMappings() {
        console.log('1. Setting up workspace mappings...');

        const projectPath = `$/` + this.projectName;

        // Check if workspace already has mapping
        console.log('   Checking current mappings...');
        const currentMappings = await this.runTFCommand('workfold', []);

        if (currentMappings.success && currentMappings.stdout.includes(projectPath)) {
            console.log('   âœ… Project mapping already exists');
            return;
        }

        console.log(`   Mapping project: ${projectPath} â†’ ${this.workspacePath}`);

        // Create the mapping
        const mapResult = await this.runTFCommand('workfold', [
            '/map',
            projectPath,
            this.workspacePath
        ]);

        if (mapResult.success) {
            console.log('   âœ… Project mapping created successfully');
        } else {
            console.log('   âš ï¸  Could not create mapping:', mapResult.stderr);
            console.log('   Continuing with existing mappings...');
        }
    }

    async testBranchAccess() {
        console.log('\n2. Testing branch access...');

        const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
        const targetPath = `$/` + this.projectName + `/` + this.targetBranch;

        // Test source branch
        console.log(`   Testing source branch: ${sourcePath}`);
        const sourceResult = await this.runTFCommand('dir', [sourcePath]);

        if (sourceResult.success) {
            console.log('   âœ… Source branch accessible');
            if (sourceResult.stdout.trim()) {
                const files = sourceResult.stdout.split('\n').filter(line => line.trim());
                console.log(`   ðŸ“ Contains ${files.length} items`);
            } else {
                console.log('   ðŸ“ Branch appears empty');
            }
        } else {
            console.log('   âŒ Source branch not accessible:', sourceResult.stderr);
            throw new Error(`Cannot access source branch: ${sourceResult.stderr}`);
        }

        // Test target branch
        console.log(`   Testing target branch: ${targetPath}`);
        const targetResult = await this.runTFCommand('dir', [targetPath]);

        if (targetResult.success) {
            console.log('   âœ… Target branch accessible');
            if (targetResult.stdout.trim()) {
                const files = targetResult.stdout.split('\n').filter(line => line.trim());
                console.log(`   ðŸ“ Contains ${files.length} items`);
            } else {
                console.log('   ðŸ“ Branch appears empty');
            }
        } else {
            console.log('   âŒ Target branch not accessible:', targetResult.stderr);
            throw new Error(`Cannot access target branch: ${targetResult.stderr}`);
        }
    }

    async performMerge() {
        console.log('\n3. Performing merge...');

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
            console.log('   âœ… Merge executed successfully');
            console.log('   Merge output:', mergeResult.stdout || '(No output - branches may be in sync)');

            if (mergeResult.stderr) {
                console.log('   Merge warnings:', mergeResult.stderr);
            }
        } else {
            console.log('   âŒ Merge failed:', mergeResult.stderr);
            throw new Error(`Merge failed: ${mergeResult.stderr}`);
        }
    }

    async checkInChanges() {
        console.log('\n4. Checking for pending changes...');

        const statusResult = await this.runTFCommand('status', ['/recursive']);

        if (statusResult.success && statusResult.stdout.trim()) {
            console.log('   âœ… Pending changes found!');
            console.log('   Status output:', statusResult.stdout);

            // Check in the changes
            console.log('\n5. Checking in changes...');

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

                console.log('\nðŸŽ‰ AUTOMATED MERGE AND CHECK-IN COMPLETED!');
                console.log(`   âœ… Source: ${this.sourceBranch}`);
                console.log(`   âœ… Target: ${this.targetBranch}`);
                console.log(`   âœ… Changeset: ${changesetMatch ? changesetMatch[1] : 'Unknown'}`);
                console.log(`   âœ… Workspace: ${this.workspacePath}`);

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

            const tf = spawn('"' + this.tfPath + '"', commandArgs, {
                cwd: this.workspacePath,
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
                        console.log(`   Output: ${stdout.substring(0, 400)}${stdout.length > 400 ? '...' : ''}`);
                    }
                } else {
                    console.log(`   âŒ Failed (code: ${code})`);
                    if (stderr.trim()) {
                        console.log(`   Error: ${stderr.substring(0, 400)}${stderr.length > 400 ? '...' : ''}`);
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
    const merger = new CompleteAutoMerge();
    merger.execute();
}

module.exports = CompleteAutoMerge;


