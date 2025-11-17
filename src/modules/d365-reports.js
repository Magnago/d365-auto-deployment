const path = require('path');
const fs = require('fs-extra');
const PowerShellRunner = require('../core/powershell-runner');
const logger = require('../core/logger');

class D365Reports {
    constructor() {
        this.psRunner = new PowerShellRunner();
        this.defaultTimeout = 15 * 60 * 1000; // 15 minutes default timeout
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
     * Validate D365 environment for report deployment
     * @param {Object} paths - Environment paths to validate
     * @returns {Promise<boolean>} - True if environment is valid for reports
     */
    async validateEnvironment(paths) {
        const requiredPaths = [
            paths.packages,
            paths.reportsScriptPath
        ];

        for (const requiredPath of requiredPaths) {
            if (!await fs.pathExists(requiredPath)) {
                logger.error('Required D365 path not found', { path: requiredPath });
                return false;
            }
        }

        // Check if the reports script exists
        const reportsScript = paths.reportsScriptPath;
        if (!await fs.pathExists(reportsScript)) {
            logger.error('Reports deployment script not found', { path: reportsScript });
            return false;
        }

        logger.info('D365 environment validation successful for reports');
        return true;
    }

    /**
     * Deploy all reports to SSRS
     * @param {Object} options - Deployment options
     * @returns {Promise<Object>} - Deployment result
     */
    async deployAllReports(options = {}) {
        const {
            module = process.env.D365_MODULE || 'YourD365Model',
            timeout = parseInt(process.env.REPORTS_TIMEOUT) || this.defaultTimeout,
            deploymentLogDir = null
        } = options;

        logger.startStep('D365 Reports Deployment', { module });

        try {
            // Detect environment
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Validate environment
            if (!await this.validateEnvironment(paths)) {
                throw new Error('D365 environment validation failed for reports deployment');
            }

            // Validate the reports script exists
            const reportsScript = paths.reportsScriptPath;
            if (!await fs.pathExists(reportsScript)) {
                throw new Error(`Reports deployment script not found: ${reportsScript}`);
            }

            // Prepare PowerShell command directly
            const packagesPath = paths.packages;

            // Use the working approach with non-interactive execution
            const psCommand = `& "${reportsScript}" -Module "${module}" -PackageInstallLocation "${packagesPath}"`;

            logger.info('Starting D365 reports deployment', {
                module,
                environmentType,
                scriptPath: reportsScript,
                packagesPath,
                command: psCommand,
                timeout
            });

            // Execute reports deployment script directly
            const result = await this.psRunner.execute(psCommand, {
                timeout,
                cwd: path.dirname(reportsScript),
                workingDirectory: paths.packages,
                logOutput: true,
                deploymentLogDir,
                executionPolicy: 'Bypass',
                nonInteractive: true
            });

            if (result.success) {
                // Parse deployment results
                const deploymentStats = this.parseDeploymentOutput(result.stdout);

                logger.completeStep('D365 Reports Deployment', {
                    module,
                    environmentType,
                    executionTime: result.executionTime,
                    ...deploymentStats
                });

                return {
                    ...result,
                    module,
                    environmentType,
                    deploymentStats
                };
            } else {
                logger.failStep('D365 Reports Deployment', new Error(result.stderr), {
                    module,
                    environmentType,
                    executionTime: result.executionTime
                });

                return {
                    ...result,
                    module,
                    environmentType,
                    deploymentStats: this.parseDeploymentOutput(result.stdout)
                };
            }

        } catch (error) {
            logger.failStep('D365 Reports Deployment', error);
            throw error;
        }
    }

    /**
     * Deploy specific module reports
     * @param {string} module - Module name
     * @param {Object} options - Deployment options
     * @returns {Promise<Object>} - Deployment result
     */
    async deployModuleReports(module, options = {}) {
        return this.deployAllReports({
            ...options,
            module
        });
    }

    /**
     * Parse deployment output to extract statistics
     * @param {string} output - Script output
     * @returns {Object} - Deployment statistics
     */
    parseDeploymentOutput(output) {
        const stats = {
            totalReports: 0,
            deployedReports: 0,
            failedReports: 0,
            skippedReports: 0,
            warnings: 0,
            errors: 0
        };

        const lines = output.split('\n');

        for (const line of lines) {
            const lowerLine = line.toLowerCase();

            // Count deployed reports
            if (lowerLine.includes('deployed') || lowerLine.includes('published')) {
                stats.deployedReports++;
            }

            // Count failed reports
            if (lowerLine.includes('failed') || lowerLine.includes('error')) {
                stats.failedReports++;
                stats.errors++;
            }

            // Count warnings
            if (lowerLine.includes('warning')) {
                stats.warnings++;
            }

            // Count skipped reports
            if (lowerLine.includes('skipped') || lowerLine.includes('already exists')) {
                stats.skippedReports++;
            }

            // Try to extract total count
            const totalMatch = line.match(/(\d+)\s+(reports?|rdl\s+files?)/i);
            if (totalMatch) {
                stats.totalReports = parseInt(totalMatch[1]);
            }
        }

        // Calculate totals if not found
        if (stats.totalReports === 0) {
            stats.totalReports = stats.deployedReports + stats.failedReports + stats.skippedReports;
        }

        return stats;
    }

    /**
     * Check reports deployment status
     * @param {string} module - Module name (optional)
     * @returns {Promise<Object>} - Deployment status
     */
    async checkDeploymentStatus(module = null) {
        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Prepare status check command
            const statusCommand = await this.prepareStatusCheckCommand(paths, module);

            const result = await this.psRunner.execute(statusCommand, {
                timeout: 60000, // 1 minute timeout for status check
                logOutput: false
            });

            if (result.success) {
                const statusData = this.parseStatusOutput(result.stdout);

                return {
                    success: true,
                    status: statusData,
                    environmentType,
                    module,
                    lastChecked: new Date()
                };
            }

            return {
                success: false,
                environmentType,
                module,
                lastChecked: new Date(),
                error: result.stderr
            };

        } catch (error) {
            logger.error('Error checking reports deployment status', { error: error.message });
            return {
                success: false,
                error: error.message,
                lastChecked: new Date(),
                module
            };
        }
    }

    /**
     * Prepare status check command
     * @param {Object} paths - Environment paths
     * @param {string} module - Module name (optional)
     * @returns {Promise<string>} - Status check command
     */
    async prepareStatusCheckCommand(paths, module) {
        let command = `
            try {
                Add-PSSnapin Microsoft.Dynamics.AX.Framework.Management -ErrorAction SilentlyContinue;
                Import-Module "Microsoft.Dynamics.AX.Framework.Management.psm1" -ErrorAction SilentlyContinue;

                $reports = Get-AXReport -PackageInstallLocation "${paths.packagesPath}"`;

        if (module) {
            command += ` -Module "${module}"`;
        }

        command += `
                $status = @{
                    TotalReports = $reports.Count;
                    DeployedReports = ($reports | Where-Object { $_.IsDeployed -eq $true }).Count;
                    LastDeployment = ($reports | Measure-Object -Property LastDeploymentTime -Maximum).Maximum;
                }
                $status | ConvertTo-Json -Compress
            }
            catch {
                @{ Error = $_.Exception.Message; Success = $false } | ConvertTo-Json -Compress
            }
        `.trim().replace(/\s+/g, ' ');

        return command;
    }

    /**
     * Parse status output
     * @param {string} output - Status command output
     * @returns {Object} - Parsed status data
     */
    parseStatusOutput(output) {
        try {
            return JSON.parse(output);
        } catch (error) {
            // Fallback parsing
            const status = {
                TotalReports: 0,
                DeployedReports: 0,
                LastDeployment: null,
                Error: null
            };

            const lines = output.split('\n');
            for (const line of lines) {
                if (line.includes('TotalReports')) {
                    const match = line.match(/(\d+)/);
                    if (match) status.TotalReports = parseInt(match[1]);
                }
                if (line.includes('DeployedReports')) {
                    const match = line.match(/(\d+)/);
                    if (match) status.DeployedReports = parseInt(match[1]);
                }
            }

            return status;
        }
    }

    /**
     * Get reports deployment statistics
     * @param {string} module - Module name (optional)
     * @returns {Promise<Object>} - Deployment statistics
     */
    async getDeploymentStatistics(module = null) {
        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Check for existing reports directory
            const reportsDir = path.join(paths.packagesPath, 'Reports');
            let reportFiles = [];

            if (await fs.pathExists(reportsDir)) {
                const files = await fs.readdir(reportsDir);
                reportFiles = files.filter(file => file.toLowerCase().endsWith('.rdl'));
            }

            // Get deployment status
            const deploymentStatus = await this.checkDeploymentStatus(module);

            return {
                environmentType,
                module,
                reportFilesCount: reportFiles.length,
                reportFiles,
                deploymentStatus,
                lastChecked: new Date()
            };

        } catch (error) {
            logger.error('Error getting deployment statistics', { error: error.message });
            return {
                error: error.message,
                environmentType: 'unknown',
                module
            };
        }
    }

    /**
     * Validate reports deployment
     * @param {string} module - Module name (optional)
     * @param {Object} options - Validation options
     * @returns {Promise<Object>} - Validation result
     */
    async validateDeployment(module = null, options = {}) {
        logger.startStep('D365 Reports Validation', { module });

        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Prepare validation command
            const validationCommand = await this.prepareValidationCommand(paths, module);

            const result = await this.psRunner.execute(validationCommand, {
                timeout: options.timeout || this.defaultTimeout,
                logOutput: true,
                deploymentLogDir: options.deploymentLogDir
            });

            if (result.success) {
                const validationResult = this.parseValidationOutput(result.stdout);

                logger.completeStep('D365 Reports Validation', {
                    module,
                    isValid: validationResult.IsValid || true,
                    issues: validationResult.Issues || []
                });

                return {
                    success: true,
                    isValid: validationResult.IsValid || true,
                    issues: validationResult.Issues || [],
                    environmentType,
                    module
                };
            }

            logger.failStep('D365 Reports Validation', new Error(result.stderr));
            return {
                success: false,
                error: result.stderr,
                environmentType,
                module
            };

        } catch (error) {
            logger.failStep('D365 Reports Validation', error);
            throw error;
        }
    }

    /**
     * Prepare validation command
     * @param {Object} paths - Environment paths
     * @param {string} module - Module name (optional)
     * @returns {Promise<string>} - Validation command
     */
    async prepareValidationCommand(paths, module) {
        let command = `
            try {
                Add-PSSnapin Microsoft.Dynamics.AX.Framework.Management -ErrorAction SilentlyContinue;
                Import-Module "Microsoft.Dynamics.AX.Framework.Management.psm1" -ErrorAction SilentlyContinue;

                $reports = Get-AXReport -PackageInstallLocation "${paths.packagesPath}"`;

        if (module) {
            command += ` -Module "${module}"`;
        }

        command += `
                $issues = @()
                foreach ($report in $reports) {
                    if (-not $report.IsDeployed) {
                        $issues += "Report '$($report.Name)' is not deployed"
                    }
                    if (-not $report.IsValid) {
                        $issues += "Report '$($report.Name)' has validation errors"
                    }
                }

                @{
                    IsValid = ($issues.Count -eq 0);
                    Issues = $issues;
                    TotalReports = $reports.Count;
                    DeployedReports = ($reports | Where-Object { $_.IsDeployed -eq $true }).Count
                } | ConvertTo-Json -Compress
            }
            catch {
                @{ Error = $_.Exception.Message; IsValid = $false } | ConvertTo-Json -Compress
            }
        `.trim().replace(/\s+/g, ' ');

        return command;
    }

    /**
     * Parse validation output
     * @param {string} output - Validation command output
     * @returns {Object} - Parsed validation data
     */
    parseValidationOutput(output) {
        try {
            return JSON.parse(output);
        } catch (error) {
            return {
                IsValid: false,
                Issues: [output],
                Error: 'Failed to parse validation output'
            };
        }
    }

    /**
     * Clean up deployed reports (for testing/maintenance)
     * @param {string} module - Module name (optional)
     * @param {Object} options - Cleanup options
     * @returns {Promise<Object>} - Cleanup result
     */
    async cleanupDeployedReports(module = null, options = {}) {
        logger.startStep('D365 Reports Cleanup', { module });

        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Prepare cleanup command
            const cleanupCommand = await this.prepareCleanupCommand(paths, module);

            const result = await this.psRunner.execute(cleanupCommand, {
                timeout: options.timeout || this.defaultTimeout,
                logOutput: true,
                deploymentLogDir: options.deploymentLogDir
            });

            if (result.success) {
                const cleanupStats = this.parseCleanupOutput(result.stdout);

                logger.completeStep('D365 Reports Cleanup', {
                    module,
                    ...cleanupStats
                });

                return {
                    ...result,
                    module,
                    cleanupStats
                };
            }

            logger.failStep('D365 Reports Cleanup', new Error(result.stderr));
            return result;

        } catch (error) {
            logger.failStep('D365 Reports Cleanup', error);
            throw error;
        }
    }

    /**
     * Prepare cleanup command
     * @param {Object} paths - Environment paths
     * @param {string} module - Module name (optional)
     * @returns {Promise<string>} - Cleanup command
     */
    async prepareCleanupCommand(paths, module) {
        let command = `
            try {
                Add-PSSnapin Microsoft.Dynamics.AX.Framework.Management -ErrorAction SilentlyContinue;
                Import-Module "Microsoft.Dynamics.AX.Framework.Management.psm1" -ErrorAction SilentlyContinue;

                $reports = Get-AXReport -PackageInstallLocation "${paths.packagesPath}"`;

        if (module) {
            command += ` -Module "${module}"`;
        }

        command += `
                $removed = 0
                foreach ($report in $reports) {
                    if ($report.IsDeployed) {
                        Remove-AXReport -Name $report.Name -Force
                        $removed++
                    }
                }

                @{ RemovedReports = $removed; Success = $true } | ConvertTo-Json -Compress
            }
            catch {
                @{ Error = $_.Exception.Message; Success = $false; RemovedReports = 0 } | ConvertTo-Json -Compress
            }
        `.trim().replace(/\s+/g, ' ');

        return command;
    }

    /**
     * Parse cleanup output
     * @param {string} output - Cleanup command output
     * @returns {Object} - Parsed cleanup data
     */
    parseCleanupOutput(output) {
        try {
            return JSON.parse(output);
        } catch (error) {
            return {
                RemovedReports: 0,
                Success: false,
                Error: 'Failed to parse cleanup output'
            };
        }
    }
}

module.exports = D365Reports;


