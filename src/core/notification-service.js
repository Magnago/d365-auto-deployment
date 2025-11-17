const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

class NotificationService {
    constructor() {
        this.teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
        this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
        this.notificationEnabled = process.env.NOTIFICATION_ENABLED === 'true';
    }

    /**
     * Send deployment notification
     * @param {string} type - Notification type ('start', 'success', 'failure')
     * @param {Object} data - Deployment data
     * @param {Object} options - Notification options
     * @returns {Promise<Object>} - Notification result
     */
    async sendNotification(type, data, options = {}) {
        if (!this.notificationEnabled) {
            logger.debug('Notifications are disabled');
            return { success: true, skipped: true };
        }

        const config = require('../../config/deployment-config.json');
        const notificationConfig = config.notifications[`on${type.charAt(0).toUpperCase() + type.slice(1)}`];

        if (!notificationConfig || !notificationConfig.enabled) {
            logger.debug(`${type} notifications are disabled`);
            return { success: true, skipped: true };
        }

        const results = {};

        try {
            // Send to enabled channels
            for (const channel of notificationConfig.channels) {
                try {
                    const result = await this.sendToChannel(channel, type, data, {
                        ...options,
                        includeDetails: notificationConfig.includeDetails,
                        includeLogs: notificationConfig.includeLogs
                    });
                    results[channel] = result;
                } catch (error) {
                    logger.error(`Failed to send ${type} notification to ${channel}`, {
                        error: error.message
                    });
                    results[channel] = { success: false, error: error.message };
                }
            }

            const overallSuccess = Object.values(results).some(r => r.success);

            if (overallSuccess) {
                logger.info(`Successfully sent ${type} notifications`, {
                    channels: Object.keys(results).filter(c => results[c].success)
                });
            } else {
                logger.error(`Failed to send ${type} notifications to all channels`);
            }

            return {
                success: overallSuccess,
                results
            };

        } catch (error) {
            logger.error(`Error sending ${type} notifications`, { error: error.message });
            return {
                success: false,
                error: error.message,
                results
            };
        }
    }

    /**
     * Send notification to specific channel
     * @param {string} channel - Channel name ('teams', 'slack')
     * @param {string} type - Notification type
     * @param {Object} data - Deployment data
     * @param {Object} options - Channel-specific options
     * @returns {Promise<Object>} - Channel result
     */
    async sendToChannel(channel, type, data, options = {}) {
        switch (channel.toLowerCase()) {
            case 'teams':
                return this.sendToTeams(type, data, options);
            case 'slack':
                return this.sendToSlack(type, data, options);
            default:
                throw new Error(`Unsupported notification channel: ${channel}`);
        }
    }

    /**
     * Send notification to Microsoft Teams
     * @param {string} type - Notification type
     * @param {Object} data - Deployment data
     * @param {Object} options - Options
     * @returns {Promise<Object>} - Send result
     */
    async sendToTeams(type, data, options = {}) {
        if (!this.teamsWebhookUrl) {
            throw new Error('Teams webhook URL not configured');
        }

        const message = this.buildTeamsMessage(type, data, options);
        const maxAttempts = parseInt(process.env.TEAMS_RETRY_ATTEMPTS || '3', 10);
        const baseDelayMs = parseInt(process.env.TEAMS_RETRY_DELAY_MS || '2000', 10);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await axios.post(this.teamsWebhookUrl, message, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                logger.debug('Teams notification sent', {
                    type,
                    status: response.status,
                    attempt
                });

                return { success: true, status: response.status, attempt };

            } catch (error) {
                const retryable = this.isTransientNetworkError(error);
                if (!retryable || attempt === maxAttempts) {
                    logger.error('Failed to send Teams notification', {
                        type,
                        attempt,
                        error: error.message,
                        response: error.response?.data
                    });
                    throw error;
                }

                const delay = baseDelayMs * attempt;
                logger.warn('Teams notification attempt failed, retrying...', {
                    type,
                    attempt,
                    nextAttemptInMs: delay,
                    error: error.message
                });
                await this.delay(delay);
            }
        }
    }

    /**
     * Send notification to Slack
     * @param {string} type - Notification type
     * @param {Object} data - Deployment data
     * @param {Object} options - Options
     * @returns {Promise<Object>} - Send result
     */
    async sendToSlack(type, data, options = {}) {
        if (!this.slackWebhookUrl) {
            throw new Error('Slack webhook URL not configured');
        }

        const message = this.buildSlackMessage(type, data, options);

        try {
            const response = await axios.post(this.slackWebhookUrl, message, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            logger.debug('Slack notification sent', {
                type,
                status: response.status
            });

            return { success: true, status: response.status };

        } catch (error) {
            logger.error('Failed to send Slack notification', {
                type,
                error: error.message,
                response: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Build Teams message
     * @param {string} type - Notification type
     * @param {Object} data - Deployment data
     * @param {Object} options - Options
     * @returns {Object} - Teams message payload
     */
    buildTeamsMessage(type, data, options = {}) {
        const { includeDetails = true, includeLogs = false } = options;

        const baseMessage = {
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            themeColor: this.getThemeColor(type),
            summary: `D365 Deployment ${type}`,
            sections: [{
                activityTitle: `D365 F&O Deployment ${type.toUpperCase()}`,
                activitySubtitle: new Date().toLocaleString(),
                facts: []
            }]
        };

        if (includeDetails) {
            const stepLabel = this.formatSteps(data);
            baseMessage.sections[0].facts.push(
                {
                    name: 'Steps',
                    value: stepLabel
                },
                {
                    name: 'Model',
                    value: data.model || process.env.D365_MODEL || 'YourD365Model'
                }
            );

            if (data.deploymentId) {
                baseMessage.sections[0].facts.push({
                    name: 'Deployment ID',
                    value: data.deploymentId
                });
            }

            if (data.sourceBranch && data.targetBranch) {
                baseMessage.sections[0].facts.push(
                    {
                        name: 'Source Branch',
                        value: data.sourceBranch
                    },
                    {
                        name: 'Target Branch',
                        value: data.targetBranch
                    }
                );
            }

            if (data.executionTime) {
                baseMessage.sections[0].facts.push({
                    name: 'Execution Time',
                    value: this.formatDuration(data.executionTime)
                });
            }

            if (type === 'success') {
                baseMessage.sections[0].facts.push(
                    {
                        name: 'Steps Completed',
                        value: data.stepsCompleted || 'All'
                    }
                );

                if (data.buildResult) {
                    baseMessage.sections[0].facts.push({
                        name: 'Build Status',
                        value: 'âœ… Successful'
                    });
                }

                if (data.syncResult) {
                    baseMessage.sections[0].facts.push({
                        name: 'Database Sync',
                        value: 'âœ… Successful'
                    });
                }

                if (data.reportsResult) {
                    const stats = data.reportsResult.deploymentStats || {};
                    baseMessage.sections[0].facts.push({
                        name: 'Reports Deployed',
                        value: `${stats.deployedReports || 0}/${stats.totalReports || 0}`
                    });
                }
            }

            if (type === 'failure') {
                baseMessage.sections[0].facts.push({
                    name: 'Failed Step',
                    value: data.failedStep || 'Unknown'
                });

                if (data.error) {
                    baseMessage.sections[0].facts.push({
                        name: 'Error',
                        value: data.error.substring(0, 200) + (data.error.length > 200 ? '...' : '')
                    });
                }
            }
        }

        // Add potential actions for troubleshooting
        if (type === 'failure' && includeDetails) {
            baseMessage.potentialAction = [{
                '@type': 'OpenUri',
                name: 'View Logs',
                targets: [{
                    os: 'default',
                    uri: `file://${path.join(process.cwd(), 'logs')}`
                }]
            }];
        }

        return baseMessage;
    }

    /**
     * Build Slack message
     * @param {string} type - Notification type
     * @param {Object} data - Deployment data
     * @param {Object} options - Options
     * @returns {Object} - Slack message payload
     */
    buildSlackMessage(type, data, options = {}) {
        const { includeDetails = true, includeLogs = false } = options;

        const color = this.getSlackColor(type);
        const emoji = this.getEmoji(type);

        const message = {
            text: `${emoji} D365 F&O Deployment ${type.toUpperCase()}`,
            attachments: [{
                color: color,
                fields: [],
                footer: 'D365 Auto Deployment',
                ts: Math.floor(Date.now() / 1000)
            }]
        };

        if (includeDetails) {
            const stepLabel = this.formatSteps(data);
            const fields = message.attachments[0].fields;

            fields.push(
                {
                    title: 'Steps',
                    value: stepLabel,
                    short: true
                },
                {
                    title: 'Model',
                    value: data.model || process.env.D365_MODEL || 'YourD365Model',
                    short: true
                }
            );

            if (data.deploymentId) {
                fields.push({
                    title: 'Deployment ID',
                    value: data.deploymentId,
                    short: true
                });
            }

            if (data.sourceBranch && data.targetBranch) {
                fields.push(
                    {
                        title: 'Source Branch',
                        value: data.sourceBranch,
                        short: true
                    },
                    {
                        title: 'Target Branch',
                        value: data.targetBranch,
                        short: true
                    }
                );
            }

            if (data.executionTime) {
                fields.push({
                    title: 'Duration',
                    value: this.formatDuration(data.executionTime),
                    short: true
                });
            }

            if (type === 'success') {
                if (data.buildResult) {
                    fields.push({
                        title: 'Build Status',
                        value: 'âœ… Successful',
                        short: true
                    });
                }

                if (data.syncResult) {
                    fields.push({
                        title: 'Database Sync',
                        value: 'âœ… Successful',
                        short: true
                    });
                }

                if (data.reportsResult) {
                    const stats = data.reportsResult.deploymentStats || {};
                    fields.push({
                        title: 'Reports Deployed',
                        value: `${stats.deployedReports || 0}/${stats.totalReports || 0}`,
                        short: true
                    });
                }
            }

            if (type === 'failure') {
                fields.push({
                    title: 'Failed Step',
                    value: data.failedStep || 'Unknown',
                    short: true
                });

                if (data.error) {
                    fields.push({
                        title: 'Error',
                        value: data.error.substring(0, 300) + (data.error.length > 300 ? '...' : ''),
                        short: false
                    });
                }
            }
        }

        // Add log file attachment if requested and available
        if (includeLogs && type === 'failure') {
            const logPath = data.logPath || path.join(process.cwd(), 'logs');
            if (fs.existsSync(logPath)) {
                fields.push({
                    title: 'Logs Location',
                    value: `\`${logPath}\``,
                    short: false
                });
            }
        }

        return message;
    }

    /**
     * Get theme color for Teams based on notification type
     * @param {string} type - Notification type
     * @returns {string} - Hex color code
     */
    getThemeColor(type) {
        switch (type) {
            case 'success':
                return '00FF00'; // Green
            case 'failure':
                return 'FF0000'; // Red
            case 'start':
                return '0080FF'; // Blue
            default:
                return '808080'; // Gray
        }
    }

    /**
     * Get color for Slack based on notification type
     * @param {string} type - Notification type
     * @returns {string} - Color name
     */
    getSlackColor(type) {
        switch (type) {
            case 'success':
                return 'good';
            case 'failure':
                return 'danger';
            case 'start':
                return '#0080FF';
            default:
                return '#808080';
        }
    }

    isTransientNetworkError(error) {
        const code = (error && error.code ? error.code : '').toLowerCase();
        const transientCodes = ['enotfound', 'eai_again', 'etimedout', 'econnreset', 'econnrefused', 'ecanceled'];
        return transientCodes.includes(code);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get emoji for notification type
     * @param {string} type - Notification type
     * @returns {string} - Emoji
     */
    getEmoji(type) {
        switch (type) {
            case 'success':
                return 'âœ…';
            case 'failure':
                return 'âŒ';
            case 'start':
                return 'ðŸš€';
            default:
                return 'â„¹ï¸';
        }
    }
    formatSteps(data = {}) {
        if (Array.isArray(data.steps) && data.steps.length) {
            return data.steps.join(', ');
        }

        if (Array.isArray(data.stepName) && data.stepName.length) {
            return data.stepName.join(', ');
        }

        if (typeof data.stepName === 'string' && data.stepName.trim()) {
            return data.stepName;
        }

        if (typeof data.environmentType === 'string' && data.environmentType.trim()) {
            return data.environmentType;
        }

        return 'Pipeline';
    }

    /**
     * Format duration in milliseconds to human-readable format
     * @param {number} durationMs - Duration in milliseconds
     * @returns {string} - Formatted duration
     */
    formatDuration(durationMs) {
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Test notification configuration
     * @returns {Promise<Object>} - Test result
     */
    async testNotifications() {
        logger.info('Testing notification configuration');

        const testData = {
            deploymentId: 'TEST-' + Date.now(),
            environmentType: 'Test',
            model: 'YourD365Model',
            sourceBranch: 'Dev',
            targetBranch: 'Dev-test',
            executionTime: 45000
        };

        const results = {};

        try {
            // Test success notification
            results.success = await this.sendNotification('success', testData);

            // Test failure notification
            testData.error = 'This is a test error message';
            testData.failedStep = 'Test Step';
            results.failure = await this.sendNotification('failure', testData);

            // Test start notification
            delete testData.error;
            delete testData.failedStep;
            results.start = await this.sendNotification('start', testData);

            return {
                success: true,
                results
            };

        } catch (error) {
            logger.error('Notification test failed', { error: error.message });
            return {
                success: false,
                error: error.message,
                results
            };
        }
    }

    /**
     * Check notification configuration
     * @returns {Object} - Configuration status
     */
    checkConfiguration() {
        return {
            notificationsEnabled: this.notificationEnabled,
            teamsConfigured: !!this.teamsWebhookUrl,
            slackConfigured: !!this.slackWebhookUrl,
            availableChannels: [
                ...(this.teamsWebhookUrl ? ['teams'] : []),
                ...(this.slackWebhookUrl ? ['slack'] : [])
            ]
        };
    }
}

module.exports = NotificationService;


