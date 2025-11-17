require('dotenv').config();
const D365Sync = require('../modules/d365-sync');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class SyncOnly {
    constructor() {
        this.d365Sync = new D365Sync();
        this.notificationService = new NotificationService();
        this.deploymentId = 'SYNC-' + new Date().toISOString().replace(/[:.]/g, '-');
    }

    async execute() {
        const startTime = Date.now();
        try {
            logger.info('🔄 Starting D365 Database Sync Only');

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('start', {
                    deploymentId: this.deploymentId,
                    stepName: 'Sync Only',
                    environmentType: 'Detecting...',
                    model: 'N/A (Database Sync)',
                    sourceBranch: 'N/A (Standalone)',
                    targetBranch: 'N/A (Standalone)'
                });
            }

            const syncResult = await this.d365Sync.performFullSync({
                timeout: parseInt(process.env.SYNC_TIMEOUT) || 30 * 60 * 1000, // 30 minutes default
                deploymentLogDir: './logs/sync'
            });

            if (syncResult.success) {
                logger.info('✅ D365 Database Sync completed successfully', {
                    syncMode: syncResult.syncMode,
                    totalExecutionTime: syncResult.totalExecutionTime,
                    stepsCompleted: syncResult.stepsCompleted
                });

                if (this.shouldNotify()) {
                    await this.notificationService.sendNotification('success', {
                        deploymentId: this.deploymentId,
                        stepName: 'Sync Only',
                        environmentType: syncResult.environmentType || 'Unknown',
                        model: 'N/A (Database Sync)',
                        sourceBranch: 'N/A (Standalone)',
                        targetBranch: 'N/A (Standalone)',
                        executionTime: Date.now() - startTime,
                        syncResult: syncResult
                    });
                }

                return {
                    success: true,
                    message: 'Database synchronization completed successfully',
                    details: syncResult
                };
            } else {
                throw new Error(syncResult.error || 'Database sync failed');
            }

        } catch (error) {
            logger.error(`❌ D365 Database Sync failed: ${error.message}`);

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('failure', {
                    deploymentId: this.deploymentId,
                    stepName: 'Sync Only',
                    environmentType: 'Unknown',
                    model: 'N/A (Database Sync)',
                    sourceBranch: 'N/A (Standalone)',
                    targetBranch: 'N/A (Standalone)',
                    executionTime: Date.now() - startTime,
                    failedStep: 'Database Sync',
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
    const syncOnly = new SyncOnly();
    syncOnly.execute()
        .then((result) => {
            console.log('\n🎉 D365 database sync completed successfully!');
            console.log(`✅ Sync Mode: ${result.details.syncMode}`);
            console.log(`⏱️  Duration: ${result.details.totalExecutionTime}ms`);
            console.log(`📊 Steps Completed: ${result.details.stepsCompleted}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 D365 database sync failed:', error.message);
            process.exit(1);
        });
}

module.exports = SyncOnly;
