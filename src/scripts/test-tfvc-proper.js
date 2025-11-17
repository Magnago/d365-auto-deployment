require('dotenv').config();
const { spawn } = require('child_process');

class TestTFVCProper {
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
        console.log('🧪 Testing TFVC with Proper Workspace Context');
        console.log('============================================\n');

        try {
            // Step 1: Get workspace details first
            const workspaceInfo = await this.getWorkspaceDetails();

            if (workspaceInfo.success) {
                // Step 2: Test from workspace context
                await this.testFromWorkspace(workspaceInfo.mappings);
            } else {
                // Step 3: Create temporary workspace
                await this.createAndTestTemporaryWorkspace();
            }

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }

    async getWorkspaceDetails() {
        console.log('1. Getting existing workspace details...');

        try {
            // Get workspace details without specifying workspace to see current context
            const result = await this.runTFCommand('workspaces', [
                '/owner:' + this.username,
                '/collection:' + this.collectionUrl
            ], this.username, this.patToken);

            if (result.success && result.stdout.includes(this.workspaceName)) {
                console.log('✅ Found existing workspace');

                // Get workspace mappings
                const mapResult = await this.runTFCommand('workfold', [
                    '/workspace:' + this.workspaceName,
                    '/collection:' + this.collectionUrl
                ], this.username, this.patToken);

                if (mapResult.success) {
                    console.log('✅ Workspace mappings retrieved');
                    return {
                        success: true,
                        name: this.workspaceName,
                        mappings: mapResult.stdout
                    };
                }
            }

            console.log('❌ Could not get workspace details');
            return { success: false };

        } catch (error) {
            console.log('❌ Error getting workspace details:', error.message);
            return { success: false };
        }
    }

    async testFromWorkspace(mappings) {
        console.log('\n2. Testing from workspace context...');

        const projectPath = `$/` + this.projectName;

        // Test project access
        console.log('   Testing project access...');
        await this.runTFCommand('dir', [projectPath], this.username, this.patToken, this.workspaceName);

        // Test source branch
        const sourcePath = projectPath + '/' + this.sourceBranch;
        console.log(`   Testing source branch: ${sourcePath}`);
        const sourceResult = await this.runTFCommand('dir', [sourcePath, '/recursive'], this.username, this.patToken, this.workspaceName);

        // Test target branch
        const targetPath = projectPath + '/' + this.targetBranch;
        console.log(`   Testing target branch: ${targetPath}`);
        const targetResult = await this.runTFCommand('dir', [targetPath, '/recursive'], this.username, this.patToken, this.workspaceName);

        // Test merge
        if (sourceResult.success && targetResult.success) {
            console.log('\n3. Testing merge...');
            await this.runTFCommand('merge', [sourcePath, targetPath, '/recursive', '/force'], this.username, this.patToken, this.workspaceName);

            // Check status
            console.log('\n4. Checking status...');
            const statusResult = await this.runTFCommand('status', ['/recursive'], this.username, this.patToken, this.workspaceName);

            if (statusResult.success && statusResult.stdout.trim()) {
                console.log('   Pending changes found, checking in...');
                await this.runTFCommand('checkin', [
                    '/comment:"Test merge from ' + this.sourceBranch + ' to ' + this.targetBranch + '"',
                    '/recursive',
                    '/noprompt'
                ], this.username, this.patToken, this.workspaceName);
            } else {
                console.log('   No pending changes (branches may be in sync)');
            }
        }
    }

    async createAndTestTemporaryWorkspace() {
        console.log('\n3. Creating temporary workspace...');

        const tempWorkspaceName = 'TempTest-' + Date.now();
        const localPath = 'C:\\Temp\\TFVC-Test';

        // Create workspace
        const createResult = await this.runTFCommand('workspace', [
            '/new',
            tempWorkspaceName,
            '/collection:' + this.collectionUrl,
            '/noprompt'
        ], this.username, this.patToken);

        if (createResult.success) {
            console.log('✅ Temporary workspace created');

            try {
                // Map project
                const projectPath = `$/` + this.projectName;
                console.log('   Mapping project...');
                await this.runTFCommand('workfold', [
                    '/map',
                    projectPath,
                    localPath,
                    '/workspace:' + tempWorkspaceName
                ], this.username, this.patToken);

                // Test access
                console.log('   Testing project access...');
                await this.runTFCommand('dir', [projectPath], this.username, this.patToken, tempWorkspaceName);

                // Test branches
                const sourcePath = projectPath + '/' + this.sourceBranch;
                console.log(`   Testing source branch: ${sourcePath}`);
                await this.runTFCommand('dir', [sourcePath], this.username, this.patToken, tempWorkspaceName);

                const targetPath = projectPath + '/' + this.targetBranch;
                console.log(`   Testing target branch: ${targetPath}`);
                await this.runTFCommand('dir', [targetPath], this.username, this.patToken, tempWorkspaceName);

                // Test merge
                console.log('   Testing merge...');
                await this.runTFCommand('merge', [sourcePath, targetPath, '/recursive', '/force'], this.username, this.patToken, tempWorkspaceName);

                // Check status
                console.log('   Checking status...');
                await this.runTFCommand('status', ['/recursive'], this.username, this.patToken, tempWorkspaceName);

            } finally {
                // Cleanup workspace
                console.log('   Cleaning up temporary workspace...');
                await this.runTFCommand('workspace', [
                    '/delete',
                    tempWorkspaceName,
                    '/noprompt'
                ], this.username, this.patToken);
            }
        } else {
            console.log('❌ Failed to create temporary workspace:', createResult.stderr);
        }
    }

    async runTFCommand(command, args = [], username = null, password = null, workspace = null) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];

            // Add workspace parameter if specified
            if (workspace) {
                commandArgs.push('/workspace:' + workspace);
            }

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
                        console.log(`   Output: ${stdout.substring(0, 200)}${stdout.length > 200 ? '...' : ''}`);
                    }
                } else {
                    console.log(`   ❌ Failed (code: ${code})`);
                    if (stderr.trim()) {
                        console.log(`   Error: ${stderr.substring(0, 200)}${stderr.length > 200 ? '...' : ''}`);
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
    const tester = new TestTFVCProper();
    tester.test()
        .then(() => {
            console.log('\n🎉 TFVC proper testing completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC proper testing failed:', error.message);
            process.exit(1);
        });
}

module.exports = TestTFVCProper;
