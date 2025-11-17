require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class CreateWorkspaceWithBranches {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.workspaceName = 'VS-Workspace-' + this.username.split('@')[0];

        // Create workspace folder in user's Documents
        this.workspaceRoot = path.join(os.homedir(), 'Documents', 'D365-Workspace');

        this.branches = [
            {
                name: 'Auto-Deployment-Dev',
                serverPath: `$/` + this.projectName + `/Auto-Deployment-Dev`,
                localPath: path.join(this.workspaceRoot, 'Auto-Deployment-Dev')
            },
            {
                name: 'Auto-Deployment-Test',
                serverPath: `$/` + this.projectName + `/Auto-Deployment-Test`,
                localPath: path.join(this.workspaceRoot, 'Auto-Deployment-Test')
            },
            {
                name: 'Main',
                serverPath: `$/` + this.projectName + `/Main`,
                localPath: path.join(this.workspaceRoot, 'Main')
            },
            {
                name: 'Development',
                serverPath: `$/` + this.projectName + `/Development`,
                localPath: path.join(this.workspaceRoot, 'Development')
            }
        ];
    }

    async execute() {
        console.log('🏗️  Creating TFVC Workspace with Branch Mappings');
        console.log('==============================================\n');

        try {
            // Step 1: Clean up any existing workspaces
            await this.cleanupExistingWorkspaces();

            // Step 2: Create local workspace directories
            await this.createLocalDirectories();

            // Step 3: Create new workspace
            await this.createNewWorkspace();

            // Step 4: Map all branches
            await this.mapAllBranches();

            // Step 5: Get latest files
            await this.getLatestFiles();

            // Step 6: Verify workspace
            await this.verifyWorkspace();

            console.log('\n✅ Workspace setup completed successfully!');
            console.log('\n📁 Workspace location:', this.workspaceRoot);
            console.log('\n💡 Next steps:');
            console.log('1. Start Visual Studio');
            console.log('2. Go to Team Explorer → Projects');
            console.log('3. Click "Manage Connections" → "Connect to Team Projects"');
            console.log('4. Connect to: https://your-org.visualstudio.com/');
            console.log('5. Select your Your TFVC Project');
            console.log('6. Your workspace "' + this.workspaceName + '" should be automatically detected');
            console.log('7. Branches should now appear in Source Control Explorer');

        } catch (error) {
            console.error('❌ Workspace setup failed:', error.message);
            throw error;
        }
    }

    async cleanupExistingWorkspaces() {
        console.log('1. Cleaning up existing workspaces...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            throw new Error('TF.exe not found');
        }

        try {
            // List all workspaces for this user
            const workspacesResult = await this.runTF(tfPath, 'workspaces', [
                '/owner:' + this.username,
                '/collection:' + this.collectionUrl
            ]);

            if (workspacesResult.success && workspacesResult.stdout.trim()) {
                const workspaces = this.parseWorkspaceList(workspacesResult.stdout);

                for (const workspace of workspaces) {
                    console.log(`   Removing existing workspace: ${workspace.name}`);
                    await this.runTF(tfPath, 'workspace', [
                        '/delete',
                        workspace.fullName,
                        '/noprompt'
                    ]);
                }
            }

            console.log('✅ Existing workspaces cleaned up');

        } catch (error) {
            console.log('⚠️  Could not clean up workspaces:', error.message);
        }
    }

    async createLocalDirectories() {
        console.log('\n2. Creating local directories...');

        try {
            if (!fs.existsSync(this.workspaceRoot)) {
                fs.mkdirSync(this.workspaceRoot, { recursive: true });
                console.log(`   Created: ${this.workspaceRoot}`);
            }

            for (const branch of this.branches) {
                if (!fs.existsSync(branch.localPath)) {
                    fs.mkdirSync(branch.localPath, { recursive: true });
                    console.log(`   Created: ${branch.localPath}`);
                }
            }

            console.log('✅ Local directories created');

        } catch (error) {
            throw new Error(`Failed to create directories: ${error.message}`);
        }
    }

    async createNewWorkspace() {
        console.log('\n3. Creating new workspace...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            throw new Error('TF.exe not found');
        }

        try {
            // Create a public workspace
            const result = await this.runTF(tfPath, 'workspace', [
                '/new',
                this.workspaceName,
                '/collection:' + this.collectionUrl,
                '/permission:Public',
                '/noprompt'
            ]);

            if (result.success) {
                console.log(`✅ Created workspace: ${this.workspaceName}`);
            } else {
                throw new Error(`Failed to create workspace: ${result.stderr}`);
            }

        } catch (error) {
            throw new Error(`Workspace creation failed: ${error.message}`);
        }
    }

    async mapAllBranches() {
        console.log('\n4. Mapping branches...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            throw new Error('TF.exe not found');
        }

        try {
            for (const branch of this.branches) {
                console.log(`   Mapping ${branch.name}:`);
                console.log(`     ${branch.serverPath} → ${branch.localPath}`);

                const result = await this.runTF(tfPath, 'workfold', [
                    '/map',
                    branch.serverPath,
                    branch.localPath,
                    '/workspace:' + this.workspaceName
                ]);

                if (result.success) {
                    console.log(`   ✅ Mapped ${branch.name}`);
                } else {
                    console.log(`   ⚠️  Failed to map ${branch.name}: ${result.stderr}`);
                }
            }

            console.log('✅ Branch mapping completed');

        } catch (error) {
            throw new Error(`Branch mapping failed: ${error.message}`);
        }
    }

    async getLatestFiles() {
        console.log('\n5. Getting latest files...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            throw new Error('TF.exe not found');
        }

        try {
            // Get latest for the Auto-Deployment-Dev branch
            const devBranch = this.branches.find(b => b.name === 'Auto-Deployment-Dev');
            if (devBranch) {
                console.log(`   Getting latest for ${devBranch.name}...`);

                const result = await this.runTF(tfPath, 'get', [
                    devBranch.serverPath,
                    '/recursive',
                    '/overwrite'
                ]);

                if (result.success) {
                    console.log(`   ✅ Got latest files for ${devBranch.name}`);
                } else {
                    console.log(`   ⚠️  Get latest failed: ${result.stderr}`);
                }
            }

        } catch (error) {
            console.log(`⚠️  Get latest failed: ${error.message}`);
        }
    }

    async verifyWorkspace() {
        console.log('\n6. Verifying workspace...');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            throw new Error('TF.exe not found');
        }

        try {
            // Check workspace info
            const workfoldResult = await this.runTF(tfPath, 'workfold', [
                '/workspace:' + this.workspaceName
            ]);

            if (workfoldResult.success) {
                console.log('✅ Workspace mappings:');
                workfoldResult.stdout.split('\n').forEach(line => {
                    if (line.trim()) {
                        console.log(`     ${line}`);
                    }
                });
            }

            // Check if branches are accessible
            for (const branch of this.branches) {
                const dirResult = await this.runTF(tfPath, 'dir', [branch.serverPath]);

                if (dirResult.success) {
                    console.log(`   ✅ ${branch.name} - Accessible`);
                } else {
                    console.log(`   ❌ ${branch.name} - Not accessible: ${dirResult.stderr}`);
                }
            }

        } catch (error) {
            console.log(`⚠️  Workspace verification failed: ${error.message}`);
        }
    }

    parseWorkspaceList(output) {
        const workspaces = [];
        const lines = output.split('\n');

        for (const line of lines) {
            if (line.trim() && line.includes(':')) {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const name = parts[0].trim();
                    const collection = parts[1].trim();

                    workspaces.push({
                        name: name,
                        collection: collection,
                        fullName: `${name};${collection}`
                    });
                }
            }
        }

        return workspaces;
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
                timeout: 60000
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
    const creator = new CreateWorkspaceWithBranches();
    creator.execute()
        .then(() => {
            console.log('\n🎉 Workspace creation completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Workspace creation failed:', error.message);
            process.exit(1);
        });
}

module.exports = CreateWorkspaceWithBranches;

