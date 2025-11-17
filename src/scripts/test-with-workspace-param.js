require('dotenv').config();
const { spawn } = require('child_process');

class TestWithWorkspaceParam {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.patToken = process.env.AZURE_PAT;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.workspaceName = 'FELIPELOCALV41'; // From our previous test
    }

    async test() {
        console.log('🧪 Testing TFVC with Workspace Parameter');
        console.log('========================================\n');

        try {
            // Test with explicit workspace parameter
            await this.testWithWorkspace();

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }

    async testWithWorkspace() {
        const projectPath = `$/` + this.projectName;
        const sourcePath = projectPath + '/' + this.sourceBranch;
        const targetPath = projectPath + '/' + this.targetBranch;

        console.log('1. Testing with explicit workspace parameter...');

        // Test workspace info with workspace parameter
        console.log('   Testing workspace info with workspace parameter...');
        await this.runTFCommand('workfold', ['/workspace:' + this.workspaceName], this.username, this.patToken);

        // Test project access
        console.log(`   Testing project access with workspace: ${projectPath}`);
        await this.runTFCommand('dir', [projectPath, '/workspace:' + this.workspaceName], this.username, this.patToken);

        // Test source branch
        console.log(`   Testing source branch with workspace: ${sourcePath}`);
        const sourceResult = await this.runTFCommand('dir', [sourcePath, '/recursive', '/workspace:' + this.workspaceName], this.username, this.patToken);

        // Test target branch
        console.log(`   Testing target branch with workspace: ${targetPath}`);
        const targetResult = await this.runTFCommand('dir', [targetPath, '/recursive', '/workspace:' + this.workspaceName], this.username, this.patToken);

        // If both branches are accessible, test merge
        if (sourceResult.success && targetResult.success) {
            console.log('\n2. Testing merge with workspace parameter...');
            console.log(`   Merging: ${sourcePath} → ${targetPath}`);

            const mergeResult = await this.runTFCommand('merge', [
                sourcePath,
                targetPath,
                '/recursive',
                '/force',
                '/workspace:' + this.workspaceName
            ], this.username, this.patToken);

            if (mergeResult.success) {
                console.log('   ✅ Merge executed successfully!');
                console.log('   Merge output:', mergeResult.stdout);

                // Check status
                console.log('\n3. Checking status...');
                const statusResult = await this.runTFCommand('status', ['/recursive', '/workspace:' + this.workspaceName], this.username, this.patToken);

                if (statusResult.success && statusResult.stdout.trim()) {
                    console.log('   ✅ Pending changes found!');
                    console.log('   Status output:', statusResult.stdout);

                    // Check in changes
                    console.log('\n4. Checking in changes...');
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const checkinComment = `Automated merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

                    const checkinResult = await this.runTFCommand('checkin', [
                        '/comment:"' + checkinComment + '"',
                        '/recursive',
                        '/noprompt',
                        '/workspace:' + this.workspaceName
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
                    } else {
                        console.log('   ❌ Check-in failed:', checkinResult.stderr);
                    }
                } else {
                    console.log('   ℹ️  No pending changes (branches may be in sync)');
                }
            } else {
                console.log('   ❌ Merge failed:', mergeResult.stderr);
            }
        } else {
            console.log('   ❌ Could not access branches for merge test');
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
                        console.log(`   Output: ${stdout.substring(0, 400)}${stdout.length > 400 ? '...' : ''}`);
                    }
                } else {
                    console.log(`   ❌ Failed (code: ${code})`);
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
    const tester = new TestWithWorkspaceParam();
    tester.test()
        .then(() => {
            console.log('\n🎉 TFVC workspace parameter test completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC workspace parameter test failed:', error.message);
            process.exit(1);
        });
}

module.exports = TestWithWorkspaceParam;
