require('dotenv').config();
const { spawn } = require('child_process');

class TestSimpleMergeLikeOurScript {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.patToken = process.env.AZURE_PAT;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
    }

    async test() {
        console.log('🧪 Testing Merge Like Our TFVC Script');
        console.log('======================================\n');

        try {
            // Test 1: Check workspace context (like our script does)
            await this.checkWorkspaceContext();

            // Test 2: Validate branch accessibility (like our script does)
            await this.validateBranchAccessibility();

            // Test 3: Perform merge (like our script does)
            await this.performMerge();

            // Test 4: Check status and check-in (like our script does)
            await this.checkStatusAndCheckin();

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }

    async checkWorkspaceContext() {
        console.log('1. Checking workspace context...');

        const result = await this.runTFCommand('info', [], this.username, this.patToken);

        if (result.success) {
            console.log('✅ Workspace context available');
            console.log('Workspace info:', result.stdout || '(No workspace info displayed)');
        } else {
            console.log('❌ No workspace context:', result.stderr);
            throw new Error('No workspace context');
        }
    }

    async validateBranchAccessibility() {
        console.log('\n2. Validating branch accessibility...');

        const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
        const targetPath = `$/` + this.projectName + `/` + this.targetBranch;

        console.log(`   Checking source branch: ${sourcePath}`);
        const sourceCheck = await this.runTFCommand('dir', [sourcePath], this.username, this.patToken);

        if (sourceCheck.success) {
            console.log('   ✅ Source branch accessible');
            if (sourceCheck.stdout.trim()) {
                const files = sourceCheck.stdout.split('\n').filter(line => line.trim());
                console.log(`   📁 Source branch contains ${files.length} items`);
            } else {
                console.log('   📁 Source branch appears empty');
            }
        } else {
            console.log('   ❌ Source branch not accessible:', sourceCheck.stderr);
        }

        console.log(`   Checking target branch: ${targetPath}`);
        const targetCheck = await this.runTFCommand('dir', [targetPath], this.username, this.patToken);

        if (targetCheck.success) {
            console.log('   ✅ Target branch accessible');
            if (targetCheck.stdout.trim()) {
                const files = targetCheck.stdout.split('\n').filter(line => line.trim());
                console.log(`   📁 Target branch contains ${files.length} items`);
            } else {
                console.log('   📁 Target branch appears empty');
            }
        } else {
            console.log('   ❌ Target branch not accessible:', targetCheck.stderr);
        }

        // Test TF workspace operations
        console.log('   Testing TF workspace operations...');
        const statusCheck = await this.runTFCommand('status', [], this.username, this.patToken);

        if (statusCheck.success) {
            console.log('   ✅ TF operations working correctly');
        } else {
            console.log('   ❌ TF workspace operations failed:', statusCheck.stderr);
        }

        return { sourceCheck, targetCheck };
    }

    async performMerge() {
        console.log('\n3. Performing merge...');

        const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
        const targetPath = `$/` + this.projectName + `/` + this.targetBranch;

        console.log(`   Merging from ${this.sourceBranch} to ${this.targetBranch}`);

        const mergeResult = await this.runTFCommand('merge', [
            sourcePath,
            targetPath,
            '/recursive',
            '/force'
        ], this.username, this.patToken);

        if (mergeResult.success) {
            console.log('✅ Merge completed successfully');
            console.log('Merge output:', mergeResult.stdout || '(No output - branches may be in sync)');

            if (mergeResult.stderr) {
                console.log('Merge warnings:', mergeResult.stderr);
            }

            return mergeResult;
        } else {
            console.log('❌ Merge failed:', mergeResult.stderr);
            throw new Error(`Merge failed: ${mergeResult.stderr}`);
        }
    }

    async checkStatusAndCheckin() {
        console.log('\n4. Checking status and performing check-in...');

        const statusResult = await this.runTFCommand('status', ['/recursive'], this.username, this.patToken);

        let changesCheckedIn = false;
        let changeset = null;

        if (statusResult.success && statusResult.stdout.trim()) {
            console.log('✅ Pending changes found, checking them in...');
            console.log('Pending changes:', statusResult.stdout);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const checkinComment = `Test merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

            const checkinResult = await this.runTFCommand('checkin', [
                '/comment:"' + checkinComment + '"',
                '/recursive',
                '/noprompt'
            ], this.username, this.patToken);

            if (checkinResult.success) {
                console.log('✅ Changes checked in successfully');
                console.log('Check-in comment:', checkinComment);
                changesCheckedIn = true;

                // Try to parse changeset number
                const changesetMatch = checkinResult.stdout.match(/changeset\s+(\d+)/i);
                changeset = changesetMatch ? parseInt(changesetMatch[1]) : null;
                if (changeset) {
                    console.log('🔢 Changeset number:', changeset);
                }
            } else {
                console.log('❌ Check-in failed:', checkinResult.stderr);
                throw new Error(`Check-in failed: ${checkinResult.stderr}`);
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
                hasChanges: statusResult.success && statusResult.stdout.trim().length > 0
            }
        };
    }

    async runTFCommand(command, args = [], username = null, password = null) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];

            // Add login credentials
            if (username && password) {
                commandArgs.push('/login:' + username + ',' + password);
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
                    console.log(`   ✅ Success`);
                    if (stdout.trim()) {
                        console.log(`   Output: ${stdout.substring(0, 300)}${stdout.length > 300 ? '...' : ''}`);
                    }
                } else {
                    console.log(`   ❌ Failed (code: ${code})`);
                    if (stderr.trim()) {
                        console.log(`   Error: ${stderr.substring(0, 300)}${stderr.length > 300 ? '...' : ''}`);
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
                console.log(`   ❌ Command error: ${error.message}`);
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
    const tester = new TestSimpleMergeLikeOurScript();
    tester.test()
        .then((result) => {
            console.log('\n🎉 TFVC merge test completed successfully!');
            console.log(`✅ Result: ${result.message || 'Test completed'}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC merge test failed:', error.message);
            process.exit(1);
        });
}

module.exports = TestSimpleMergeLikeOurScript;
