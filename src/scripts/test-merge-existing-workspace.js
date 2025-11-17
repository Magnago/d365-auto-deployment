require('dotenv').config();
const { spawn } = require('child_process');

class TestMergeExistingWorkspace {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.patToken = process.env.AZURE_PAT;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.workspaceName = 'FELIPELOCALV41'; // Existing workspace
    }

    async test() {
        console.log('🔄 Testing Merge with Existing Workspace');
        console.log('=======================================\n');

        try {
            // Step 1: Test workspace info
            await this.testWorkspaceInfo();

            // Step 2: Test branch access
            await this.testBranchAccess();

            // Step 3: Test merge
            await this.testMerge();

            // Step 4: Check results
            await this.checkResults();

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }

    async testWorkspaceInfo() {
        console.log('1. Testing existing workspace info...');

        const result = await this.runTFCommand('workfold', [], this.username, this.patToken);

        if (result.success) {
            console.log('✅ Workspace info retrieved');
            console.log('Current mappings:', result.stdout);
        } else {
            console.log('❌ Failed to get workspace info:', result.stderr);
        }
    }

    async testBranchAccess() {
        console.log('\n2. Testing branch access...');

        const projectPath = `$/` + this.projectName;

        // Test project root
        console.log('   Testing project root...');
        await this.runTFCommand('dir', [projectPath], this.username, this.patToken);

        // Test source branch
        const sourcePath = projectPath + '/' + this.sourceBranch;
        console.log(`   Testing source branch: ${sourcePath}`);
        await this.runTFCommand('dir', [sourcePath], this.username, this.patToken);

        // Test source branch recursive
        console.log('   Testing source branch recursive...');
        await this.runTFCommand('dir', [sourcePath, '/recursive'], this.username, this.patToken);

        // Test target branch
        const targetPath = projectPath + '/' + this.targetBranch;
        console.log(`   Testing target branch: ${targetPath}`);
        await this.runTFCommand('dir', [targetPath], this.username, this.patToken);

        // Test target branch recursive
        console.log('   Testing target branch recursive...');
        await this.runTFCommand('dir', [targetPath, '/recursive'], this.username, this.patToken);
    }

    async testMerge() {
        console.log('\n3. Testing merge...');

        const projectPath = `$/` + this.projectName;
        const sourcePath = projectPath + '/' + this.sourceBranch;
        const targetPath = projectPath + '/' + this.targetBranch;

        console.log(`   Merging: ${sourcePath} → ${targetPath}`);

        const mergeResult = await this.runTFCommand('merge', [
            sourcePath,
            targetPath,
            '/recursive',
            '/force'
        ], this.username, this.patToken);

        if (mergeResult.success) {
            console.log('✅ Merge command executed successfully');
            console.log('Merge output:', mergeResult.stdout);

            if (mergeResult.stderr) {
                console.log('Merge warnings:', mergeResult.stderr);
            }
        } else {
            console.log('❌ Merge failed:', mergeResult.stderr);
        }
    }

    async checkResults() {
        console.log('\n4. Checking results...');

        // Check status for pending changes
        console.log('   Checking status...');
        const statusResult = await this.runTFCommand('status', ['/recursive'], this.username, this.patToken);

        if (statusResult.success) {
            console.log('✅ Status retrieved');
            if (statusResult.stdout.trim()) {
                console.log('Pending changes found:');
                console.log(statusResult.stdout);

                // Check in the changes
                console.log('   Checking in changes...');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const checkinComment = `Auto-deployment merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

                const checkinResult = await this.runTFCommand('checkin', [
                    '/comment:"' + checkinComment + '"',
                    '/recursive',
                    '/noprompt'
                ], this.username, this.patToken);

                if (checkinResult.success) {
                    console.log('✅ Changes checked in successfully');
                    console.log('Check-in comment:', checkinComment);
                    console.log('Check-in output:', checkinResult.stdout);

                    // Try to extract changeset number
                    const changesetMatch = checkinResult.stdout.match(/changeset\s+(\d+)/i);
                    if (changesetMatch) {
                        console.log('🔢 Changeset number:', changesetMatch[1]);
                    }
                } else {
                    console.log('❌ Check-in failed:', checkinResult.stderr);
                }
            } else {
                console.log('ℹ️  No pending changes found (branches may be in sync)');
            }
        } else {
            console.log('❌ Status check failed:', statusResult.stderr);
        }

        // Test history to see recent changesets
        console.log('\n5. Checking recent history...');
        const projectPath = `$/` + this.projectName;
        const historyResult = await this.runTFCommand('history', [
            projectPath,
            '/recursive',
            '/stopafter:5',
            '/format:detailed'
        ], this.username, this.patToken);

        if (historyResult.success) {
            console.log('✅ Recent history:');
            console.log(historyResult.stdout);
        } else {
            console.log('❌ History check failed:', historyResult.stderr);
        }
    }

    async runTFCommand(command, args = [], username = null, password = null) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];
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
                        console.log(`   Output: ${stdout}`);
                    }
                } else {
                    console.log(`   ❌ Failed (code: ${code})`);
                    if (stderr.trim()) {
                        console.log(`   Error: ${stderr}`);
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
    const tester = new TestMergeExistingWorkspace();
    tester.test()
        .then(() => {
            console.log('\n🎉 TFVC merge testing completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC merge testing failed:', error.message);
            process.exit(1);
        });
}

module.exports = TestMergeExistingWorkspace;
