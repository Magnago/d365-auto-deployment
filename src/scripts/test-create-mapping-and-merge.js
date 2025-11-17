require('dotenv').config();
const { spawn } = require('child_process');

class TestCreateMappingAndMerge {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.patToken = process.env.AZURE_PAT;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.workspaceName = 'FELIPELOCALV41'; // Existing workspace
        this.localPath = 'C:\\Temp\\TFVC-Mapping-Test';
    }

    async test() {
        console.log('🧪 Creating Mappings and Testing Merge');
        console.log('=======================================\n');

        try {
            // Step 1: Create mappings for the workspace
            await this.createMappings();

            // Step 2: Test branch access
            await this.testBranchAccess();

            // Step 3: Test merge
            await this.testMerge();

            // Step 4: Cleanup
            await this.cleanup();

        } catch (error) {
            console.error('❌ Test failed:', error.message);
            await this.cleanup();
        }
    }

    async createMappings() {
        console.log('1. Creating workspace mappings...');

        const projectPath = `$/` + this.projectName;

        // Map the project root
        console.log(`   Mapping project: ${projectPath} → ${this.localPath}`);
        const mapResult = await this.runTFCommand('workfold', [
            projectPath,
            this.localPath
        ], this.username, this.patToken);

        if (mapResult.success) {
            console.log('   ✅ Project mapped successfully');
        } else {
            console.log('   ❌ Failed to map project:', mapResult.stderr);
            throw new Error('Failed to create workspace mapping');
        }
    }

    async testBranchAccess() {
        console.log('\n2. Testing branch access...');

        const projectPath = `$/` + this.projectName;

        // Test project access
        console.log(`   Testing project access: ${projectPath}`);
        const projectResult = await this.runTFCommand('dir', [projectPath], this.username, this.patToken);

        if (projectResult.success) {
            console.log('   ✅ Project accessible');

            // Test source branch
            const sourcePath = projectPath + '/' + this.sourceBranch;
            console.log(`   Testing source branch: ${sourcePath}`);
            const sourceResult = await this.runTFCommand('dir', [sourcePath, '/recursive'], this.username, this.patToken);

            // Test target branch
            const targetPath = projectPath + '/' + this.targetBranch;
            console.log(`   Testing target branch: ${targetPath}`);
            const targetResult = await this.runTFCommand('dir', [targetPath, '/recursive'], this.username, this.patToken);

            if (sourceResult.success) {
                console.log(`   ✅ Source branch accessible (${sourceResult.stdout.split('\n').filter(line => line.trim()).length} items)`);
            } else {
                console.log(`   ❌ Source branch not accessible: ${sourceResult.stderr}`);
            }

            if (targetResult.success) {
                console.log(`   ✅ Target branch accessible (${targetResult.stdout.split('\n').filter(line => line.trim()).length} items)`);
            } else {
                console.log(`   ❌ Target branch not accessible: ${targetResult.stderr}`);
            }

            return { sourceResult, targetResult };
        } else {
            console.log('   ❌ Project not accessible:', projectResult.stderr);
            return { sourceResult: { success: false }, targetResult: { success: false } };
        }
    }

    async testMerge() {
        console.log('\n3. Testing merge...');

        const projectPath = `$/` + this.projectName;
        const sourcePath = projectPath + '/' + this.sourceBranch;
        const targetPath = projectPath + '/' + this.targetBranch;

        console.log(`   Executing merge: ${sourcePath} → ${targetPath}`);

        const mergeResult = await this.runTFCommand('merge', [
            sourcePath,
            targetPath,
            '/recursive',
            '/force'
        ], this.username, this.patToken);

        if (mergeResult.success) {
            console.log('   ✅ Merge command executed successfully!');
            if (mergeResult.stdout.trim()) {
                console.log('   Merge output:', mergeResult.stdout);
            } else {
                console.log('   Merge output: (No output - branches may be in sync)');
            }

            if (mergeResult.stderr.trim()) {
                console.log('   Merge warnings:', mergeResult.stderr);
            }

            // Check for pending changes
            console.log('\n4. Checking for pending changes...');
            const statusResult = await this.runTFCommand('status', ['/recursive'], this.username, this.patToken);

            if (statusResult.success && statusResult.stdout.trim()) {
                console.log('   ✅ Pending changes found!');
                console.log('   Status output:', statusResult.stdout);

                // Check in the changes
                console.log('\n5. Checking in changes...');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const checkinComment = `Automated merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

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

                    console.log('\n🎉 MERGE AND CHECK-IN COMPLETED SUCCESSFULLY!');
                    console.log(`   Source: ${this.sourceBranch}`);
                    console.log(`   Target: ${this.targetBranch}`);
                    console.log(`   Changeset: ${changesetMatch ? changesetMatch[1] : 'Unknown'}`);
                } else {
                    console.log('   ❌ Check-in failed:', checkinResult.stderr);
                }
            } else {
                console.log('   ℹ️  No pending changes (branches may already be in sync)');
                console.log('   🎉 MERGE COMPLETED - No changes needed');
            }
        } else {
            console.log('   ❌ Merge failed:', mergeResult.stderr);
        }
    }

    async cleanup() {
        console.log('\n6. Cleaning up mappings...');

        const projectPath = `$/` + this.projectName;

        try {
            // Remove the mapping we created
            const unmapResult = await this.runTFCommand('workfold', [
                '/unmap',
                projectPath
            ], this.username, this.patToken);

            if (unmapResult.success) {
                console.log('   ✅ Mappings cleaned up');
            } else {
                console.log('   ⚠️  Could not clean up mappings:', unmapResult.stderr);
            }
        } catch (error) {
            console.log('   ⚠️  Cleanup error:', error.message);
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
                        const displayOutput = stdout.substring(0, 500);
                        console.log(`   Output: ${displayOutput}${stdout.length > 500 ? '...' : ''}`);
                    }
                } else {
                    console.log(`   ❌ Failed (code: ${code})`);
                    if (stderr.trim()) {
                        const displayError = stderr.substring(0, 500);
                        console.log(`   Error: ${displayError}${stderr.length > 500 ? '...' : ''}`);
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
    const tester = new TestCreateMappingAndMerge();
    tester.test()
        .then(() => {
            console.log('\n🎉 TFVC mapping and merge test completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC mapping and merge test failed:', error.message);
            process.exit(1);
        });
}

module.exports = TestCreateMappingAndMerge;
