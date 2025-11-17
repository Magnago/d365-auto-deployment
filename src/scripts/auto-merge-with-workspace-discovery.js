require('dotenv').config();

// Use your personal account credentials
process.env.TFVC_USERNAME = 'buildsvc@example.com';
process.env.TFVC_PASSWORD = 'YOUR_TFVC_PAT_OR_PASSWORD';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class AutoMergeWithWorkspaceDiscovery {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.patToken = process.env.TFVC_PASSWORD;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.tfPath = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe';
    }

    async execute() {
        console.log('ðŸ”„ Auto TFVC Merge with Workspace Discovery');
        console.log('==========================================\n');
        console.log(`Username: ${this.username}`);
        console.log(`Source: $/${this.projectName}/${this.sourceBranch}`);
        console.log(`Target: $/${this.projectName}/${this.targetBranch}`);
        console.log('');

        try {
            // Step 1: Discover workspace mappings
            const workspaceInfo = await this.discoverWorkspace();

            if (!workspaceInfo.success) {
                console.log('âŒ Could not discover workspace mappings');
                return;
            }

            console.log(`âœ… Found workspace: ${workspaceInfo.workspaceName}`);
            console.log(`ðŸ“ Workspace mappings:`);
            workspaceInfo.mappings.forEach(mapping => {
                console.log(`   ${mapping.serverPath} â†’ ${mapping.localPath}`);
            });

            // Step 2: Find suitable local path for TF commands
            const workingPath = await this.findWorkingPath(workspaceInfo.mappings);

            if (!workingPath) {
                console.log('âŒ Could not find suitable working directory');
                return;
            }

            console.log(`\nðŸŽ¯ Using working directory: ${workingPath}`);

            // Step 3: Perform merge operations
            await this.performMergeFromPath(workingPath);

        } catch (error) {
            console.error('âŒ Auto merge failed:', error.message);
        }
    }

    async discoverWorkspace() {
        console.log('1. Discovering workspace mappings...');

        try {
            // Get all workspaces for the user
            const workspacesResult = await this.runTFCommand('workspaces', [
                '/owner:' + this.username,
                '/format:Detailed'
            ]);

            if (!workspacesResult.success) {
                console.log('âŒ Could not list workspaces:', workspacesResult.stderr);
                return { success: false };
            }

            // Parse workspace information
            const workspace = this.parseWorkspaces(workspacesResult.stdout);

            if (!workspace) {
                console.log('âŒ No suitable workspace found');
                return { success: false };
            }

            // Get detailed mappings for the workspace
            const mappingsResult = await this.runTFCommand('workfold', [
                '/workspace:' + workspace.name,
                '/format:Detailed'
            ]);

            if (!mappingsResult.success) {
                console.log('âŒ Could not get workspace mappings:', mappingsResult.stderr);
                return { success: false };
            }

            const mappings = this.parseMappings(mappingsResult.stdout);

            return {
                success: true,
                workspaceName: workspace.name,
                mappings: mappings
            };

        } catch (error) {
            console.log('âŒ Error discovering workspace:', error.message);
            return { success: false };
        }
    }

    parseWorkspaces(output) {
        const lines = output.split('\n');
        let workspace = null;

        for (const line of lines) {
            if (line.includes('Workspace:') && line.includes(this.username)) {
                const match = line.match(/Workspace:\s*(.+)/);
                if (match) {
                    workspace = { name: match[1].trim() };
                    break;
                }
            }
        }

        return workspace;
    }

    parseMappings(output) {
        const mappings = [];
        const lines = output.split('\n');
        let currentMapping = null;

        for (const line of lines) {
            if (line.includes('$')) {
                const match = line.match(/^\s*(\$[^:]+):\s*(.+)/);
                if (match) {
                    currentMapping = {
                        serverPath: match[1].trim(),
                        localPath: match[2].trim()
                    };
                    mappings.push(currentMapping);
                }
            }
        }

        return mappings;
    }

    async findWorkingPath(mappings) {
        console.log('\n2. Finding suitable working directory...');

        // Try to find a mapping that includes the project
        const projectPath = `$/` + this.projectName;

        for (const mapping of mappings) {
            if (mapping.serverPath === projectPath || mapping.serverPath.startsWith(projectPath)) {
                if (fs.existsSync(mapping.localPath)) {
                    console.log(`   âœ… Found mapped directory: ${mapping.localPath}`);
                    return mapping.localPath;
                } else {
                    console.log(`   âš ï¸  Mapped directory doesn't exist: ${mapping.localPath}`);
                }
            }
        }

        // If no exact project mapping found, try any mapped directory
        for (const mapping of mappings) {
            if (fs.existsSync(mapping.localPath)) {
                console.log(`   âœ… Using alternative mapped directory: ${mapping.localPath}`);
                return mapping.localPath;
            }
        }

        return null;
    }

    async performMergeFromPath(workingPath) {
        console.log('\n3. Performing merge operations...');

        const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
        const targetPath = `$/` + this.projectName + `/` + this.targetBranch;

        // Step 1: Perform merge
        console.log(`   Merging: ${sourcePath} â†’ ${targetPath}`);

        const mergeResult = await this.runTFCommandFromPath(workingPath, 'merge', [
            sourcePath,
            targetPath,
            '/recursive',
            '/force'
        ]);

        if (mergeResult.success) {
            console.log('   âœ… Merge executed successfully');
            console.log('   Merge output:', mergeResult.stdout || '(No output - branches may be in sync)');

            if (mergeResult.stderr) {
                console.log('   Merge warnings:', mergeResult.stderr);
            }

            // Step 2: Check status
            console.log('\n4. Checking for pending changes...');

            const statusResult = await this.runTFCommandFromPath(workingPath, 'status', ['/recursive']);

            if (statusResult.success && statusResult.stdout.trim()) {
                console.log('   âœ… Pending changes found!');
                console.log('   Status output:', statusResult.stdout);

                // Step 3: Check in changes
                console.log('\n5. Checking in changes...');

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const checkinComment = `Automated merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;

                const checkinResult = await this.runTFCommandFromPath(workingPath, 'checkin', [
                    '/comment:"' + checkinComment + '"',
                    '/recursive',
                    '/noprompt'
                ]);

                if (checkinResult.success) {
                    console.log('   âœ… Changes checked in successfully!');
                    console.log('   Check-in comment:', checkinComment);
                    console.log('   Check-in output:', checkinResult.stdout);

                    // Extract changeset number
                    const changesetMatch = checkinResult.stdout.match(/changeset\s+(\d+)/i);
                    if (changesetMatch) {
                        console.log('   ðŸ”¢ Changeset number:', changesetMatch[1]);
                    }

                    console.log('\nðŸŽ‰ COMPLETE AUTOMATED TFVC MERGE SUCCESSFUL!');
                    console.log(`   âœ… Source: ${this.sourceBranch}`);
                    console.log(`   âœ… Target: ${this.targetBranch}`);
                    console.log(`   âœ… Changeset: ${changesetMatch ? changesetMatch[1] : 'Unknown'}`);
                    console.log(`   âœ… Working from: ${workingPath}`);

                } else {
                    console.log('   âŒ Check-in failed:', checkinResult.stderr);
                }
            } else {
                console.log('   â„¹ï¸  No pending changes (branches may already be in sync)');
                console.log('   ðŸŽ‰ MERGE COMPLETED - No changes needed');
            }
        } else {
            console.log('   âŒ Merge failed:', mergeResult.stderr);
        }
    }

    async runTFCommand(command, args = []) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];

            // Add login credentials
            if (this.username && this.patToken) {
                commandArgs.push('/login:' + this.username + ',' + this.patToken);
            }

            console.log(`   Running: tf ${commandArgs.join(' ')}`);

            const tf = spawn('"' + this.tfPath + '"', commandArgs, {
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

    async runTFCommandFromPath(workingPath, command, args = []) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const commandArgs = [command, ...args];

            // Add login credentials
            if (this.username && this.patToken) {
                commandArgs.push('/login:' + this.username + ',' + this.patToken);
            }

            console.log(`   Running from ${workingPath}: tf ${commandArgs.join(' ')}`);

            const tf = spawn('tf', commandArgs, {
                cwd: workingPath,
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
                    console.log(`   âœ… Success`);
                    if (stdout.trim()) {
                        console.log(`   Output: ${stdout.substring(0, 400)}${stdout.length > 400 ? '...' : ''}`);
                    }
                } else {
                    console.log(`   âŒ Failed (code: ${code})`);
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
                console.log(`   âŒ Command error: ${error.message}`);
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
    const merger = new AutoMergeWithWorkspaceDiscovery();
    merger.execute();
}

module.exports = AutoMergeWithWorkspaceDiscovery;


