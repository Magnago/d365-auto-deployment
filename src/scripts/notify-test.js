require('dotenv').config();
const NotificationService = require('../core/notification-service');

const VALID_TYPES = ['start', 'success', 'failure', 'warning'];

class NotifyTest {
    constructor() {
        this.notifications = new NotificationService();
        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
    }

    // Posts straight to Teams, bypassing NOTIFICATION_ENABLED and the per-type
    // config flags — the point is to prove the webhook itself delivers.
    async execute(type = 'success') {
        if (!VALID_TYPES.includes(type)) {
            throw new Error(`Unknown notification type "${type}". Use one of: ${VALID_TYPES.join(', ')}`);
        }

        const data = {
            deploymentId: 'NOTIFY-TEST',
            model: this.modelName,
            sourceBranch: this.sourceBranch,
            targetBranch: this.targetBranch,
            executionTime: 1000
        };

        if (type === 'failure') {
            data.failedStep = 'Pre-flight Build Check';
            data.error = 'Webhook test — this is not a real build failure.';
        }
        if (type === 'warning') {
            data.warning = 'Webhook test — this is not a real warning.';
        }

        return this.notifications.sendToTeams(type, data, {
            includeDetails: true,
            includeLogs: type === 'failure'
        });
    }
}

if (require.main === module) {
    const type = process.argv[2] || 'success';
    const runner = new NotifyTest();
    runner.execute(type)
        .then((result) => {
            console.log(`Teams accepted the ${type} card (HTTP ${result.status}).`);
            if (result.body) {
                console.log(`Response body: ${result.body}`);
            }
            console.log('Check the target channel — if nothing appears, the webhook is not wired to it.');
            process.exit(0);
        })
        .catch((error) => {
            console.error(`Teams notification test failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = NotifyTest;
