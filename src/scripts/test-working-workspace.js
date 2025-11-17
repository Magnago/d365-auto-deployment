require('dotenv').config();
const { spawn } = require('child_process');

class TestWorkingWorkspace {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.patToken = process.env.AZURE_PAT;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
    }

    async test() {
        console.log('🧪 Testing TFVC Working Workspace (No Collection Param)');
        console.log('======================================================\n');

        try {
            // Step 1: Test basic commands without collection
            await this.testBasicCommands();

            // Step 2: Test merge operations
            await this.testMergeOperations();

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }

    async testBasicCommands() {
        console.log('1. Testing basic commands...');

        // Test workspaces (this worked before)
        console.log('   Testing workspaces...');
        await this.runTFCommand('workspaces', [], this.username, this.patToken);

        // Test workspace info
        console.log('   Testing workspace info...');
        await this.runTFCommand('workfold', [], this.username, this.patToken);

        // Test project access
        const projectPath = `$/` + this.projectName;
        console.log(`   Testing project access: ${projectPath}`);
        await this.runTFCommand('dir', [projectPath], this.username, this.patToken);

        // Test source branch
        const sourcePath = projectPath + '/' + this.sourceBranch;
        console.log(`   Testing source branch: ${sourcePath}`);
        await this.runTFCommand('dir', [sourcePath], this.username, this.patToken);

        // Test source branch recursive
        console.log(`   Testing source branch recursive: ${sourcePath}`);
        await this.runTFCommand('dir', [sourcePath, '/recursive'], this.username, this.patToken);

        // Test target branch
        const targetPath = projectPath + '/' + this.targetBranch;
        console.log(`   Testing target branch: ${targetPath}`);
        await this.runTFCommand('dir', [targetPath], this.username, this.patToken);

        // Test target branch recursive
        console.log(`   Testing target branch recursive: ${targetPath}`);
        await this.runTFCommand('dir', [targetPath, '/recursive'], this.username, this.patToken);
    }

    async testMergeOperations() {
        console.log('\n2. Testing merge operations...');

        const projectPath = `$/` + this.projectName;
        const sourcePath = projectPath + '/' + this.sourceBranch;
        const targetPath = projectPath + '/' + this.targetBranch;

        // Test merge command
        console.log(`   Testing merge: ${sourcePath} → ${targetPath}`);
        const mergeResult = await this.runTFCommand('merge', [
            sourcePath,
            targetPath,
            '/recursive',
            '/force'
        ], this.username, this.patToken);

        if (mergeResult.success) {
            console.log('   ✅ Merge command executed successfully');

            // Check status for pending changes
            console.log('   Checking status...');
            const statusResult = await this.runTFCommand('status', ['/recursive'], this.username, this.patToken);

            if (statusResult.success && statusResult.stdout.trim()) {
                console.log('   ✅ Pending changes found!');
                console.log('   Status output:', statusResult.stdout);

                // Check in the changes
                console.log('   Checking in changes...');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const checkinComment = `Test merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

                const checkinResult = await this.runTFCommand('checkin', [
                    '/comment:"' + checkinComment + '"',
                    '/recursive',
                    '/noprompt'
                ], this.username, this.patToken);

                if (checkinResult.success) {
                    console.log('   ✅ Changes checked in successfully!');
                    console.log('   Check-in comment:', checkinComment);
                    console.log('   Check-in output:', checkinResult.stdout);

                    // Extract changeset number
                    const changesetMatch = checkinResult.stdout.match(/changeset\s+(\d+)/i);
                    if (changesetMatch) {
                        console.log('   🔢 Changeset number:', changesetMatch[1]);
                    }

                    // Test history to confirm
                    console.log('\n3. Verifying with history...');
                    await this.runTFCommand('history', [
                        projectPath,
                        '/recursive',
                        '/stopafter:3'
                    ], this.username, this.patToken);

                } else {
                    console.log('   ❌ Check-in failed:', checkinResult.stderr);
                }
            } else {
                console.log('   ℹ️  No pending changes (branches may already be in sync)');
            }
        } else {
            console.log('   ❌ Merge failed:', mergeResult.stderr);
        }
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
    const tester = new TestWorkingWorkspace();
    tester.test()
        .then(() => {
            console.log('\n🎉 TFVC working workspace test completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC working workspace test failed:', error.message);
            process.exit(1);
        });
}

module.exports = TestWorkingWorkspace;
