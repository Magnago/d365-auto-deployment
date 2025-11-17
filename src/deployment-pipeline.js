require('dotenv').config();
const TFVCMerge = require('./scripts/tfvc-merge');
const BuildOnly = require('./scripts/build-only');
const SyncOnly = require('./scripts/sync-only');
const ReportsOnly = require('./scripts/reports-only');
const logger = require('./core/logger');
const NotificationService = require('./core/notification-service');

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

        this.sourceBranchPath = `$/${this.projectName}/${this.sourceBranch}`;
        this.targetBranchPath = `$/${this.projectName}/${this.targetBranch}`;
        this.publicWorkspaceName = `AutoDeployment-${this.modelName}`;

        this.startTime = null;
        this.results = null;
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
        const startTime = Date.now();
        const steps = [];
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
                    'Update YourD365Model Version',
                    'Merge Tickets',
                    'Full Build',
                    'Database Sync',
                    'Deploy Reports'
                ]
            });

            // TFVC merge
            const mergeResult = this.enableTfvcStep
                ? await this.executeStep('TFVC Merge', () => this.tfvcMerge.execute())
                : this.createSkippedStep('TFVC Merge', 'ENABLE_TFVC_STEP=false', { hasChanges: true });
            steps.push(mergeResult);

            if (this.enableTfvcStep) {
                if (!mergeResult.success) {
                    throw new Error(mergeResult.message || 'TFVC merge failed');
                }

                if (!mergeResult.details?.hasChanges) {
                    logger.info('No changes detected after merge, stopping pipeline');
                    this.results = this.buildResults(startTime, steps, { hasChanges: false, message: 'Pipeline completed - no changes to merge' });
                    await this.sendNotifications();
                    this.generateSummary();
                    return this.results;
                }
            }

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

            this.results = this.buildResults(startTime, steps);
            await this.sendNotifications();
            this.generateSummary();
            return this.results;
        } catch (error) {
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



