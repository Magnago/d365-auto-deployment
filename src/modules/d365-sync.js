const path = require('path');
const fs = require('fs-extra');
const D365Environment = require('../core/d365-environment');
const PowerShellRunner = require('../core/powershell-runner');
const logger = require('../core/logger');

class D365Sync {
    constructor() {
        this.environment = new D365Environment();
        this.psRunner = new PowerShellRunner();
        this.defaultTimeout = 30 * 60 * 1000;
    }

    async performFullSync(options = {}) {
        const timeout = Number(process.env.SYNC_TIMEOUT) || options.timeout || this.defaultTimeout;
        const deploymentLogDir = options.deploymentLogDir || null;

        logger.startStep('D365 Database Synchronization');

        try {
            const environmentType = await this.environment.detect();
            const paths = this.environment.getPaths(environmentType);
            await this.validateEnvironment(paths);

            const command = this.prepareSyncCommand(paths);
            logger.info('Starting D365 database synchronization', {
                environmentType,
                packagesPath: paths.packages,
                binPath: paths.binPath,
                timeout
            });

            const result = await this.psRunner.execute(command, {
                timeout,
                cwd: paths.webRoot,
                logOutput: true,
                deploymentLogDir
            });

            logger.completeStep('D365 Database Synchronization', {
                environmentType,
                executionTime: result.executionTime
            });

            return {
                ...result,
                syncMode: 'full',
                environmentType
            };
        } catch (error) {
            logger.failStep('D365 Database Synchronization', error);
            throw error;
        }
    }

    async validateEnvironment(paths) {
        const requiredPaths = [
            paths.packages,
            paths.webRoot,
            paths.binPath,
            path.join(paths.binPath, 'SyncEngine.exe')
        ];

        for (const requiredPath of requiredPaths) {
            if (!await fs.pathExists(requiredPath)) {
                throw new Error(`Database sync prerequisite not found: ${requiredPath}`);
            }
        }
    }

    prepareSyncCommand(paths) {
        const syncEnginePath = path.join(paths.binPath, 'SyncEngine.exe');
        const computerName = process.env.COMPUTERNAME || 'localhost';
        const connectionString = `Data Source=${computerName};Initial Catalog=AxDB;Integrated Security=True;Enlist=True;Application Name=SyncEngine`;

        return [
            `& "${syncEnginePath}"`,
            '-syncmode=fullall',
            `-metadatabinaries="${paths.packages}"`,
            `-connect="${connectionString}"`,
            '-fallbacktonative=False'
        ].join(' ');
    }
}

module.exports = D365Sync;
