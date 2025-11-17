require('dotenv').config();
const D365Build = require('../modules/d365-build');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class BuildOnly {
    constructor() {
        this.d365Build = new D365Build();
        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.notificationService = new NotificationService();
        this.deploymentId = 'BUILD-' + new Date().toISOString().replace(/[:.]/g, '-');
    }

    async execute() {
        const startTime = Date.now();
        try {
            logger.info('ðŸ”¨ Starting D365 Build Only', {
                model: this.modelName
            });

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('start', {
                    deploymentId: this.deploymentId,
                    stepName: 'Build Only',
                    environmentType: 'Detecting...',
                    model: this.modelName,
                    sourceBranch: 'N/A (Standalone)',
                    targetBranch: 'N/A (Standalone)'
                });
            }

            const buildResult = await this.d365Build.buildModel(this.modelName, {
                timeout: parseInt(process.env.BUILD_TIMEOUT) || 60 * 60 * 1000, // 1 hour default
                deploymentLogDir: './logs/build'
            });

            if (buildResult.success) {
                logger.info('âœ… D365 Build completed successfully', {
                    model: this.modelName,
                    executionTime: buildResult.executionTime,
                    environmentType: buildResult.environmentType
                });

                if (this.shouldNotify()) {
                    await this.notificationService.sendNotification('success', {
                        deploymentId: this.deploymentId,
                        stepName: 'Build Only',
                        environmentType: buildResult.environmentType,
                        model: this.modelName,
                        sourceBranch: 'N/A (Standalone)',
                        targetBranch: 'N/A (Standalone)',
                        executionTime: Date.now() - startTime,
                        buildResult: buildResult
                    });
                }

                return {
                    success: true,
                    message: 'Model build completed successfully',
                    details: buildResult
                };
            } else {
                throw new Error(buildResult.stderr || 'Model build failed');
            }

        } catch (error) {
            logger.error(`âŒ D365 Build failed: ${error.message}`);

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('failure', {
                    deploymentId: this.deploymentId,
                    stepName: 'Build Only',
                    environmentType: 'Unknown',
                    model: this.modelName,
                    sourceBranch: 'N/A (Standalone)',
                    targetBranch: 'N/A (Standalone)',
                    executionTime: Date.now() - startTime,
                    failedStep: 'Model Build',
                    error: error.message
                });
            }

            throw error;
        }
    }

    shouldNotify() {
        return process.env.SUPPRESS_STEP_NOTIFICATIONS !== 'true';
    }
}

// Execute if run directly
if (require.main === module) {
    const buildOnly = new BuildOnly();
    buildOnly.execute()
        .then((result) => {
            console.log('\nðŸŽ‰ D365 build completed successfully!');
            console.log(`âœ… Model: ${result.details.model}`);
            console.log(`â±ï¸  Duration: ${result.details.executionTime}ms`);
            console.log(`ðŸŒ Environment: ${result.details.environmentType}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error('\nðŸ’¥ D365 build failed:', error.message);
            process.exit(1);
        });
}

module.exports = BuildOnly;


