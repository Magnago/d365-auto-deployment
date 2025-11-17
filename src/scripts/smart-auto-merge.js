require('dotenv').config();

// Use your personal account credentials
process.env.TFVC_USERNAME = 'buildsvc@example.com';
process.env.TFVC_PASSWORD = 'YOUR_TFVC_PAT_OR_PASSWORD';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SmartAutoMerge {
    constructor() {
        this.username = process.env.TFVC_USERNAME;
        this.patToken = process.env.TFVC_PASSWORD;
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.tfPath = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe';
    }

    async execute() {
        console.log('ðŸŽ¯ Smart Auto TFVC Merge');
        console.log('========================\n');
        console.log(`Username: ${this.username}`);
        console.log(`Source: $/${this.projectName}/${this.sourceBranch}`);
        console.log(`Target: $/${this.projectName}/${this.targetBranch}`);
        console.log('');

        try {
            // Step 1: Try common workspace locations
            const workingPath = await this.findWorkspacePath();

            if (!workingPath) {
                console.log('âŒ Could not find TFVC workspace');
                return;
            }

            console.log(`âœ… Found workspace: ${workingPath}`);

            // Step 2: Test TFVC connectivity
            const connectivityTest = await this.testConnectivity(workingPath);

            if (!connectivityTest.success) {
                console.log('âŒ TFVC connectivity test failed');
                return;
            }

            console.log('âœ… TFVC connectivity confirmed');

            // Step 3: Perform merge operations
            await this.performMergeOperations(workingPath);

        } catch (error) {
            console.error('âŒ Smart auto merge failed:', error.message);
        }
    }

    async findWorkspacePath() {
        console.log('1. Searching for TFVC workspace...');

        // Common D365 workspace locations
        const possiblePaths = [
            'C:\\AosService\\PackagesLocalDirectory',
            'C:\\D365FO\\Main',
            'C:\\D365\\PackagesLocalDirectory',
            'C:\\Dev\\D365',
            'C:\\Projects\\D365',
            'C:\\Source\\D365',
            path.join(os.homedir(), 'Source', 'D365'),
            path.join(os.homedir(), 'Projects', 'D365'),
            path.join(os.homedir(), 'Documents', 'Visual Studio 2022', 'Projects')
        ];

        // Check for Visual Studio solution files that indicate D365 projects
        for (const basePath of possiblePaths) {
            if (fs.existsSync(basePath)) {
                console.log(`   Checking path: ${basePath}`);

                // Look for D365 indicators
                const hasD365Indicators = await this.checkD365Indicators(basePath);

                if (hasD365Indicators) {
                    console.log(`   âœ… Found D365 workspace: ${basePath}`);
                    return basePath;
                }
            }
        }

        // If no D365-specific path found, look for any .vs folder
        for (const basePath of possiblePaths) {
            if (fs.existsSync(basePath)) {
                const vsFolder = path.join(basePath, '.vs');
                if (fs.existsSync(vsFolder)) {
                    console.log(`   âœ… Found Visual Studio workspace: ${basePath}`);
                    return basePath;
                }
            }
        }

        console.log('   âŒ No suitable workspace found');
        return null;
    }

    async checkD365Indicators(basePath) {
        const indicators = [
            'AxBuild.exe',
            'xppc.exe',
            'Kernel.dll',
            'PackagesLocalDirectory',
            '.axmodel',
            'MetadataCache.axc'
        ];

        for (const indicator of indicators) {
            const fullPath = path.join(basePath, '**', indicator);
            try {
                // Simple check for common D365 files
                const files = await this.findFiles(basePath, indicator);
                if (files.length > 0) {
                    console.log(`     Found D365 indicator: ${indicator}`);
                    return true;
                }
            } catch (error) {
                // Continue checking other indicators
            }
        }

        return false;
    }

    async findFiles(basePath, pattern) {
        return new Promise((resolve) => {
            const dir = path.join(basePath);
            const cmd = spawn('dir', ['/s', '/b', pattern], {
                cwd: dir,
                shell: true,
                stdio: 'pipe'
            });

            let output = '';
            cmd.stdout.on('data', (data) => {
                output += data.toString();
            });

            cmd.on('close', () => {
                const files = output.split('\n').filter(line => line.trim());
                resolve(files);
            });

            cmd.on('error', () => {
                resolve([]);
            });
        });
    }

    async testConnectivity(workingPath) {
        console.log('\n2. Testing TFVC connectivity...');

        try {
            // Simple workspace test
            const result = await this.runTFCommandFromPath(workingPath, 'workspaces', []);

            if (result.success) {
                console.log('   âœ… TFVC commands work from this location');
                return { success: true };
            } else {
                console.log('   âŒ TFVC commands failed:', result.stderr);
                return { success: false, error: result.stderr };
            }
        } catch (error) {
            console.log('   âŒ Connectivity test error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async performMergeOperations(workingPath) {
        console.log('\n3. Performing merge operations...');

        const sourcePath = `$/` + this.projectName + `/` + this.sourceBranch;
        const targetPath = `$/` + this.projectName + `/` + this.targetBranch;

        // Test branch access first
        console.log(`   Testing branch access...`);
        const sourceTest = await this.runTFCommandFromPath(workingPath, 'dir', [sourcePath]);

        if (!sourceTest.success) {
            console.log(`   âŒ Cannot access source branch: ${sourceTest.stderr}`);
            console.log('   This might indicate:');
            console.log('   - Branch doesn\'t exist');
            console.log('   - No permissions for this branch');
            console.log('   - Workspace mapping issue');
            return;
        }

        console.log(`   âœ… Source branch accessible`);

        const targetTest = await this.runTFCommandFromPath(workingPath, 'dir', [targetPath]);

        if (!targetTest.success) {
            console.log(`   âŒ Cannot access target branch: ${targetTest.stderr}`);
            return;
        }

        console.log(`   âœ… Target branch accessible`);

        // Perform merge
        console.log(`\n4. Executing merge: ${sourcePath} â†’ ${targetPath}`);

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

            // Check for pending changes
            console.log('\n5. Checking for pending changes...');

            const statusResult = await this.runTFCommandFromPath(workingPath, 'status', ['/recursive']);

            if (statusResult.success && statusResult.stdout.trim()) {
                console.log('   âœ… Pending changes found!');
                console.log('   Status output:', statusResult.stdout);

                // Check in changes
                console.log('\n6. Checking in changes...');

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

                    console.log('\nðŸŽ‰ SMART AUTOMATED TFVC MERGE COMPLETED SUCCESSFULLY!');
                    console.log(`   âœ… Source: ${this.sourceBranch}`);
                    console.log(`   âœ… Target: ${this.targetBranch}`);
                    console.log(`   âœ… Changeset: ${changesetMatch ? changesetMatch[1] : 'Unknown'}`);
                    console.log(`   âœ… Workspace: ${workingPath}`);

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

            const tf = spawn('"' + this.tfPath + '"', commandArgs, {
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
    const merger = new SmartAutoMerge();
    merger.execute();
}

module.exports = SmartAutoMerge;


