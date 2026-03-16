const path = require('path');
const fs = require('fs-extra');
const D365Environment = require('../core/d365-environment');
const PowerShellRunner = require('../core/powershell-runner');
const logger = require('../core/logger');

class D365Build {
    constructor() {
        this.environment = new D365Environment();
        this.psRunner = new PowerShellRunner();
        this.defaultTimeout = 60 * 60 * 1000;
    }

    async buildModel(model, options = {}) {
        const timeout = Number(process.env.BUILD_TIMEOUT) || options.timeout || this.defaultTimeout;
        const deploymentLogDir = options.deploymentLogDir || null;

        logger.startStep('D365 Full Build', { model });

        try {
            const environmentType = await this.environment.detect();
            const paths = this.environment.getPaths(environmentType);
            await this.validateEnvironment(paths, model);

            const command = this.prepareBuildCommand(paths, model);
            logger.info('Starting D365 build', {
                environmentType,
                model,
                packagesPath: paths.packages,
                binPath: paths.binPath,
                timeout
            });

            const result = await this.psRunner.execute(command, {
                timeout,
                cwd: paths.binPath,
                logOutput: true,
                deploymentLogDir
            });

            logger.completeStep('D365 Full Build', {
                model,
                environmentType,
                executionTime: result.executionTime
            });

            return {
                ...result,
                model,
                environmentType,
                paths
            };
        } catch (error) {
            logger.failStep('D365 Full Build', error, { model });
            throw error;
        }
    }

    async validateEnvironment(paths, model) {
        const requiredPaths = [
            paths.packages,
            paths.binPath,
            path.join(paths.binPath, 'xppc.exe'),
            path.join(paths.packages, model),
            path.join(paths.packages, model, 'Descriptor', `${model}.xml`)
        ];

        for (const requiredPath of requiredPaths) {
            if (!await fs.pathExists(requiredPath)) {
                throw new Error(`Build prerequisite not found: ${requiredPath}`);
            }
        }
    }

    prepareBuildCommand(paths, model) {
        const xppcPath = path.join(paths.binPath, 'xppc.exe');
        const metadataPath = paths.packages;
        const modulePath = path.join(paths.packages, model);
        const moduleBinPath = path.join(modulePath, 'bin');
        const buildLogPath = path.join(modulePath, `${model}.BuildModelResult.log`);
        const buildXmlLogPath = path.join(modulePath, `${model}.BuildModelResult.xml`);

        return [
            `& "${xppcPath}"`,
            `-metadata="${metadataPath}"`,
            `-compilermetadata="${metadataPath}"`,
            '-xref',
            `-appBase="${paths.binPath}"`,
            `-modelmodule="${model}"`,
            `-referenceFolder="${metadataPath}"`,
            `-refPath="${moduleBinPath}"`,
            `-output="${moduleBinPath}"`,
            `-log="${buildLogPath}"`,
            `-xmllog="${buildXmlLogPath}"`,
            '-verbose'
        ].join(' ');
    }
}

module.exports = D365Build;
