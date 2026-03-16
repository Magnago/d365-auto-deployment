require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const TFVCMerge = require('./scripts/tfvc-merge');
const BuildOnly = require('./scripts/build-only');
const SyncOnly = require('./scripts/sync-only');
const ReportsOnly = require('./scripts/reports-only');
const NotificationService = require('./core/notification-service');
const logger = require('./core/logger');

const execAsync = promisify(exec);

class DeploymentPipeline {
    constructor() {
        this.deploymentId = this.generateDeploymentId();
        this.notifications = new NotificationService();
        this.tfvc = new TFVCMerge();
        this.build = new BuildOnly();
        this.sync = new SyncOnly();
        this.reports = new ReportsOnly();

        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';

        this.enableTfvcStep = this.getEnvFlag('ENABLE_TFVC_STEP', true);
        this.enableBuildStep = this.getEnvFlag('ENABLE_BUILD_STEP', true);
        this.enableSyncStep = this.getEnvFlag('ENABLE_SYNC_STEP', true);
        this.enableReportsStep = this.getEnvFlag('ENABLE_REPORTS_STEP', true);
        this.skipTfvcMergeOperations = this.getEnvFlag('SKIP_TFVC_MERGE_OPERATIONS', false);
        this.enableServiceControl = this.getEnvFlag('ENABLE_SERVICE_CONTROL', true);

        this.serviceStopCommands = this.getServiceCommands('SERVICE_STOP_COMMANDS', [
            'net stop W3SVC',
            'net stop SQLServerReportingServices',
            'net stop DynamicsAxBatch',
            'net stop Microsoft.Dynamics.AX.Framework.Tools.DMF.SSISHelperService.exe',
            'net stop MR2012ProcessService'
        ]);
        this.serviceStartCommands = this.getServiceCommands('SERVICE_START_COMMANDS', [
            'net start W3SVC',
            'net start SQLServerReportingServices',
            'net start DynamicsAxBatch',
            'net start Microsoft.Dynamics.AX.Framework.Tools.DMF.SSISHelperService.exe',
            'net start MR2012ProcessService',
            'iisreset /start'
        ]);
        this.serviceCommandTimeout = this.getNumericEnv('SERVICE_COMMAND_TIMEOUT_MS', 5 * 60 * 1000);

        this.currentStep = null;
        this.startTime = null;
        this.logDirectory = null;
        this.serviceStartRecorded = false;
    }

    async execute() {
        const originalSuppression = process.env.SUPPRESS_STEP_NOTIFICATIONS;
        const steps = [];
        this.startTime = Date.now();
        this.serviceStartRecorded = false;
        process.env.SUPPRESS_STEP_NOTIFICATIONS = 'true';

        try {
            await this.initialize();
            await this.notifications.sendNotification('start', {
                deploymentId: this.deploymentId,
                model: this.modelName,
                sourceBranch: this.sourceBranch,
                targetBranch: this.targetBranch
            });

            steps.push(await this.executeServiceStopStep());

            // TFVC merge with hasChanges detection
            if (this.enableTfvcStep) {
                const mergeResult = await this.executeStep('TFVC / Branch Operation', () => this.tfvc.execute());
                steps.push(mergeResult);
                if (!mergeResult.success) {
                    throw new Error(mergeResult.message);
                }

                const hasChanges = Boolean(mergeResult.details?.hasChanges);
                if (!hasChanges && !this.skipTfvcMergeOperations) {
                    logger.info('No changes detected after merge, stopping pipeline');
                    steps.push(await this.executeServiceStartStep(true));

                    const results = this.buildResults(steps);
                    results.hasChanges = false;
                    results.message = 'Pipeline completed - no changes to merge';

                    await this.notifications.sendNotification('success', {
                        deploymentId: this.deploymentId,
                        model: this.modelName,
                        sourceBranch: this.sourceBranch,
                        targetBranch: this.targetBranch,
                        executionTime: results.totalDuration
                    });

                    return results;
                }
            } else {
                steps.push(this.createSkippedStep('TFVC / Branch Operation', 'ENABLE_TFVC_STEP=false'));
            }

            steps.push(await this.executeConfiguredStep('Full Build', this.enableBuildStep, () => this.build.execute(), 'ENABLE_BUILD_STEP=false'));
            steps.push(await this.executeConfiguredStep('Database Synchronization', this.enableSyncStep, () => this.sync.execute(), 'ENABLE_SYNC_STEP=false'));
            steps.push(await this.executeConfiguredStep('Deploy All Reports', this.enableReportsStep, () => this.reports.execute(), 'ENABLE_REPORTS_STEP=false'));
            steps.push(await this.executeServiceStartStep(true));

            const results = this.buildResults(steps);
            await this.notifications.sendNotification('success', {
                deploymentId: this.deploymentId,
                model: this.modelName,
                sourceBranch: this.sourceBranch,
                targetBranch: this.targetBranch,
                executionTime: results.totalDuration
            });

            logger.info('Deployment completed successfully', {
                deploymentId: this.deploymentId,
                totalDuration: results.totalDuration,
                logDirectory: this.logDirectory
            });

            return results;
        } catch (error) {
            const failedStep = this.currentStep;

            try {
                const startStep = await this.executeServiceStartStep(false);
                if (startStep) {
                    steps.push(startStep);
                }
            } catch (serviceError) {
                logger.error('Failed to restart services after pipeline failure', {
                    deploymentId: this.deploymentId,
                    error: serviceError.message
                });
            }

            await this.notifications.sendNotification('failure', {
                deploymentId: this.deploymentId,
                model: this.modelName,
                sourceBranch: this.sourceBranch,
                targetBranch: this.targetBranch,
                failedStep,
                error: error.message,
                executionTime: Date.now() - this.startTime
            });

            logger.error('Deployment pipeline failed', {
                deploymentId: this.deploymentId,
                failedStep,
                error: error.message,
                stack: error.stack
            });

            throw error;
        } finally {
            if (originalSuppression === undefined) {
                delete process.env.SUPPRESS_STEP_NOTIFICATIONS;
            } else {
                process.env.SUPPRESS_STEP_NOTIFICATIONS = originalSuppression;
            }
        }
    }

    async initialize() {
        this.logDirectory = path.join(process.cwd(), 'logs', this.deploymentId);
        await fs.ensureDir(this.logDirectory);

        logger.info('Deployment pipeline initialized', {
            deploymentId: this.deploymentId,
            logDirectory: this.logDirectory,
            model: this.modelName,
            sourceBranch: this.sourceBranch,
            targetBranch: this.targetBranch
        });
    }

    validateConfiguration() {
        const required = [
            'TFVC_COLLECTION_URL',
            'TFVC_WORKSPACE',
            'TFVC_PROJECT_NAME',
            'TFVC_USERNAME',
            'D365_MODEL'
        ];

        const missing = required.filter(name => !process.env[name]);
        const hasTfvcCredential = Boolean(
            process.env.TFVC_PAT
            || process.env.AZURE_PAT
            || process.env.TFVC_PASSWORD
        );

        if (!hasTfvcCredential) {
            missing.push('TFVC_PAT or AZURE_PAT or TFVC_PASSWORD');
        }

        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
    }

    async executeConfiguredStep(name, enabled, fn, reason) {
        if (!enabled) {
            return this.createSkippedStep(name, reason);
        }

        const result = await this.executeStep(name, fn);
        if (!result.success) {
            throw new Error(result.message);
        }
        return result;
    }

    async executeServiceStopStep() {
        if (!this.enableServiceControl) {
            return this.createSkippedStep('Stop Services', 'ENABLE_SERVICE_CONTROL=false');
        }

        const result = await this.executeStep('Stop Services', () => this.manageServices('stop'));
        if (!result.success) {
            throw new Error(result.message);
        }
        return result;
    }

    async executeServiceStartStep(throwOnFailure) {
        if (this.serviceStartRecorded) {
            return null;
        }

        const result = !this.enableServiceControl
            ? this.createSkippedStep('Start Services', 'ENABLE_SERVICE_CONTROL=false')
            : await this.executeStep('Start Services', () => this.manageServices('start'));

        this.serviceStartRecorded = true;

        if (!result.success && throwOnFailure) {
            throw new Error(result.message);
        }

        return result;
    }

    async executeStep(stepName, stepFn) {
        const startedAt = Date.now();
        this.currentStep = stepName;
        logger.startStep(stepName);

        try {
            const details = await stepFn();
            const duration = Date.now() - startedAt;
            logger.completeStep(stepName, { duration });

            return {
                name: stepName,
                success: true,
                duration,
                message: `${stepName} completed successfully`,
                details: details?.details || details || {}
            };
        } catch (error) {
            const duration = Date.now() - startedAt;
            logger.failStep(stepName, error, { duration });

            return {
                name: stepName,
                success: false,
                duration,
                message: error.message,
                details: { error: error.message }
            };
        }
    }

    async manageServices(action) {
        const commands = action === 'stop' ? this.serviceStopCommands : this.serviceStartCommands;
        if (!commands.length) {
            const message = `No services configured to ${action}`;
            logger.info(message, { action });
            return {
                message,
                details: { commandsExecuted: [] }
            };
        }

        const executed = [];

        for (const originalCommand of commands) {
            const command = this.prepareServiceCommand(originalCommand, action);
            logger.info('Executing service command', { action, command, originalCommand });

            try {
                const { stdout, stderr } = await execAsync(command, {
                    windowsHide: true,
                    timeout: this.serviceCommandTimeout
                });
                if (stdout?.trim()) logger.debug('Service command stdout', { command, output: stdout.trim() });
                if (stderr?.trim()) logger.debug('Service command stderr', { command, output: stderr.trim() });
            } catch (error) {
                const timedOut = (error.killed && error.signal === 'SIGTERM')
                    || /timed out/i.test(error.message || '');
                if (timedOut) {
                    throw new Error(`${action === 'stop' ? 'Stop' : 'Start'} command timed out (${command}) after ${this.serviceCommandTimeout}ms`);
                }

                const output = [error.stderr, error.stdout, error.message]
                    .filter(Boolean)
                    .map(value => value.toString().trim())
                    .filter(Boolean)
                    .join(' | ');
                const nonFatal = this.getNonFatalServiceError(action, output);
                if (!nonFatal) {
                    throw new Error(`${action === 'stop' ? 'Stop' : 'Start'} command failed (${command}): ${output || 'Unknown error'}`);
                }
                logger.warn('Ignoring non-fatal service command result', {
                    action,
                    command,
                    reason: nonFatal
                });
            }

            executed.push(command);
        }

        return {
            message: `${action === 'stop' ? 'Stopped' : 'Started'} ${executed.length} service(s)`,
            details: { commandsExecuted: executed }
        };
    }

    prepareServiceCommand(command, action) {
        const trimmed = (command || '').trim();
        if (!trimmed) {
            return trimmed;
        }

        if (action === 'stop' && /^net\s+stop\b/i.test(trimmed) && !/\s\/y(\s|$)/i.test(trimmed)) {
            return `${trimmed} /y`;
        }

        return trimmed;
    }

    getNonFatalServiceError(action, output = '') {
        if (!output) {
            return null;
        }

        const normalized = output.toLowerCase();

        if (action === 'stop') {
            const stopPhrases = [
                'has not been started',
                'has already been stopped',
                'is not started',
                'is not running',
                'was not started'
            ];
            if (stopPhrases.some(phrase => normalized.includes(phrase))) {
                return 'already stopped';
            }
        }

        if (action === 'start') {
            const startPhrases = [
                'has already been started',
                'already been started',
                'service is already running'
            ];
            if (startPhrases.some(phrase => normalized.includes(phrase))) {
                return 'already running';
            }
        }

        return null;
    }

    buildResults(steps) {
        const endTime = Date.now();
        return {
            success: steps.every(step => step.success),
            deploymentId: this.deploymentId,
            model: this.modelName,
            sourceBranch: this.sourceBranch,
            targetBranch: this.targetBranch,
            startTime: new Date(this.startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            totalDuration: endTime - this.startTime,
            logDirectory: this.logDirectory,
            steps
        };
    }

    createSkippedStep(name, reason) {
        return {
            name,
            success: true,
            duration: 0,
            message: `${name} skipped`,
            details: { reason }
        };
    }

    getEnvFlag(varName, defaultValue) {
        const raw = process.env[varName];
        if (!raw) return defaultValue;
        const normalized = raw.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return defaultValue;
    }

    getServiceCommands(varName, defaultValue) {
        const raw = process.env[varName];
        if (!raw || !raw.trim()) {
            return [...defaultValue];
        }

        return raw
            .split(/\r?\n|[,;|]+/)
            .map(value => value.trim())
            .filter(Boolean);
    }

    getNumericEnv(varName, defaultValue) {
        const raw = process.env[varName];
        if (!raw) {
            return defaultValue;
        }

        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
    }

    generateDeploymentId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const random = Math.random().toString(36).slice(2, 8);
        return `DEPLOY-${timestamp}-${random}`;
    }
}

if (require.main === module) {
    const pipeline = new DeploymentPipeline();

    try {
        pipeline.validateConfiguration();
    } catch (error) {
        console.error(`Configuration validation failed: ${error.message}`);
        process.exit(1);
    }

    pipeline.execute()
        .then((results) => {
            console.log('Deployment pipeline completed successfully');
            console.log(`Logs: ${results.logDirectory}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error(`Deployment pipeline failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = DeploymentPipeline;
