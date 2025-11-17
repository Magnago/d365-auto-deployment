require('dotenv').config();
const TFVCMerge = require('./scripts/tfvc-merge');
const BuildOnly = require('./scripts/build-only');
const SyncOnly = require('./scripts/sync-only');
const ReportsOnly = require('./scripts/reports-only');
const logger = require('./core/logger');
const NotificationService = require('./core/notification-service');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class DeploymentPipeline {
    constructor() {
        this.deploymentId = this.generateDeploymentId();
        this.notificationService = new NotificationService();

        this.tfvcMerge = new TFVCMerge();
        this.buildOnly = new BuildOnly();
        this.syncOnly = new SyncOnly();
        this.reportsOnly = new ReportsOnly();

        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.environmentType = process.env.ENVIRONMENT_TYPE || 'local';

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

        this.sourceBranchPath = `$/${this.projectName}/${this.sourceBranch}`;
        this.targetBranchPath = `$/${this.projectName}/${this.targetBranch}`;
        this.publicWorkspaceName = `AutoDeployment-${this.modelName}`;

        this.startTime = null;
        this.results = null;
        this.serviceStartStepRecorded = false;
    }

    generateDeploymentId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const random = Math.random().toString(36).substring(2, 8);
        return `DEPLOY-${timestamp}-${random}`;
    }

    async initialize() {
        this.startTime = Date.now();

        const fs = require('fs-extra');
        const path = require('path');
        this.deploymentLogDir = path.join(process.cwd(), 'logs', this.deploymentId);
        await fs.ensureDir(this.deploymentLogDir);

        logger.info('Deployment pipeline initialized', {
            deploymentId: this.deploymentId,
            logDirectory: this.deploymentLogDir,
            model: this.modelName,
            sourceBranch: this.sourceBranch,
            targetBranch: this.targetBranch
        });
    }

    async execute() {
        this.serviceStartStepRecorded = false;
        const startTime = Date.now();
        const steps = [];
        let skipRemainingSteps = false;
        let extraResults = {};
        const originalSuppression = process.env.SUPPRESS_STEP_NOTIFICATIONS;
        process.env.SUPPRESS_STEP_NOTIFICATIONS = 'true';

        try {
            await this.initialize();

            logger.info('Starting D365 deployment pipeline', {
                deploymentId: this.deploymentId,
                model: this.modelName,
                sourceBranch: this.sourceBranch,
                targetBranch: this.targetBranch
            });

            await this.notificationService.sendNotification('start', {
                deploymentId: this.deploymentId,
                environmentType: this.environmentType,
                model: this.modelName,
                sourceBranch: this.sourceBranch,
                targetBranch: this.targetBranch,
                steps: [
                    'Stop Services',
                    'Update D365 Model Version',
                    'Merge Tickets',
                    'Full Build',
                    'Database Sync',
                    'Deploy Reports',
                    'Start Services'
                ]
            });

            if (this.enableServiceControl) {
                const stopResult = await this.executeStep('Stop Services', () => this.manageServices('stop'));
                steps.push(stopResult);
                if (!stopResult.success) {
                    throw new Error(stopResult.message || 'Failed to stop services');
                }
            } else {
                steps.push(this.createSkippedStep('Stop Services', 'ENABLE_SERVICE_CONTROL=false'));
            }

            // TFVC merge
            const mergeResult = this.enableTfvcStep
                ? await this.executeStep('TFVC Merge', () => this.tfvcMerge.execute())
                : this.createSkippedStep('TFVC Merge', 'ENABLE_TFVC_STEP=false', { hasChanges: true });
            steps.push(mergeResult);

            if (this.enableTfvcStep) {
                if (!mergeResult.success) {
                    throw new Error(mergeResult.message || 'TFVC merge failed');
                }

                const hasChanges = Boolean(mergeResult.details?.hasChanges);
                if (!hasChanges && !this.skipTfvcMergeOperations) {
                    logger.info('No changes detected after merge, stopping pipeline');
                    skipRemainingSteps = true;
                    extraResults = { hasChanges: false, message: 'Pipeline completed - no changes to merge' };
                }
            }

            if (!skipRemainingSteps) {
                // Build
                const buildResult = this.enableBuildStep
                    ? await this.executeStep('Build Model', () => this.buildOnly.execute())
                    : this.createSkippedStep('Build Model', 'ENABLE_BUILD_STEP=false');
                steps.push(buildResult);
                if (this.enableBuildStep && !buildResult.success) {
                    throw new Error(buildResult.message || 'Build failed');
                }

                // Sync
                const syncResult = this.enableSyncStep
                    ? await this.executeStep('Database Sync', () => this.syncOnly.execute())
                    : this.createSkippedStep('Database Sync', 'ENABLE_SYNC_STEP=false');
                steps.push(syncResult);
                if (this.enableSyncStep && !syncResult.success) {
                    throw new Error(syncResult.message || 'Database sync failed');
                }

                // Reports
                const reportsResult = this.enableReportsStep
                    ? await this.executeStep('Deploy Reports', () => this.reportsOnly.execute())
                    : this.createSkippedStep('Deploy Reports', 'ENABLE_REPORTS_STEP=false');
                steps.push(reportsResult);
                if (this.enableReportsStep && !reportsResult.success) {
                    throw new Error(reportsResult.message || 'Report deployment failed');
                }
            }

            await this.runServiceStartStep(steps, { throwOnFailure: true });

            this.results = this.buildResults(startTime, steps, extraResults);
            await this.sendNotifications();
            this.generateSummary();
            return this.results;
        } catch (error) {
            const failedStepBeforeRecovery = this.currentStep;
            try {
                await this.runServiceStartStep(steps, { throwOnFailure: false });
            } catch (serviceError) {
                logger.error('Failed to restart services during error handling', {
                    deploymentId: this.deploymentId,
                    error: serviceError.message
                });
            }
            this.currentStep = failedStepBeforeRecovery;

            logger.error('Deployment pipeline failed', {
                deploymentId: this.deploymentId,
                error: error.message,
                stack: error.stack
            });

            await this.sendErrorNotification(error, steps);
            throw error;
        } finally {
            if (originalSuppression === undefined) {
                delete process.env.SUPPRESS_STEP_NOTIFICATIONS;
            } else {
                process.env.SUPPRESS_STEP_NOTIFICATIONS = originalSuppression;
            }
        }
    }

    createSkippedStep(name, reason, extraDetails = {}) {
        return {
            name,
            success: true,
            duration: 0,
            message: `${name} skipped via configuration`,
            details: { reason, ...extraDetails }
        };
    }

    buildResults(startTime, steps, extra = {}) {
        const endTime = Date.now();
        const success = steps.every(step => step.success);

        return {
            success,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            totalDuration: endTime - startTime,
            steps,
            errors: steps.filter(step => !step.success).map(step => step.message),
            deploymentId: this.deploymentId,
            logDirectory: this.deploymentLogDir,
            model: this.modelName,
            sourceBranch: this.sourceBranch,
            targetBranch: this.targetBranch,
            environment: this.environmentType,
            ...extra
        };
    }

    async sendNotifications() {
        try {
            if (this.results.success) {
                await this.notificationService.sendNotification('success', {
                    deploymentId: this.deploymentId,
                    environmentType: this.environmentType,
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch,
                    executionTime: this.results.totalDuration,
                    steps: this.formatStepSummaries(this.results.steps),
                    logDirectory: this.deploymentLogDir
                });
            } else {
                const failedStep = this.results.steps.find(step => !step.success);
                await this.notificationService.sendNotification('failure', {
                    deploymentId: this.deploymentId,
                    environmentType: this.environmentType,
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch,
                    executionTime: this.results.totalDuration,
                    failedStep: failedStep?.name || 'Unknown',
                    error: failedStep?.message || 'Unknown error',
                    steps: this.formatStepSummaries(this.results.steps),
                    logDirectory: this.deploymentLogDir
                });
            }
        } catch (error) {
            logger.warn('Failed to send notifications', { error: error.message });
        }
    }

    async sendErrorNotification(error, steps = []) {
        try {
            await this.notificationService.sendNotification('failure', {
                deploymentId: this.deploymentId,
                environmentType: this.environmentType,
                model: this.modelName,
                sourceBranch: this.sourceBranch,
                targetBranch: this.targetBranch,
                failedStep: this.currentStep,
                error: error.message,
                executionTime: this.startTime ? Date.now() - this.startTime : 0,
                steps: this.formatStepSummaries(steps),
                logDirectory: this.deploymentLogDir
            });
        } catch (notificationError) {
            logger.warn('Failed to send error notification', {
                error: notificationError.message
            });
        }
    }

    generateSummary() {
        const summary = {
            deploymentId: this.deploymentId,
            startTime: this.results.startTime,
            endTime: this.results.endTime,
            totalDuration: this.results.totalDuration,
            success: this.results.success,
            environment: this.environmentType,
            model: this.modelName,
            sourceBranch: this.sourceBranch,
            targetBranch: this.targetBranch,
            workspace: this.publicWorkspaceName,
            steps: this.formatStepSummaries(this.results.steps),
            errors: this.results.errors,
            logDirectory: this.deploymentLogDir
        };

        logger.info('Deployment summary', summary);
        return summary;
    }

    validateConfiguration() {
        const requiredVars = [
            'TFVC_COLLECTION_URL',
            'TFVC_USERNAME',
            'TFVC_PASSWORD',
            'TFVC_PROJECT_NAME',
            'D365_MODEL'
        ];

        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

        logger.info('Configuration validation passed');
        return { valid: true };
    }

    async executeStep(stepName, stepFunction) {
        const stepStartTime = Date.now();
        this.currentStep = stepName;

        try {
            logger.startStep(stepName);
            const result = await stepFunction();
            const duration = Date.now() - stepStartTime;
            logger.completeStep(stepName, { duration });

            return {
                name: stepName,
                success: true,
                duration,
                message: `${stepName} completed successfully`,
                details: result?.details || result || {}
            };
        } catch (error) {
            const duration = Date.now() - stepStartTime;
            logger.failStep(stepName, error);

            return {
                name: stepName,
                success: false,
                duration,
                message: error.message,
                details: { error: error.message }
            };
        }
    }

    getEnvFlag(varName, defaultValue = true) {
        const value = process.env[varName];
        if (value === undefined || value === null || value === '') {
            return defaultValue;
        }

        const normalized = value.toString().trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
            return true;
        }

        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }

        return defaultValue;
    }

    getServiceCommands(varName, defaultList = []) {
        const rawValue = process.env[varName];
        if (!rawValue || !rawValue.trim()) {
            return [...defaultList];
        }

        return rawValue
            .split(/\r?\n|[,;|]+/)
            .map(entry => entry.trim())
            .filter(Boolean);
    }

    getNumericEnv(varName, defaultValue) {
        const rawValue = process.env[varName];
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return defaultValue;
        }

        const parsed = Number(rawValue);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }

        return defaultValue;
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
        for (const command of commands) {
            const preparedCommand = this.prepareServiceCommand(command, action);
            await this.runServiceCommand(preparedCommand, action, command);
            executed.push(preparedCommand);
        }

        const verb = action === 'stop' ? 'Stopped' : 'Started';
        return {
            message: `${verb} ${executed.length} service(s)`,
            details: { commandsExecuted: executed }
        };
    }

    prepareServiceCommand(command, action) {
        if (!command || typeof command !== 'string') {
            return command;
        }

        let prepared = command.trim();
        if (!prepared) {
            return prepared;
        }

        if (action === 'stop') {
            const netStopPattern = /^net\s+stop\b/i;
            const hasAutoConfirm = /\s\/y(\s|$)/i.test(prepared);
            if (netStopPattern.test(prepared) && !hasAutoConfirm) {
                prepared = `${prepared} /y`;
            }
        }

        return prepared;
    }

    async runServiceCommand(command, action, originalCommand = null) {
        const logPayload = { action, command };
        if (originalCommand && originalCommand !== command) {
            logPayload.originalCommand = originalCommand;
        }
        logger.info('Executing service command', logPayload);
        try {
            const { stdout, stderr } = await execAsync(command, {
                windowsHide: true,
                timeout: this.serviceCommandTimeout
            });
            if (stdout?.trim()) {
                logger.debug('Service command output', { command, output: stdout.trim() });
            }
            if (stderr?.trim()) {
                logger.debug('Service command warnings', { command, output: stderr.trim() });
            }
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
            if (nonFatal) {
                logger.warn('Service command reported non-fatal condition', {
                    action,
                    command,
                    reason: nonFatal,
                    output
                });
                return;
            }
            throw new Error(`${action === 'stop' ? 'Stop' : 'Start'} command failed (${command}): ${output || 'Unknown error'}`);
        }
    }

    getNonFatalServiceError(action, output = '') {
        if (!output) {
            return null;
        }

        const normalized = output.toLowerCase();
        if (action === 'start') {
            const phrases = [
                'has already been started',
                'already been started',
                'service is already running'
            ];
            if (phrases.some(phrase => normalized.includes(phrase))) {
                return 'already running';
            }
        } else if (action === 'stop') {
            const phrases = [
                'has not been started',
                'has already been stopped',
                'is not started',
                'is not running',
                'was not started'
            ];
            if (phrases.some(phrase => normalized.includes(phrase))) {
                return 'already stopped';
            }
        }

        return null;
    }

    async runServiceStartStep(steps, { throwOnFailure = false } = {}) {
        if (this.serviceStartStepRecorded) {
            return null;
        }

        let result;
        if (!this.enableServiceControl) {
            result = this.createSkippedStep('Start Services', 'ENABLE_SERVICE_CONTROL=false');
        } else {
            result = await this.executeStep('Start Services', () => this.manageServices('start'));
        }

        this.serviceStartStepRecorded = true;
        steps.push(result);

        if (this.enableServiceControl && !result.success && throwOnFailure) {
            throw new Error(result.message || 'Failed to start services');
        }

        return result;
    }

    formatStepSummaries(steps = []) {
        return (steps || []).map(step => ({
            name: step.name,
            success: step.success,
            duration: step.duration,
            message: step.message
        }));
    }
}

if (require.main === module) {
    const pipeline = new DeploymentPipeline();

    try {
        pipeline.validateConfiguration();
    } catch (error) {
        console.error('Configuration validation failed:', error.message);
        process.exit(1);
    }

    pipeline.execute()
        .then((results) => {
            if (results.success) {
                console.log('\nDeployment pipeline completed successfully!');
                console.log(`Logs: ${results.logDirectory}`);
                process.exit(0);
            } else {
                console.log('\nDeployment pipeline completed with errors');
                console.log(`Logs: ${results.logDirectory}`);
                process.exit(1);
            }
        })
        .catch((error) => {
            console.error('\nDeployment pipeline failed:', error.message);
            process.exit(1);
        });
}

module.exports = DeploymentPipeline;
