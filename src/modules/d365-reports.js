const path = require('path');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { promisify } = require('util');
const D365Environment = require('../core/d365-environment');
const PowerShellRunner = require('../core/powershell-runner');
const logger = require('../core/logger');

const execFileAsync = promisify(execFile);

class D365Reports {
    constructor() {
        this.environment = new D365Environment();
        this.psRunner = new PowerShellRunner();
        this.defaultTimeout = 15 * 60 * 1000;
    }

    async deployAllReports(options = {}) {
        const moduleName = options.module || process.env.D365_MODEL || 'YourD365Model';
        const timeout = Number(process.env.REPORTS_TIMEOUT) || options.timeout || this.defaultTimeout;
        const deploymentLogDir = options.deploymentLogDir || null;

        logger.startStep('D365 Reports Deployment', { module: moduleName });

        try {
            const environmentType = await this.environment.detect();
            const paths = this.environment.getPaths(environmentType);
            await this.validateEnvironment(paths, moduleName);
            await this.ensureDeploymentRegistry(paths);

            const command = `& "${paths.reportsScriptPath}" -Module "${moduleName}" -PackageInstallLocation "${paths.packages}"`;
            logger.info('Starting D365 reports deployment', {
                environmentType,
                module: moduleName,
                packagesPath: paths.packages,
                scriptPath: paths.reportsScriptPath,
                timeout
            });

            const result = await this.psRunner.execute(command, {
                timeout,
                cwd: path.dirname(paths.reportsScriptPath),
                logOutput: true,
                deploymentLogDir,
                executionPolicy: 'Bypass',
                nonInteractive: true
            });

            const deploymentStats = this.parseDeploymentOutput(result.stdout);
            logger.completeStep('D365 Reports Deployment', {
                module: moduleName,
                environmentType,
                executionTime: result.executionTime,
                ...deploymentStats
            });

            return {
                ...result,
                module: moduleName,
                environmentType,
                deploymentStats
            };
        } catch (error) {
            logger.failStep('D365 Reports Deployment', error, { module: moduleName });
            throw error;
        }
    }

    async validateEnvironment(paths, moduleName) {
        const requiredPaths = [
            paths.packages,
            paths.reportsScriptPath,
            path.join(paths.packages, moduleName)
        ];

        for (const requiredPath of requiredPaths) {
            if (!await fs.pathExists(requiredPath)) {
                throw new Error(`Reports deployment prerequisite not found: ${requiredPath}`);
            }
        }
    }

    async ensureDeploymentRegistry(paths) {
        const registryViews = ['64', '32'];
        const registryPath = 'HKLM\\SOFTWARE\\Microsoft\\Dynamics\\Deployment';

        for (const view of registryViews) {
            await this.updateRegistryValue(registryPath, view, 'BinDir', paths.packages);
            await this.updateRegistryValue(registryPath, view, 'InstallDir', paths.packages);
        }
    }

    async updateRegistryValue(registryPath, view, valueName, valueData) {
        const args = [
            'ADD',
            registryPath,
            '/v', valueName,
            '/t', 'REG_SZ',
            '/d', valueData,
            '/f',
            `/reg:${view}`
        ];

        try {
            await execFileAsync('reg.exe', args, { windowsHide: true });
        } catch (error) {
            const stderr = error?.stderr ? error.stderr.toString().trim() : '';
            throw new Error(`Failed to set ${valueName} in registry (${view}-bit): ${stderr || error.message}`);
        }
    }

    parseDeploymentOutput(output = '') {
        const stats = {
            totalReports: 0,
            deployedReports: 0,
            failedReports: 0,
            skippedReports: 0,
            warnings: 0,
            errors: 0
        };

        for (const line of output.split(/\r?\n/)) {
            const normalized = line.toLowerCase();
            if (normalized.includes('deployed') || normalized.includes('published')) {
                stats.deployedReports += 1;
            }
            if (normalized.includes('failed') || normalized.includes('error')) {
                stats.failedReports += 1;
                stats.errors += 1;
            }
            if (normalized.includes('warning')) {
                stats.warnings += 1;
            }
            if (normalized.includes('skipped') || normalized.includes('already exists')) {
                stats.skippedReports += 1;
            }

            const totalMatch = line.match(/(\d+)\s+(reports?|rdl\s+files?)/i);
            if (totalMatch) {
                stats.totalReports = parseInt(totalMatch[1], 10);
            }
        }

        if (stats.totalReports === 0) {
            stats.totalReports = stats.deployedReports + stats.failedReports + stats.skippedReports;
        }

        return stats;
    }
}

module.exports = D365Reports;
