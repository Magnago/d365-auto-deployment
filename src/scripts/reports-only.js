require('dotenv').config();
const D365Reports = require('../modules/d365-reports');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class ReportsOnly {
    constructor() {
        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.reports = new D365Reports();
        this.notifications = new NotificationService();
        this.executionId = `REPORTS-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }

    async execute() {
        const startedAt = Date.now();

        try {
            logger.info('Starting D365 reports deployment', { model: this.modelName });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('start', {
                    deploymentId: this.executionId,
                    model: this.modelName
                });
            }

            const result = await this.reports.deployAllReports({
                module: this.modelName,
                timeout: Number(process.env.REPORTS_TIMEOUT) || 15 * 60 * 1000,
                deploymentLogDir: './logs/reports'
            });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('success', {
                    deploymentId: this.executionId,
                    model: this.modelName,
                    executionTime: Date.now() - startedAt
                });
            }

            return {
                success: true,
                message: 'Report deployment completed successfully',
                details: result
            };
        } catch (error) {
            logger.error('D365 reports deployment failed', { error: error.message });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('failure', {
                    deploymentId: this.executionId,
                    model: this.modelName,
                    failedStep: 'Deploy All Reports',
                    error: error.message,
                    executionTime: Date.now() - startedAt
                });
            }

            throw error;
        }
    }

    shouldNotify() {
        return process.env.SUPPRESS_STEP_NOTIFICATIONS !== 'true';
    }
}

if (require.main === module) {
    const runner = new ReportsOnly();
    runner.execute()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(`Report deployment failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = ReportsOnly;
