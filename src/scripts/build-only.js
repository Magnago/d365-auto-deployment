require('dotenv').config();
const D365Build = require('../modules/d365-build');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class BuildOnly {
    constructor() {
        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.build = new D365Build();
        this.notifications = new NotificationService();
        this.executionId = `BUILD-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }

    async execute() {
        const startedAt = Date.now();

        try {
            logger.info('Starting D365 build', { model: this.modelName });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('start', {
                    deploymentId: this.executionId,
                    model: this.modelName
                });
            }

            const result = await this.build.buildModel(this.modelName, {
                timeout: Number(process.env.BUILD_TIMEOUT) || 60 * 60 * 1000,
                deploymentLogDir: './logs/build'
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
                message: 'Build completed successfully',
                details: result
            };
        } catch (error) {
            logger.error('D365 build failed', { error: error.message });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('failure', {
                    deploymentId: this.executionId,
                    model: this.modelName,
                    failedStep: 'Build Model',
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
    const runner = new BuildOnly();
    runner.execute()
        .then((result) => {
            console.log('Build completed successfully');
            console.log(`Model: ${result.details.model}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error(`Build failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = BuildOnly;
