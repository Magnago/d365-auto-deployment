require('dotenv').config();
const { spawn } = require('child_process');

class TestTFVCAccess {
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
        console.log('🧪 Testing TFVC Command Line Access');
        console.log('==================================\n');

        // Test 1: Try with original password
        await this.testWithPassword();

        // Test 2: Try with PAT
        await this.testWithPAT();

        // Test 3: Try different collection URLs
        await this.testDifferentURLs();

        // Test 4: Try workspace creation and merge
        await this.testWorkspaceAndMerge();
    }

    async testWithPassword() {
        console.log('1. Testing with username/password...');
        await this.runTFCommand('workspaces', [], this.username, this.password);
    }

    async testWithPAT() {
        console.log('\n2. Testing with PAT...');
        await this.runTFCommand('workspaces', [], this.username, this.patToken);
    }

    async testDifferentURLs() {
        console.log('\n3. Testing different collection URLs...');

        const urls = [
            'https://your-org.visualstudio.com/',
            'https://your-org.visualstudio.com/DefaultCollection',
            'https://dev.azure.com/your-org',
            'https://your-org.visualstudio.com/YourTFVCProject'
        ];

        for (const url of urls) {
            console.log(`\n   Testing URL: ${url}`);
            await this.runTFCommand('workspaces', ['/collection:' + url], this.username, this.patToken);
        }
    }

    async testWorkspaceAndMerge() {
        console.log('\n4. Testing workspace creation and merge...');

        // Create a temporary workspace
        const workspaceName = 'TestWorkspace-' + Date.now();
        const localPath = 'C:\\Temp\\TFVC-Test';

        console.log(`   Creating workspace: ${workspaceName}`);
        const workspaceResult = await this.runTFCommand('workspace', [
            '/new',
            workspaceName,
            '/collection:' + this.collectionUrl,
            '/noprompt'
        ], this.username, this.patToken);

        if (workspaceResult.success) {
            console.log('   ✅ Workspace created successfully');

            // Map the project
            console.log('   Mapping project...');
            const projectPath = `$/` + this.projectName;
            const mapResult = await this.runTFCommand('workfold', [
                '/map',
                projectPath,
                localPath,
                '/workspace:' + workspaceName
            ], this.username, this.patToken);

            if (mapResult.success) {
                console.log('   ✅ Project mapped successfully');

                // Test directory access
                console.log('   Testing directory access...');
                await this.runTFCommand('dir', [projectPath], this.username, this.patToken);

                // Test source branch
                const sourcePath = projectPath + '/' + this.sourceBranch;
                console.log(`   Testing source branch: ${sourcePath}`);
                await this.runTFCommand('dir', [sourcePath], this.username, this.patToken);

                // Test target branch
                const targetPath = projectPath + '/' + this.targetBranch;
                console.log(`   Testing target branch: ${targetPath}`);
                await this.runTFCommand('dir', [targetPath], this.username, this.patToken);

                // Test merge
                console.log('   Testing merge...');
                const mergeResult = await this.runTFCommand('merge', [
                    sourcePath,
                    targetPath,
                    '/recursive',
                    '/force'
                ], this.username, this.patToken);

                if (mergeResult.success) {
                    console.log('   ✅ Merge command executed');
                    console.log('   Merge output:', mergeResult.stdout);

                    // Check status
                    console.log('   Checking status...');
                    await this.runTFCommand('status', ['/recursive'], this.username, this.patToken);
                }

            } else {
                console.log('   ❌ Failed to map project:', mapResult.stderr);
            }

            // Cleanup workspace
            console.log('   Cleaning up workspace...');
            await this.runTFCommand('workspace', [
                '/delete',
                workspaceName,
                '/noprompt'
            ], this.username, this.patToken);

        } else {
            console.log('   ❌ Failed to create workspace:', workspaceResult.stderr);
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
    const tester = new TestTFVCAccess();
    tester.test()
        .then(() => {
            console.log('\n🎉 TFVC access testing completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 TFVC access testing failed:', error.message);
            process.exit(1);
        });
}

module.exports = TestTFVCAccess;


