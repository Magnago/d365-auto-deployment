require('dotenv').config();
const { spawn } = require('child_process');

class CheckAccountPermissions {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
    }

    async execute() {
        console.log('🔍 Checking TFVC Account Permissions');
        console.log('===================================\n');

        try {
            // Step 1: Check basic account access
            await this.checkAccountAccess();

            // Step 2: Check branch permissions
            await this.checkBranchPermissions();

            // Step 3: Check recent history/changesets
            await this.checkRecentHistory();

            // Step 4: Check file differences between branches
            await this.checkFileDifferences();

            // Step 5: Check if account has proper permissions in project
            await this.checkProjectPermissions();

            // Step 6: Provide recommendations
            await this.provideRecommendations();

        } catch (error) {
            console.error('❌ Permission check failed:', error.message);
            throw error;
        }
    }

    async checkAccountAccess() {
        console.log('1. Checking account access...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            throw new Error('TF.exe not found');
        }

        try {
            // Test basic TFVC connection
            const infoResult = await this.runTF(tfPath, 'info');

            if (infoResult.success) {
                console.log('✅ Account can connect to TFVC');
                console.log(`   Account: ${this.username}`);
                console.log(`   Collection: ${this.collectionUrl}`);
            } else {
                console.log('❌ Account cannot connect to TFVC:', infoResult.stderr);
            }

        } catch (error) {
            console.log('❌ Account access test failed:', error.message);
        }
    }

    async checkBranchPermissions() {
        console.log('\n2. Checking branch permissions...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            return;
        }

        const branches = [
            this.sourceBranch,
            this.targetBranch,
            'Main',
            'Development'
        ];

        for (const branchName of branches) {
            const branchPath = `$/` + this.projectName + `/` + branchName;
            console.log(`   Checking: ${branchName}`);

            try {
                // Check if we can read the branch
                const dirResult = await this.runTF(tfPath, 'dir', [branchPath]);

                if (dirResult.success) {
                    console.log(`   ✅ Can read branch folder`);

                    // Check if we can get properties
                    const propsResult = await this.runTF(tfPath, 'properties', [branchPath]);

                    if (propsResult.success) {
                        console.log(`   ✅ Can read branch properties`);
                    } else {
                        console.log(`   ⚠️  Cannot read properties: ${propsResult.stderr}`);
                    }

                    // Check folder contents
                    if (dirResult.stdout.trim()) {
                        const files = dirResult.stdout.split('\n').filter(line => line.trim());
                        console.log(`   📁 Contains ${files.length} items`);
                        if (files.length > 0 && files.length <= 5) {
                            files.forEach(file => console.log(`      - ${file}`));
                        }
                    } else {
                        console.log(`   📁 Empty branch (or no permission to see contents)`);
                    }
                } else {
                    console.log(`   ❌ Cannot access branch: ${dirResult.stderr}`);
                }

            } catch (error) {
                console.log(`   ❌ Error checking branch: ${error.message}`);
            }
        }
    }

    async checkRecentHistory() {
        console.log('\n3. Checking recent history...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            return;
        }

        try {
            // Check recent changesets in the project
            const projectPath = `$/` + this.projectName;
            const historyResult = await this.runTF(tfPath, 'history', [
                projectPath,
                '/recursive',
                '/stopafter:10',
                '/format:detailed'
            ]);

            if (historyResult.success) {
                console.log('✅ Can read project history');
                if (historyResult.stdout.trim()) {
                    const changesets = historyResult.stdout.split('\n').filter(line => line.trim());
                    console.log(`   Found ${changesets.length} recent changesets`);

                    // Show first few changesets
                    changesets.slice(0, 3).forEach(changeset => {
                        if (changeset.trim()) {
                            console.log(`   📝 ${changeset.substring(0, 100)}...`);
                        }
                    });
                } else {
                    console.log('   ⚠️  No history visible (empty project or permission issue)');
                }
            } else {
                console.log('❌ Cannot read project history:', historyResult.stderr);
            }

            // Check recent history specifically for source branch
            const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
            const sourceHistoryResult = await this.runTF(tfPath, 'history', [
                sourcePath,
                '/recursive',
                '/stopafter:5'
            ]);

            if (sourceHistoryResult.success) {
                if (sourceHistoryResult.stdout.trim()) {
                    const changesets = sourceHistoryResult.stdout.split('\n').filter(line => line.trim());
                    console.log(`   ✅ ${this.sourceBranch} has ${changesets.length} recent changesets`);
                } else {
                    console.log(`   ⚠️  ${this.sourceBranch} shows no recent changes`);
                }
            } else {
                console.log(`   ❌ Cannot read ${this.sourceBranch} history:`, sourceHistoryResult.stderr);
            }

        } catch (error) {
            console.log('❌ History check failed:', error.message);
        }
    }

    async checkFileDifferences() {
        console.log('\n4. Checking file differences between branches...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            return;
        }

        try {
            // Try to see what would be merged
            const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
            const targetPath = `$/` + this.projectName + `/` + this.targetBranch;

            console.log(`   Comparing ${this.sourceBranch} → ${this.targetBranch}`);

            // Check folder properties to see if there are differences
            const folderResult = await this.runTF(tfPath, 'difference', [
                sourcePath,
                targetPath,
                '/recursive'
            ]);

            if (folderResult.success) {
                if (folderResult.stdout.trim()) {
                    console.log('✅ Found differences between branches:');
                    folderResult.stdout.split('\n').filter(line => line.trim()).forEach(line => {
                        console.log(`   📄 ${line}`);
                    });
                } else {
                    console.log('ℹ️  No differences found (branches are identical or account cannot see differences)');
                }
            } else {
                console.log('❌ Cannot compare branches:', folderResult.stderr);
            }

            // Try to see what files exist in each branch
            for (const branch of [this.sourceBranch, this.targetBranch]) {
                const branchPath = `$/` + this.projectName + `/` + branch;
                const filesResult = await this.runTF(tfPath, 'dir', [branchPath, '/recursive']);

                if (filesResult.success) {
                    const files = filesResult.stdout.split('\n').filter(line => line.trim());
                    console.log(`   📁 ${branch}: ${files.length} files/folders`);

                    // Show some file types
                    const fileTypes = {};
                    files.forEach(file => {
                        const ext = file.includes('.') ? file.split('.').pop().toLowerCase() : 'folder';
                        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
                    });

                    Object.entries(fileTypes).slice(0, 5).forEach(([ext, count]) => {
                        console.log(`      ${ext}: ${count}`);
                    });
                } else {
                    console.log(`   ❌ Cannot list files in ${branch}`);
                }
            }

        } catch (error) {
            console.log('❌ File difference check failed:', error.message);
        }
    }

    async checkProjectPermissions() {
        console.log('\n5. Checking project permissions...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            return;
        }

        try {
            // Check if account has specific TFVC permissions
            const projectPath = `$/` + this.projectName;

            const securityResult = await this.runTF(tfPath, 'security', [
                projectPath
            ]);

            if (securityResult.success) {
                console.log('✅ Can read security information');
                if (securityResult.stdout.trim()) {
                    console.log('   Security permissions visible');
                }
            } else {
                console.log('⚠️  Cannot read security info:', securityResult.stderr);
            }

            // Try to list all projects the account can see
            const projectsResult = await this.runTF(tfPath, 'dir', ['$/']);

            if (projectsResult.success) {
                console.log('✅ Can list collection projects:');
                projectsResult.stdout.split('\n').filter(line => line.trim()).forEach(project => {
                    console.log(`   📂 ${project}`);
                });
            } else {
                console.log('❌ Cannot list collection projects:', projectsResult.stderr);
            }

        } catch (error) {
            console.log('❌ Permission check failed:', error.message);
        }
    }

    async provideRecommendations() {
        console.log('\n6. Recommendations');
        console.log('================\n');

        console.log('🔍 Possible Issues:');
        console.log('1. The auto-deployment account has READ access to branches but cannot see file contents');
        console.log('2. The account lacks "Check-in" or "Merge" permissions');
        console.log('3. The account is not in the proper Azure DevOps security groups');
        console.log('4. The account may have limited access to specific folders/files');

        console.log('\n🔧 Solutions:');
        console.log('1. Add auto-deployment account to "Contributors" group in Azure DevOps');
        console.log('2. Grant specific TFVC permissions:');
        console.log('   - Read, PendEdit, Checkin, Merge, Label');
        console.log('3. Ensure account has access to all branch folders');
        console.log('4. Check Azure DevOps web portal → Project Settings → Security');

        console.log('\n🌐 Check in Azure DevOps Web Portal:');
        console.log('1. Go to: https://your-org.visualstudio.com/');
        console.log('2. Navigate to your project');
        console.log('3. Go to "Project Settings" → "Security"');
        console.log('4. Find the auto-deployment account');
        console.log('5. Ensure it has proper permissions');
        console.log('6. Check "TFVC" specific permissions');

        console.log('\n💡 Alternative: Use your personal account');
        console.log('If the auto-deployment account cannot be given proper permissions,');
        console.log('consider temporarily using your personal account credentials in .env');
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
    const checker = new CheckAccountPermissions();
    checker.execute()
        .then(() => {
            console.log('\n🎉 Permission check completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Permission check failed:', error.message);
            process.exit(1);
        });
}

module.exports = CheckAccountPermissions;

