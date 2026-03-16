require('dotenv').config();
const D365Sync = require('../modules/d365-sync');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class SyncOnly {
    constructor() {
        this.sync = new D365Sync();
        this.notifications = new NotificationService();
        this.executionId = `SYNC-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }

    async execute() {
        const startedAt = Date.now();

        try {
            logger.info('Starting D365 database synchronization');

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('start', {
                    deploymentId: this.executionId
                });
            }

            const result = await this.sync.performFullSync({
                timeout: Number(process.env.SYNC_TIMEOUT) || 30 * 60 * 1000,
                deploymentLogDir: './logs/sync'
            });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('success', {
                    deploymentId: this.executionId,
                    executionTime: Date.now() - startedAt
                });
            }

            return {
                success: true,
                message: 'Database synchronization completed successfully',
                details: result
            };
        } catch (error) {
            logger.error('D365 database synchronization failed', { error: error.message });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('failure', {
                    deploymentId: this.executionId,
                    failedStep: 'Database Sync',
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
    const runner = new SyncOnly();
    runner.execute()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(`Database sync failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = SyncOnly;
