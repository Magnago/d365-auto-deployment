require('dotenv').config();
const { spawn } = require('child_process');

class DiagnoseBranches {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
    }

    async execute() {
        console.log('🔍 Diagnosing TFVC Branch Issues');
        console.log('=================================\n');

        try {
            // Step 1: Test basic TFVC connectivity
            await this.testConnectivity();

            // Step 2: List all branches in the project
            await this.listAllBranches();

            // Step 3: Check specific branches we expect
            await this.checkSpecificBranches();

            // Step 4: Test workspace and mapping
            await this.testWorkspaceAndMapping();

            // Step 5: Try to create a test branch to verify permissions
            await this.testPermissions();

            // Step 6: Provide recommendations
            await this.provideRecommendations();

        } catch (error) {
            console.error('❌ Diagnosis failed:', error.message);
            throw error;
        }
    }

    async testConnectivity() {
        console.log('1. Testing TFVC connectivity...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Test basic info command
            const infoResult = await this.runTF(tfPath, 'info');

            if (infoResult.success) {
                console.log('✅ Basic TFVC connectivity working');
                console.log('   Workspace info:', infoResult.stdout || '(No workspace info)');
            } else {
                console.log('❌ Basic TFVC connectivity failed:', infoResult.stderr);
            }

            // Test collection connectivity
            const collectionResult = await this.runTF(tfPath, 'workspaces', [
                '/collection:' + this.collectionUrl
            ]);

            if (collectionResult.success) {
                console.log('✅ Collection connectivity working');
                if (collectionResult.stdout.trim()) {
                    console.log('   Workspaces in collection:', collectionResult.stdout);
                } else {
                    console.log('   No workspaces found in collection');
                }
            } else {
                console.log('❌ Collection connectivity failed:', collectionResult.stderr);
            }

        } catch (error) {
            console.log('❌ Connectivity test failed:', error.message);
        }
    }

    async listAllBranches() {
        console.log('\n2. Listing all branches in the project...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Try to list all items in the project root
            const projectRoot = `$/` + this.projectName;
            console.log(`   Checking project root: ${projectRoot}`);

            const result = await this.runTF(tfPath, 'dir', [projectRoot]);

            if (result.success) {
                console.log('✅ Project root accessible');
                console.log('   Contents:');
                result.stdout.split('\n').forEach(line => {
                    if (line.trim()) {
                        console.log(`     ${line}`);
                    }
                });
            } else {
                console.log('❌ Could not access project root:', result.stderr);

                // Try to list projects at collection level
                console.log('\n   Trying to list projects at collection level...');
                const collectionResult = await this.runTF(tfPath, 'dir', ['$/']);

                if (collectionResult.success) {
                    console.log('✅ Collection root accessible');
                    console.log('   Projects in collection:');
                    collectionResult.stdout.split('\n').forEach(line => {
                        if (line.trim()) {
                            console.log(`     ${line}`);
                        }
                    });
                } else {
                    console.log('❌ Could not access collection root:', collectionResult.stderr);
                }
            }

        } catch (error) {
            console.log('❌ Failed to list branches:', error.message);
        }
    }

    async checkSpecificBranches() {
        console.log('\n3. Checking specific branches...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        const branches = [
            this.sourceBranch,
            this.targetBranch,
            'Main',
            'Development',
            'Test',
            'Production'
        ];

        for (const branchName of branches) {
            const branchPath = `$/` + this.projectName + `/` + branchName;
            console.log(`   Checking branch: ${branchPath}`);

            try {
                const result = await this.runTF(tfPath, 'dir', [branchPath]);

                if (result.success) {
                    console.log(`   ✅ ${branchName} - Accessible`);
                    if (result.stdout.trim()) {
                        console.log(`      Contents: ${result.stdout.split('\n').slice(0, 3).join(', ')}`);
                    }
                } else {
                    console.log(`   ❌ ${branchName} - Not accessible: ${result.stderr}`);
                }

            } catch (error) {
                console.log(`   ❌ ${branchName} - Error: ${error.message}`);
            }
        }
    }

    async testWorkspaceAndMapping() {
        console.log('\n4. Testing workspace and mapping...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Check current workspace
            const workfoldResult = await this.runTF(tfPath, 'workfold');

            if (workfoldResult.success) {
                console.log('✅ Current workspace mapping:');
                workfoldResult.stdout.split('\n').forEach(line => {
                    if (line.trim()) {
                        console.log(`     ${line}`);
                    }
                });
            } else {
                console.log('❌ Could not get workspace mapping:', workfoldResult.stderr);
            }

            // Check all workspaces for this user
            const workspacesResult = await this.runTF(tfPath, 'workspaces', [
                '/owner:' + this.username,
                '/collection:' + this.collectionUrl
            ]);

            if (workspacesResult.success) {
                console.log('✅ User workspaces:');
                workspacesResult.stdout.split('\n').forEach(line => {
                    if (line.trim()) {
                        console.log(`     ${line}`);
                    }
                });
            } else {
                console.log('❌ Could not list user workspaces:', workspacesResult.stderr);
            }

        } catch (error) {
            console.log('❌ Workspace test failed:', error.message);
        }
    }

    async testPermissions() {
        console.log('\n5. Testing permissions...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        try {
            // Try to get properties of the project
            const projectPath = `$/` + this.projectName;
            const propsResult = await this.runTF(tfPath, 'properties', [projectPath]);

            if (propsResult.success) {
                console.log('✅ Can read project properties');
                console.log('   Properties:', propsResult.stdout);
            } else {
                console.log('❌ Cannot read project properties:', propsResult.stderr);
            }

            // Try to list recent changesets
            const historyResult = await this.runTF(tfPath, 'history', [
                projectPath,
                '/recursive',
                '/stopafter:5'
            ]);

            if (historyResult.success) {
                console.log('✅ Can read project history');
                if (historyResult.stdout.trim()) {
                    console.log('   Recent changesets:', historyResult.stdout.split('\n').slice(0, 3).join(', '));
                }
            } else {
                console.log('❌ Cannot read project history:', historyResult.stderr);
            }

        } catch (error) {
            console.log('❌ Permission test failed:', error.message);
        }
    }

    async provideRecommendations() {
        console.log('\n6. Recommendations and next steps...');
        console.log('=======================================');

        console.log('\n💡 Possible solutions:');
        console.log('1. Check if branches actually exist in the project');
        console.log('2. Verify workspace mappings include the branch folders');
        console.log('3. Ensure you have proper permissions to view branches');
        console.log('4. Try creating a new workspace with explicit branch mappings');
        console.log('5. Check if branches are in a different project or collection');

        console.log('\n🔧 Manual steps to try:');
        console.log('1. In Visual Studio, go to Source Control Explorer');
        console.log('2. Right-click on the project root');
        console.log('3. Select "Find in Source Control..." → "Find Branches..."');
        console.log('4. Or try "File" → "Source Control" → "Find" → "Find in Source Control"');

        console.log('\n📝 To create a test branch manually:');
        console.log('1. Right-click on the project root in Source Control Explorer');
        console.log('2. Select "Branch..."');
        console.log('3. Enter branch name like "Test-Branch"');
        console.log('4. See if it appears after creation');

        console.log('\n🔍 Check these in Azure DevOps web portal:');
        console.log('1. Go to https://your-org.visualstudio.com/');
        console.log('2. Navigate to your project');
        console.log('3. Go to "Repos" → "Files"');
        console.log('4. Verify branch names and structure');
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
            if (this.username && this.password) {
                commandArgs.push('/login:' + this.username + ',' + this.password);
            }

            console.log(`   Running: tf ${commandArgs.join(' ')}`);

            const tf = spawn('tf', commandArgs, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30000
            });

            tf.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            tf.stderr.on('data', (data) => {
                stderr += data.toString();
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
    const diagnoser = new DiagnoseBranches();
    diagnoser.execute()
        .then(() => {
            console.log('\n🎉 Diagnosis completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Diagnosis failed:', error.message);
            process.exit(1);
        });
}

module.exports = DiagnoseBranches;

