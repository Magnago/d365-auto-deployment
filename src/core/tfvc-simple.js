const { spawn } = require('child_process');
const fs = require('fs');
const logger = require('./logger');

/**
 * Simplified TFVC Helper with Inline Login Authentication
 * This approach uses the /login:username,password parameter directly in TF commands
 * for fully automated authentication without requiring Visual Studio
 */
class SimpleTFVCHelper {
    constructor() {
        this.tfPath = this.findTFExecutable();
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
        this.patToken = process.env.TFVC_PAT;
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.workspaceName = process.env.TFVC_WORKSPACE || 'AutoDeploymentWorkspace';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'MyProject';
        this.defaultTimeout = 60000; // 1 minute default timeout

        // Prioritize username/password for authentication (more reliable without 2FA)
        this.usePasswordAuth = !!(this.username && this.password);
        if (this.usePasswordAuth) {
            console.log('🔐 Using Username/Password for TFVC authentication');
        } else if (this.patToken) {
            console.log('🔐 Using Personal Access Token (PAT) for TFVC authentication');
        }
    }

    /**
     * Find TF executable
     */
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
                logger.info(`Found TF executable at: ${tfPath}`);
                return tfPath;
            }
        }

        logger.error('TF executable not found. Please install Visual Studio with Team Explorer.');
        return null;
    }

    /**
     * Execute TF command with inline authentication
     * @param {string} command - TF command (workspaces, get, merge, etc.)
     * @param {Array} args - Command arguments
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} - Execution result
     */
    async executeTF(command, args = [], options = {}) {
        if (!this.tfPath) {
            throw new Error('TF executable not found');
        }

        if (!this.username && !this.password) {
            throw new Error('TFVC credentials not configured');
        }

        const {
            timeout = this.defaultTimeout,
            logOutput = true,
            useCollection = true
        } = options;

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';

            // Build command with proper TF syntax
            const commandArgs = [command];

            // TF commands that support /collection parameter
            const collectionCommands = ['workspaces', 'get', 'history', 'status', 'info'];
            // Commands that need workspace parameter
            const workspaceCommands = ['checkin'];

            // Add collection URL first if required and supported
            if (useCollection && this.collectionUrl && collectionCommands.includes(command)) {
                commandArgs.push('/collection:' + this.collectionUrl);
            }

            // For workspace-specific commands, add workspace parameter
            if (workspaceCommands.includes(command) && this.workspaceName) {
                commandArgs.push('/workspace:' + this.workspaceName);
            }

            // Add other arguments
            commandArgs.push(...args);

            // Add authentication at the end (but not for checkin when using collection)
            if (this.usePasswordAuth && !(command === 'checkin' && useCollection)) {
                commandArgs.push('/login:' + this.username + ',' + this.password);
            } else if (this.patToken && !(command === 'checkin' && useCollection)) {
                commandArgs.push('/login:buildsvc,' + this.patToken);
            }

            logger.info(`Executing TF command: tf ${commandArgs.join(' ')}`);

            const tf = spawn(`"${this.tfPath}"`, commandArgs, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout
            });

            tf.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;

                if (logOutput) {
                    output.split('\n').filter(line => line.trim()).forEach(line => {
                        logger.debug('TF stdout:', line.trim());
                    });
                }
            });

            tf.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;

                if (logOutput) {
                    output.split('\n').filter(line => line.trim()).forEach(line => {
                        logger.warn('TF stderr:', line.trim());
                    });
                }
            });

            tf.on('close', (code) => {
                const executionTime = Date.now() - startTime;

                const result = {
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    code,
                    executionTime
                };

                logger.debug('TF command completed', {
                    command: `tf ${commandArgs.join(' ')}`,
                    exitCode: code,
                    executionTime,
                    success: result.success
                });

                resolve(result);
            });

            tf.on('error', (error) => {
                logger.error('TF process error', {
                    command: `tf ${commandArgs.join(' ')}`,
                    error: error.message
                });
                reject(error);
            });
        });
    }

    /**
     * Test TFVC connection and authentication
     * @returns {Promise<Object>} - Test result
     */
    async testConnection() {
        logger.info('Testing TFVC connection with inline authentication...');

        try {
            // Test with workspaces command
            const result = await this.executeTF('workspaces', [], {
                logOutput: false,
                timeout: 30000
            });

            if (result.success) {
                logger.info('TFVC connection test successful');
                return {
                    success: true,
                    method: 'inline_login',
                    message: 'TFVC connection and authentication working'
                };
            } else {
                return {
                    success: false,
                    error: result.stderr,
                    method: 'inline_login'
                };
            }

        } catch (error) {
            logger.error('TFVC connection test failed', { error: error.message });
            return {
                success: false,
                error: error.message,
                method: 'inline_login'
            };
        }
    }

    /**
     * Configure workspace automatically
     * @param {string} workingDirectory - Working directory
     * @returns {Promise<Object>} - Configuration result
     */
    async configureWorkspace(workingDirectory) {
        logger.info('Configuring TFVC workspace automatically...', {
            workspaceName: this.workspaceName,
            workingDirectory
        });

        try {
            // Test connection first
            const connectionTest = await this.testConnection();
            if (!connectionTest.success) {
                throw new Error(`Connection test failed: ${connectionTest.error}`);
            }

            // Check if workspace exists
            const workspacesResult = await this.executeTF('workspaces', [], {
                logOutput: false,
                timeout: 30000
            });

            if (workspacesResult.success) {
                const workspaceExists = workspacesResult.stdout.includes(this.workspaceName);

                if (workspaceExists) {
                    logger.info('Using existing TF workspace:', this.workspaceName);
                } else {
                    // Create new workspace
                    logger.info('Creating new TF workspace:', this.workspaceName);
                    const createResult = await this.executeTF('workspace', [
                        '/new',
                        this.workspaceName,
                        '/permission:Private'
                    ], { timeout: 45000 });

                    if (!createResult.success) {
                        throw new Error(`Failed to create workspace: ${createResult.stderr}`);
                    }
                }

                // Map workspace to working directory
                logger.info('Mapping workspace to working directory');
                const mapResult = await this.executeTF('workfold', [
                    '$/',
                    workingDirectory
                ], { timeout: 30000 });

                if (!mapResult.success) {
                    throw new Error(`Failed to map workspace: ${mapResult.stderr}`);
                }

                logger.info('TF workspace configured successfully');
                return {
                    success: true,
                    workspaceName: this.workspaceName,
                    workingDirectory,
                    method: 'inline_login'
                };

            } else {
                throw new Error(`Failed to list workspaces: ${workspacesResult.stderr}`);
            }

        } catch (error) {
            logger.error('Failed to configure TF workspace', { error: error.message });
            throw error;
        }
    }

    /**
     * Get latest from source branch
     * @param {string} sourceBranch - Source branch path
     * @returns {Promise<Object>} - Get result
     */
    async getLatest(sourceBranch) {
        logger.info('Getting latest from source branch:', {
            sourceBranch
        });

        try {
            const result = await this.executeTF('get', [
                sourceBranch,
                '/recursive',
                '/overwrite'
            ], { timeout: 120000 }); // 2 minutes for get

            if (result.success) {
                const changesCount = this.parseChangesCount(result.stdout);
                logger.info('Get latest completed', {
                    sourceBranch,
                    filesUpdated: changesCount
                });

                return {
                    success: true,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    changes: changesCount
                };
            } else {
                throw new Error(`Get latest failed: ${result.stderr}`);
            }

        } catch (error) {
            logger.error('Get latest failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Merge branches
     * @param {string} sourceBranch - Source branch path
     * @param {string} targetBranch - Target branch path
     * @returns {Promise<Object>} - Merge result
     */
    async mergeBranches(sourceBranch, targetBranch) {
        logger.info('Merging branches:', {
            sourceBranch,
            targetBranch
        });

        try {
            const result = await this.executeTF('merge', [
                sourceBranch,
                targetBranch,
                '/recursive',
                '/workspace:' + this.workspaceName
            ], { timeout: 180000 }); // 3 minutes for merge

            if (result.success) {
                const hasConflicts = this.hasConflicts(result.stdout, result.stderr);
                const changesCount = this.parseChangesCount(result.stdout);

                logger.info('Merge completed', {
                    sourceBranch,
                    targetBranch,
                    hasConflicts,
                    changes: changesCount,
                    stdoutPreview: result.stdout.substring(0, 200),
                    stderrPreview: result.stderr.substring(0, 200)
                });

                return {
                    success: true,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    hasConflicts,
                    changes: changesCount
                };
            } else {
                const hasConflicts = this.hasConflicts(result.stdout, result.stderr);

                logger.warn('Merge completed with issues', {
                    sourceBranch,
                    targetBranch,
                    stderr: result.stderr,
                    hasConflicts
                });

                return {
                    success: false,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    hasConflicts,
                    error: result.stderr
                };
            }

        } catch (error) {
            logger.error('Merge failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Check in changes
     * @param {string} comment - Check-in comment
     * @returns {Promise<Object>} - Check-in result
     */
    async checkIn(comment) {
        logger.info('Checking in changes', { comment });

        try {
            const result = await this.executeTF('checkin', [
                '/comment:"' + comment + '"',
                '/recursive',
                '/workspace:' + this.workspaceName
            ], { timeout: 60000 });

            if (result.success) {
                const changeset = this.parseChangeset(result.stdout);
                logger.info('Check-in successful', {
                    changeset,
                    stdoutPreview: result.stdout.substring(0, 200),
                    stderrPreview: result.stderr.substring(0, 200)
                });

                return {
                    success: true,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    changeset
                };
            } else {
                logger.error('Check-in failed', {
                    stderr: result.stderr,
                    stdout: result.stdout.substring(0, 200)
                });
                throw new Error(`Check-in failed: ${result.stderr}`);
            }

        } catch (error) {
            logger.error('Check-in failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Parse number of changes from TF output
     */
    parseChangesCount(output) {
        const lines = output.split('\n');
        let count = 0;
        for (const line of lines) {
            if (line.includes('get') || line.includes('edit') || line.includes('add') || line.includes('delete') ||
                line.includes('merge') || line.includes('branch')) {
                count++;
            }
        }

        // Also check for specific TF merge success patterns
        if (output.includes('All changes merged.') || output.includes('merge completed') ||
            output.includes('Merge operation completed') || (output.includes('merge') && output.includes('completed'))) {
            // If merge completed but we didn't count changes, assume there are changes
            if (count === 0) {
                count = 1;
            }
        }

        return count;
    }

    /**
     * Check if output contains conflicts
     */
    hasConflicts(stdout, stderr) {
        const output = (stdout + ' ' + stderr).toLowerCase();
        return output.includes('conflict') || output.includes('resolve');
    }

    /**
     * Parse changeset number from output
     */
    parseChangeset(output) {
        // Try multiple patterns for changeset detection
        const patterns = [
            /Changeset\s+(\d+)/i,
            /changeset\s*#?(\d+)/i,
            /Changeset\s*:\s*(\d+)/i,
            /(\d+)\s*changeset/i
        ];

        for (const pattern of patterns) {
            const match = output.match(pattern);
            if (match) {
                logger.debug('Found changeset', { changeset: parseInt(match[1]), pattern: pattern.toString() });
                return parseInt(match[1]);
            }
        }

        logger.debug('No changeset found in output', { output: output.substring(0, 200) });
        return null;
    }

    /**
     * Check if workspace exists
     * @param {string} workspaceName - Workspace name to check
     * @returns {Promise<Object>} - Check result
     */
    async checkWorkspaceExists(workspaceName) {
        try {
            const result = await this.executeTF('workspaces', [], {
                logOutput: false,
                timeout: 30000
            });

            if (result.success) {
                const exists = result.stdout.includes(workspaceName);
                return { exists, details: result.stdout };
            } else {
                throw new Error(`Failed to check workspaces: ${result.stderr}`);
            }
        } catch (error) {
            throw new Error(`Workspace check failed: ${error.message}`);
        }
    }

    /**
     * Create public workspace with specific permissions
     * @param {string} workspaceName - Workspace name
     * @returns {Promise<Object>} - Creation result
     */
    async createPublicWorkspace(workspaceName) {
        logger.info(`Creating public workspace: ${workspaceName}`);

        try {
            const result = await this.executeTF('workspace', [
                '/new',
                workspaceName,
                '/permission:Public'
            ], { timeout: 45000 });

            if (result.success) {
                return {
                    success: true,
                    workspaceName: workspaceName,
                    message: 'Public workspace created successfully'
                };
            } else {
                throw new Error(`Failed to create public workspace: ${result.stderr}`);
            }
        } catch (error) {
            throw new Error(`Public workspace creation failed: ${error.message}`);
        }
    }

    /**
     * Map TFVC branch to local directory
     * @param {string} workspaceName - Workspace name
     * @param {string} branchPath - TFVC branch path
     * @param {string} localPath - Local directory path
     * @returns {Promise<Object>} - Mapping result
     */
    async mapBranch(workspaceName, branchPath, localPath) {
        logger.info(`Mapping branch ${branchPath} to ${localPath}`);

        try {
            const result = await this.executeTF('workfold', [
                '/workspace:' + workspaceName,
                branchPath,
                localPath
            ], { timeout: 30000 });

            if (result.success) {
                return {
                    success: true,
                    branchPath: branchPath,
                    localPath: localPath,
                    message: 'Branch mapped successfully'
                };
            } else {
                throw new Error(`Failed to map branch: ${result.stderr}`);
            }
        } catch (error) {
            throw new Error(`Branch mapping failed: ${error.message}`);
        }
    }

    /**
     * Get workspace mappings
     * @param {string} workspaceName - Workspace name
     * @returns {Promise<Object>} - Mappings result
     */
    async getWorkspaceMappings(workspaceName) {
        try {
            const result = await this.executeTF('workfold', [
                '/workspace:' + workspaceName
            ], { timeout: 30000 });

            if (result.success) {
                return {
                    success: true,
                    mappings: result.stdout,
                    workspaceName: workspaceName
                };
            } else {
                throw new Error(`Failed to get workspace mappings: ${result.stderr}`);
            }
        } catch (error) {
            throw new Error(`Workspace mappings retrieval failed: ${error.message}`);
        }
    }

    /**
     * Validate TF configuration
     */
    validateConfiguration() {
        if (!this.tfPath) {
            return { valid: false, error: 'TF.exe not found' };
        }

        if (!this.patToken && (!this.username || !this.password)) {
            return { valid: false, error: 'TFVC credentials not configured (PAT or username/password required)' };
        }

        if (!this.collectionUrl) {
            return { valid: false, error: 'Collection URL not configured' };
        }

        return { valid: true };
    }
}

module.exports = SimpleTFVCHelper;