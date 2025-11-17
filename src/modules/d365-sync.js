const path = require('path');
const fs = require('fs-extra');
const PowerShellRunner = require('../core/powershell-runner');
const logger = require('../core/logger');

class D365Sync {
    constructor() {
        this.psRunner = new PowerShellRunner();
        this.defaultTimeout = 30 * 60 * 1000; // 30 minutes default timeout
    }

    /**
     * Detect the current D365 environment type (local or cloud)
     * @returns {Promise<string>} - Environment type ('local' or 'cloud')
     */
    async detectEnvironment() {
        const environments = require('../../config/environments.json');

        // Check if cloud paths exist
        if (await fs.pathExists(environments.cloud.packages)) {
            logger.info('Detected cloud environment (K: drive)');
            return 'cloud';
        }

        // Check if local paths exist
        if (await fs.pathExists(environments.local.packages)) {
            logger.info('Detected local environment (C: drive)');
            return 'local';
        }

        // Default to local if neither is found
        logger.warn('Could not detect environment, defaulting to local');
        return 'local';
    }

    /**
     * Get environment-specific paths
     * @param {string} environmentType - Environment type ('local' or 'cloud')
     * @returns {Object} - Environment paths
     */
    getEnvironmentPaths(environmentType) {
        const environments = require('../../config/environments.json');
        return environments[environmentType] || environments.local;
    }

    /**
     * Validate D365 environment for sync operations
     * @param {Object} paths - Environment paths to validate
     * @returns {Promise<boolean>} - True if environment is valid for sync
     */
    async validateEnvironment(paths) {
        const requiredPaths = [
            paths.packages,
            paths.webRoot,
            path.join(paths.webRoot, 'bin')
        ];

        for (const requiredPath of requiredPaths) {
            if (!await fs.pathExists(requiredPath)) {
                logger.error('Required D365 path not found', { path: requiredPath });
                return false;
            }
        }

        // Check for deployment setup tool
        const setupToolPath = path.join(paths.webRoot, 'bin', 'Microsoft.Dynamics.AX.Deployment.Setup.exe');
        if (!await fs.pathExists(setupToolPath)) {
            logger.warn('Deployment setup tool not found', { path: setupToolPath });
            // This is not a critical error for PowerShell-based sync
        }

        logger.info('D365 environment validation successful for sync');
        return true;
    }

    /**
     * Perform full database synchronization using PowerShell cmdlets
     * @param {Object} options - Sync options
     * @returns {Promise<Object>} - Sync result
     */
    async performFullSync(options = {}) {
        const {
            syncMode = 'full',
            timeout = parseInt(process.env.SYNC_TIMEOUT) || this.defaultTimeout,
            deploymentLogDir = null
        } = options;

        logger.startStep('D365 Database Synchronization', { syncMode });

        try {
            // Detect environment
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Validate environment
            if (!await this.validateEnvironment(paths)) {
                throw new Error('D365 environment validation failed for sync');
            }

            // Prepare sync commands
            const syncCommands = await this.prepareSyncCommands(paths, syncMode);

            logger.info('Starting D365 database synchronization', {
                syncMode,
                environmentType,
                commandsCount: syncCommands.length,
                timeout
            });

            // Execute sync commands in sequence
            const results = [];
            let totalExecutionTime = 0;

            for (let i = 0; i < syncCommands.length; i++) {
                const command = syncCommands[i];
                const commandName = `Sync Step ${i + 1}`;

                logger.info(`Executing ${commandName}`, {
                    command: command.substring(0, 100) + '...'
                });

                try {
                    const result = await this.psRunner.execute(command, {
                        timeout,
                        cwd: paths.webRoot,
                        workingDirectory: paths.webRoot,
                        logOutput: true,
                        deploymentLogDir
                    });

                    results.push({
                        step: i + 1,
                        name: commandName,
                        success: result.success,
                        stdout: result.stdout,
                        stderr: result.stderr,
                        executionTime: result.executionTime
                    });

                    totalExecutionTime += result.executionTime;

                    if (!result.success) {
                        logger.error(`${commandName} failed`, {
                            step: i + 1,
                            error: result.stderr
                        });
                        break;
                    }

                } catch (error) {
                    logger.error(`${commandName} failed with exception`, {
                        step: i + 1,
                        error: error.message
                    });

                    results.push({
                        step: i + 1,
                        name: commandName,
                        success: false,
                        error: error.message,
                        executionTime: 0
                    });

                    break;
                }
            }

            // Determine overall success
            const overallSuccess = results.every(result => result.success);

            if (overallSuccess) {
                logger.completeStep('D365 Database Synchronization', {
                    syncMode,
                    totalExecutionTime,
                    stepsCompleted: results.length
                });
            } else {
                const failedStep = results.find(r => !r.success);
                logger.failStep('D365 Database Synchronization',
                    new Error(failedStep.error || failedStep.stderr), {
                    syncMode,
                    failedStep: failedStep.step,
                    totalExecutionTime
                });
            }

            return {
                success: overallSuccess,
                syncMode,
                environmentType,
                results,
                totalExecutionTime,
                stepsCompleted: results.length
            };

        } catch (error) {
            logger.failStep('D365 Database Synchronization', error);
            throw error;
        }
    }

    /**
     * Prepare database synchronization commands
     * @param {Object} paths - Environment paths
     * @param {string} syncMode - Sync mode ('full', 'incremental')
     * @returns {Promise<Array<string>>} - Array of PowerShell commands
     */
    async prepareSyncCommands(paths, syncMode) {
        const commands = [];

        // Use SyncEngine.exe for database synchronization (proper D365 FO tool)
        const syncEnginePath = path.join(paths.binPath, 'SyncEngine.exe');
        const metadataPath = paths.packages;
        const computerName = process.env.COMPUTERNAME || 'localhost';

        // Build connection string
        const connectionString = `Data Source=${computerName};Initial Catalog=AxDB;Integrated Security=True;Enlist=True;Application Name=SyncEngine`;

        if (syncMode === 'full') {
            // Full database synchronization using SyncEngine.exe
            const syncArgs = [
                '-syncmode=fullall',
                `-metadatabinaries="${metadataPath}"`,
                `-connect="${connectionString}"`,
                '-fallbacktonative=False'
            ];
            commands.push(`& "${syncEnginePath}" ${syncArgs.join(' ')}`);
        } else {
            // Incremental synchronization
            const syncArgs = [
                '-syncmode=partiallist',
                `-metadatabinaries="${metadataPath}"`,
                `-connect="${connectionString}"`,
                '-fallbacktonative=False'
            ];
            commands.push(`& "${syncEnginePath}" ${syncArgs.join(' ')}`);
        }

        // Additional cleanup and optimization commands (optional - skip if not available)
        commands.push('Write-Host "AX Cache clearing skipped - Clear-AXCache not available"');

        return commands;
    }

    /**
     * Perform incremental database synchronization
     * @param {Object} options - Sync options
     * @returns {Promise<Object>} - Sync result
     */
    async performIncrementalSync(options = {}) {
        return this.performFullSync({
            ...options,
            syncMode: 'incremental'
        });
    }

    /**
     * Sync specific module
     * @param {string} module - Module name to sync
     * @param {Object} options - Sync options
     * @returns {Promise<Object>} - Sync result
     */
    async syncModule(module, options = {}) {
        logger.startStep('D365 Module Synchronization', { module });

        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Prepare module-specific sync command
            const syncCommand = await this.prepareModuleSyncCommand(paths, module);

            logger.info('Starting D365 module synchronization', {
                module,
                environmentType
            });

            const result = await this.psRunner.execute(syncCommand, {
                timeout: options.timeout || this.defaultTimeout,
                cwd: paths.webRoot,
                workingDirectory: paths.webRoot,
                logOutput: true,
                deploymentLogDir: options.deploymentLogDir
            });

            if (result.success) {
                logger.completeStep('D365 Module Synchronization', {
                    module,
                    executionTime: result.executionTime
                });
            } else {
                logger.failStep('D365 Module Synchronization', new Error(result.stderr), {
                    module
                });
            }

            return {
                ...result,
                module,
                environmentType
            };

        } catch (error) {
            logger.failStep('D365 Module Synchronization', error);
            throw error;
        }
    }

    /**
     * Prepare module-specific sync command
     * @param {Object} paths - Environment paths
     * @param {string} module - Module name
     * @returns {Promise<string>} - Sync command
     */
    async prepareModuleSyncCommand(paths, module) {
        const command = `
            Import-Module "Microsoft.Dynamics.AX.Framework.Management.psm1" -Force;
            $env:AXDeployToolPath = "${path.join(paths.webRoot, 'bin')}";
            Sync-Database -DatabaseName "AxDB" -Server "." -Module "${module}" -Verbose
        `.trim().replace(/\s+/g, ' ');

        return command;
    }

    /**
     * Check database synchronization status
     * @returns {Promise<Object>} - Sync status information
     */
    async checkSyncStatus() {
        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Prepare status check command
            const statusCommand = `
                Import-Module "Microsoft.Dynamics.AX.Framework.Management.psm1" -Force;
                $env:AXDeployToolPath = "${path.join(paths.webRoot, 'bin')}";
                Get-DatabaseSyncStatus -DatabaseName "AxDB" -Server "." | ConvertTo-Json
            `.trim().replace(/\s+/g, ' ');

            const result = await this.psRunner.execute(statusCommand, {
                timeout: 60000, // 1 minute timeout for status check
                logOutput: false
            });

            if (result.success) {
                try {
                    const statusData = JSON.parse(result.stdout);
                    return {
                        success: true,
                        status: statusData,
                        environmentType,
                        lastChecked: new Date()
                    };
                } catch (parseError) {
                    logger.warn('Failed to parse sync status response', {
                        output: result.stdout,
                        error: parseError.message
                    });
                }
            }

            return {
                success: false,
                environmentType,
                lastChecked: new Date(),
                error: result.stderr
            };

        } catch (error) {
            logger.error('Error checking sync status', { error: error.message });
            return {
                success: false,
                error: error.message,
                lastChecked: new Date()
            };
        }
    }

    /**
     * Validate database synchronization
     * @param {Object} options - Validation options
     * @returns {Promise<Object>} - Validation result
     */
    async validateSync(options = {}) {
        logger.startStep('D365 Sync Validation');

        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Prepare validation command
            const validationCommand = `
                Import-Module "Microsoft.Dynamics.AX.Framework.Management.psm1" -Force;
                $env:AXDeployToolPath = "${path.join(paths.webRoot, 'bin')}";
                Test-DatabaseSynchronization -DatabaseName "AxDB" -Server "." -Verbose | ConvertTo-Json
            `.trim().replace(/\s+/g, ' ');

            const result = await this.psRunner.execute(validationCommand, {
                timeout: options.timeout || this.defaultTimeout,
                logOutput: true,
                deploymentLogDir: options.deploymentLogDir
            });

            if (result.success) {
                try {
                    const validationResult = JSON.parse(result.stdout);

                    logger.completeStep('D365 Sync Validation', {
                        isValid: validationResult.IsValid || true,
                        issues: validationResult.Issues || []
                    });

                    return {
                        success: true,
                        isValid: validationResult.IsValid || true,
                        issues: validationResult.Issues || [],
                        environmentType
                    };
                } catch (parseError) {
                    logger.warn('Failed to parse validation response', {
                        output: result.stdout,
                        error: parseError.message
                    });
                }
            }

            logger.failStep('D365 Sync Validation', new Error(result.stderr));
            return {
                success: false,
                error: result.stderr,
                environmentType
            };

        } catch (error) {
            logger.failStep('D365 Sync Validation', error);
            throw error;
        }
    }

    /**
     * Get database synchronization statistics
     * @returns {Promise<Object>} - Sync statistics
     */
    async getSyncStatistics() {
        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // This would typically query the database for sync statistics
            // For now, return basic information
            return {
                environmentType,
                paths,
                lastSyncTime: await this.getLastSyncTime(),
                databaseSize: await this.getDatabaseSize(),
                tablesCount: await this.getTablesCount()
            };

        } catch (error) {
            logger.error('Error getting sync statistics', { error: error.message });
            return {
                error: error.message,
                environmentType: 'unknown'
            };
        }
    }

    /**
     * Get last sync time (placeholder implementation)
     * @returns {Promise<Date|null>} - Last sync timestamp
     */
    async getLastSyncTime() {
        try {
            // This would typically query the database or logs
            // For now, return current time as placeholder
            return new Date();
        } catch (error) {
            return null;
        }
    }

    /**
     * Get database size (placeholder implementation)
     * @returns {Promise<string>} - Database size as string
     */
    async getDatabaseSize() {
        try {
            // This would typically query the database
            return 'Unknown';
        } catch (error) {
            return 'Unknown';
        }
    }

    /**
     * Get tables count (placeholder implementation)
     * @returns {Promise<number>} - Number of tables
     */
    async getTablesCount() {
        try {
            // This would typically query the database
            return 0;
        } catch (error) {
            return 0;
        }
    }
}

module.exports = D365Sync;