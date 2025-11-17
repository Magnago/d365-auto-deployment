require('dotenv').config();
const D365Reports = require('../modules/d365-reports');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class ReportsOnly {
    constructor() {
        this.d365Reports = new D365Reports();
        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.notificationService = new NotificationService();
        this.deploymentId = 'REPORTS-' + new Date().toISOString().replace(/[:.]/g, '-');
    }

    async execute() {
        const startTime = Date.now();
        try {
            logger.info('ðŸ“Š Starting D365 Reports Deployment Only', {
                model: this.modelName
            });

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('start', {
                    deploymentId: this.deploymentId,
                    stepName: 'Reports Only',
                    environmentType: 'Detecting...',
                    model: this.modelName,
                    sourceBranch: 'N/A (Standalone)',
                    targetBranch: 'N/A (Standalone)'
                });
            }

            const reportsResult = await this.d365Reports.deployAllReports({
                module: this.modelName,
                timeout: parseInt(process.env.REPORTS_TIMEOUT) || 15 * 60 * 1000, // 15 minutes default
                deploymentLogDir: './logs/reports'
            });

            if (reportsResult.success) {
                logger.info('âœ… D365 Reports Deployment completed successfully', {
                    module: this.modelName,
                    executionTime: reportsResult.executionTime,
                    environmentType: reportsResult.environmentType
                });

                if (this.shouldNotify()) {
                    await this.notificationService.sendNotification('success', {
                        deploymentId: this.deploymentId,
                        stepName: 'Reports Only',
                        environmentType: reportsResult.environmentType,
                        model: this.modelName,
                        sourceBranch: 'N/A (Standalone)',
                        targetBranch: 'N/A (Standalone)',
                        executionTime: Date.now() - startTime,
                        reportsResult: reportsResult
                    });
                }

                return {
                    success: true,
                    message: 'Report deployment completed successfully',
                    details: reportsResult
                };
            } else {
                throw new Error(reportsResult.stderr || 'Report deployment failed');
            }

        } catch (error) {
            logger.error(`âŒ D365 Reports Deployment failed: ${error.message}`);

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('failure', {
                    deploymentId: this.deploymentId,
                    stepName: 'Reports Only',
                    environmentType: 'Unknown',
                    model: this.modelName,
                    sourceBranch: 'N/A (Standalone)',
                    targetBranch: 'N/A (Standalone)',
                    executionTime: Date.now() - startTime,
                    failedStep: 'Report Deployment',
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
    const reportsOnly = new ReportsOnly();
    reportsOnly.execute()
        .then((result) => {
            console.log('\nðŸŽ‰ D365 reports deployment completed successfully!');
            console.log(`âœ… Module: ${result.details.module}`);
            console.log(`â±ï¸  Duration: ${result.details.executionTime}ms`);
            console.log(`ðŸŒ Environment: ${result.details.environmentType}`);
            if (result.details.deploymentStats) {
                console.log(`ðŸ“Š Reports: ${result.details.deploymentStats.deployedReports || 0} deployed`);
            }
            process.exit(0);
        })
        .catch((error) => {
            console.error('\nðŸ’¥ D365 reports deployment failed:', error.message);
            process.exit(1);
        });
}

module.exports = ReportsOnly;


