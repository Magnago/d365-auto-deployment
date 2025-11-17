const path = require('path');
const fs = require('fs-extra');
const PowerShellRunner = require('../core/powershell-runner');
const logger = require('../core/logger');

class D365Build {
    constructor() {
        this.psRunner = new PowerShellRunner();
        this.defaultTimeout = 60 * 60 * 1000; // 1 hour default timeout
    }

    /**
     * Detect the current D365 environment type (local or cloud)
     * @returns {Promise<string>} - Environment type ('local' or 'cloud')
     */
    async detectEnvironment() {
        const environments = require('../../config/environments.json');
        const manualOverride = process.env.ENVIRONMENT_TYPE;

        // If manual override is specified, use it
        if (manualOverride && manualOverride !== 'auto') {
            logger.info(`Using manual environment override: ${manualOverride}`);
            return manualOverride;
        }

        logger.debug('Auto-detecting D365 environment...');

        // Check if cloud paths exist (K: drive - LCS environments)
        const cloudPackagesPath = environments.cloud.packages;
        const cloudBinPath = path.join(cloudPackagesPath, 'bin');

        logger.debug('Checking cloud paths', {
            packagesPath: cloudPackagesPath,
            binPath: cloudBinPath
        });

        if (await fs.pathExists(cloudPackagesPath) && await fs.pathExists(cloudBinPath)) {
            logger.info('🌩️ Detected cloud environment (K: drive)', {
                packagesPath: cloudPackagesPath,
                binPath: cloudBinPath
            });
            return 'cloud';
        }

        // Check if local paths exist (C: drive - local dev environments)
        const localPackagesPath = environments.local.packages;
        const localBinPath = path.join(localPackagesPath, 'bin');

        logger.debug('Checking local paths', {
            packagesPath: localPackagesPath,
            binPath: localBinPath
        });

        if (await fs.pathExists(localPackagesPath) && await fs.pathExists(localBinPath)) {
            logger.info('💻 Detected local environment (C: drive)', {
                packagesPath: localPackagesPath,
                binPath: localBinPath
            });
            return 'local';
        }

        // Additional check for cloud environments - try common cloud variations
        const cloudVariations = [
            'K:\\AosService\\PackagesLocalDirectory',
            'K:\\AosService\\Packages',
            'K:\\PackagesLocalDirectory'
        ];

        for (const cloudPath of cloudVariations) {
            const cloudBinPath = path.join(cloudPath, 'bin');
            if (await fs.pathExists(cloudPath) && await fs.pathExists(cloudBinPath)) {
                logger.info('🌩️ Detected cloud environment (K: drive - alternative path)', {
                    packagesPath: cloudPath,
                    binPath: cloudBinPath
                });

                // Update the paths in the environments configuration dynamically
                environments.cloud.packages = cloudPath;
                environments.cloud.binPath = cloudBinPath;
                return 'cloud';
            }
        }

        // If neither environment is detected, check environment variable
        const computerName = process.env.COMPUTERNAME || '';
        if (computerName.toLowerCase().includes('cloud') ||
            computerName.toLowerCase().includes('lcs') ||
            computerName.toLowerCase().includes('azure')) {
            logger.warn('🌩️ Environment suggests cloud but K: drive not found, defaulting to cloud paths', {
                computerName
            });
            return 'cloud';
        }

        // Default to local with warning
        logger.warn('⚠️ Could not detect D365 environment automatically, defaulting to local', {
            checkedPaths: [
                cloudPackagesPath,
                localPackagesPath,
                ...cloudVariations
            ]
        });

        logger.info('💻 Using local environment as default');
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
     * Validate D365 environment paths
     * @param {Object} paths - Environment paths to validate
     * @returns {Promise<boolean>} - True if all paths are valid
     */
    async validateEnvironment(paths) {
        const requiredPaths = [
            paths.packages,
            path.join(paths.packages, 'bin'),
            paths.binPath
        ];

        for (const requiredPath of requiredPaths) {
            if (!await fs.pathExists(requiredPath)) {
                logger.error('Required D365 path not found', { path: requiredPath });
                return false;
            }
        }

        // Check for xppc.exe
        const xppcPath = path.join(paths.binPath, 'xppc.exe');
        if (!await fs.pathExists(xppcPath)) {
            logger.error('xppc.exe not found', { path: xppcPath });
            return false;
        }

        logger.info('D365 environment validation successful');
        return true;
    }

    /**
     * Perform full D365 build
     * @param {Object} options - Build options
     * @returns {Promise<Object>} - Build result
     */
    async performFullBuild(options = {}) {
        const {
            model = process.env.D365_MODEL,
            timeout = parseInt(process.env.BUILD_TIMEOUT) || this.defaultTimeout,
            deploymentLogDir = null
        } = options;

        logger.startStep('D365 Full Build', { model });

        try {
            // Detect environment
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Validate environment
            if (!await this.validateEnvironment(paths)) {
                throw new Error('D365 environment validation failed');
            }

            // Prepare build command
            const buildCommand = this.prepareBuildCommand(paths, model);

            logger.info('Starting D365 build', {
                model,
                environmentType,
                command: buildCommand,
                timeout
            });

            // Execute build
            const result = await this.psRunner.execute(buildCommand, {
                timeout,
                cwd: paths.binPath,
                workingDirectory: paths.binPath,
                logOutput: true,
                deploymentLogDir
            });

            if (result.success) {
                logger.completeStep('D365 Full Build', {
                    model,
                    executionTime: result.executionTime,
                    output: result.stdout
                });
            } else {
                logger.failStep('D365 Full Build', new Error(result.stderr), {
                    model,
                    executionTime: result.executionTime
                });
            }

            return {
                ...result,
                model,
                environmentType,
                paths
            };

        } catch (error) {
            logger.failStep('D365 Full Build', error);
            throw error;
        }
    }

    /**
     * Prepare build command for execution
     * @param {Object} paths - Environment paths
     * @param {string} model - D365 model to build
     * @returns {string} - Build command
     */
    prepareBuildCommand(paths, model) {
        const xppcPath = path.join(paths.binPath, 'xppc.exe');

        // Build the command string using proper D365 FO parameters
        const metadataPath = paths.packages;
        const compilerMetadataPath = paths.packages;
        const outputPath = path.join(paths.packages, 'bin');
        const appBasePath = paths.binPath;
        const moduleBinPath = path.join(paths.packages, model, 'bin');

        // Build log file path
        const logFilePath = path.join(paths.packages, model, `${model}.BuildModelResult.log`);
        const xmlLogFilePath = path.join(paths.packages, model, `${model}.BuildModelResult.xml`);

        const command = `& "${xppcPath}" -metadata="${metadataPath}" -compilermetadata="${compilerMetadataPath}" -xref -appBase="${appBasePath}" -modelmodule="${model}" -referenceFolder="${metadataPath}" -refPath="${moduleBinPath}" -output="${moduleBinPath}" -log="${logFilePath}" -xmllog="${xmlLogFilePath}" -verbose`;

        logger.debug('Prepared build command', { command });
        return command;
    }

    /**
     * Build specific model
     * @param {string} model - Model name to build
     * @param {Object} options - Build options
     * @returns {Promise<Object>} - Build result
     */
    async buildModel(model, options = {}) {
        return this.performFullBuild({
            ...options,
            model
        });
    }

    /**
     * Perform incremental build
     * @param {Object} options - Build options
     * @returns {Promise<Object>} - Build result
     */
    async performIncrementalBuild(options = {}) {
        const {
            model = process.env.D365_MODEL,
            timeout = parseInt(process.env.BUILD_TIMEOUT) || this.defaultTimeout,
            deploymentLogDir = null
        } = options;

        logger.startStep('D365 Incremental Build', { model });

        try {
            // Detect environment
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Validate environment
            if (!await this.validateEnvironment(paths)) {
                throw new Error('D365 environment validation failed');
            }

            // Prepare incremental build command
            const buildCommand = this.prepareIncrementalBuildCommand(paths, model);

            logger.info('Starting D365 incremental build', {
                model,
                environmentType,
                command: buildCommand
            });

            // Execute build
            const result = await this.psRunner.execute(buildCommand, {
                timeout,
                cwd: paths.binPath,
                workingDirectory: paths.binPath,
                logOutput: true,
                deploymentLogDir
            });

            if (result.success) {
                logger.completeStep('D365 Incremental Build', {
                    model,
                    executionTime: result.executionTime
                });
            } else {
                logger.failStep('D365 Incremental Build', new Error(result.stderr));
            }

            return {
                ...result,
                model,
                environmentType,
                buildType: 'incremental'
            };

        } catch (error) {
            logger.failStep('D365 Incremental Build', error);
            throw error;
        }
    }

    /**
     * Prepare incremental build command
     * @param {Object} paths - Environment paths
     * @param {string} model - D365 model to build
     * @returns {string} - Build command
     */
    prepareIncrementalBuildCommand(paths, model) {
        const xppcPath = path.join(paths.binPath, 'xppc.exe');

        // Incremental build command (different from full build)
        const metadataPath = paths.packages;
        const compilerMetadataPath = paths.packages;
        const appBasePath = paths.binPath;
        const moduleBinPath = path.join(paths.packages, model, 'bin');

        // Build log file path for incremental build
        const logFilePath = path.join(paths.packages, model, `${model}.IncrementalBuildModelResult.log`);
        const xmlLogFilePath = path.join(paths.packages, model, `${model}.IncrementalBuildModelResult.xml`);

        const command = `& "${xppcPath}" -metadata="${metadataPath}" -compilermetadata="${compilerMetadataPath}" -appBase="${appBasePath}" -modelmodule="${model}" -referenceFolder="${metadataPath}" -refPath="${moduleBinPath}" -output="${moduleBinPath}" -log="${logFilePath}" -xmllog="${xmlLogFilePath}" -incremental -verbose`;

        logger.debug('Prepared incremental build command', { command });
        return command;
    }

    /**
     * Check build status
     * @returns {Promise<Object>} - Build status information
     */
    async checkBuildStatus() {
        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Check for lock files or other build indicators
            const buildLockPath = path.join(paths.packages, '.buildlock');
            const isBuilding = await fs.pathExists(buildLockPath);

            return {
                isBuilding,
                environmentType,
                paths,
                lastBuildTime: await this.getLastBuildTime(paths)
            };

        } catch (error) {
            logger.error('Error checking build status', { error: error.message });
            return {
                isBuilding: false,
                error: error.message
            };
        }
    }

    /**
     * Get last build time
     * @param {Object} paths - Environment paths
     * @returns {Promise<Date|null>} - Last build timestamp
     */
    async getLastBuildTime(paths) {
        try {
            // Check various indicators of last build
            const binDir = path.join(paths.packages, 'bin');
            const stats = await fs.stat(binDir);
            return stats.mtime;
        } catch (error) {
            return null;
        }
    }

    /**
     * Clean build artifacts
     * @param {Object} options - Clean options
     * @returns {Promise<Object>} - Clean result
     */
    async cleanBuildArtifacts(options = {}) {
        const {
            model = process.env.D365_MODEL,
            deploymentLogDir = null
        } = options;

        logger.startStep('Clean Build Artifacts', { model });

        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            // Common build artifact directories to clean
            const artifactPaths = [
                path.join(paths.packages, 'bin', 'XppIL'),
                path.join(paths.packages, 'bin', 'Symbols'),
                path.join(paths.packages, 'bin', 'Resources'),
                path.join(paths.packages, 'bin', 'DeployablePackage')
            ];

            let cleanedPaths = 0;

            for (const artifactPath of artifactPaths) {
                if (await fs.pathExists(artifactPath)) {
                    try {
                        await fs.emptyDir(artifactPath);
                        cleanedPaths++;
                        logger.debug('Cleaned build artifact directory', { path: artifactPath });
                    } catch (error) {
                        logger.warn('Failed to clean artifact directory', {
                            path: artifactPath,
                            error: error.message
                        });
                    }
                }
            }

            logger.completeStep('Clean Build Artifacts', {
                model,
                cleanedPaths
            });

            return {
                success: true,
                cleanedPaths,
                model
            };

        } catch (error) {
            logger.failStep('Clean Build Artifacts', error);
            throw error;
        }
    }

    /**
     * Get build statistics
     * @param {Object} options - Options
     * @returns {Promise<Object>} - Build statistics
     */
    async getBuildStatistics(options = {}) {
        try {
            const environmentType = await this.detectEnvironment();
            const paths = this.getEnvironmentPaths(environmentType);

            const binDir = path.join(paths.packages, 'bin');

            // Count various build artifacts
            const stats = {
                dlls: 0,
                pdbs: 0,
                totalFiles: 0,
                binSize: 0
            };

            if (await fs.pathExists(binDir)) {
                const files = await fs.readdir(binDir);
                stats.totalFiles = files.length;

                for (const file of files) {
                    const filePath = path.join(binDir, file);
                    const fileStat = await fs.stat(filePath);

                    stats.binSize += fileStat.size;

                    if (file.endsWith('.dll')) stats.dlls++;
                    if (file.endsWith('.pdb')) stats.pdbs++;
                }
            }

            return {
                ...stats,
                environmentType,
                paths,
                lastModified: await this.getLastBuildTime(paths)
            };

        } catch (error) {
            logger.error('Error getting build statistics', { error: error.message });
            throw error;
        }
    }
}

module.exports = D365Build;