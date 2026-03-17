const axios = require('axios');
const logger = require('./logger');

class NotificationService {
    constructor() {
        this.teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
        this.notificationsEnabled = process.env.NOTIFICATION_ENABLED === 'true';
    }

    async sendNotification(type, data = {}) {
        if (!this.notificationsEnabled) {
            return { success: true, skipped: true };
        }

        const config = require('../../config/deployment-config.json');
        const notificationConfig = config.notifications[this.getConfigKey(type)];
        if (!notificationConfig?.enabled) {
            return { success: true, skipped: true };
        }

        const channels = notificationConfig.channels || [];
        const results = {};

        for (const channel of channels) {
            if (channel !== 'teams') {
                results[channel] = { success: false, error: `Unsupported channel: ${channel}` };
                continue;
            }

            try {
                results[channel] = await this.sendToTeams(type, data, notificationConfig);
            } catch (error) {
                logger.error(`Failed to send ${type} notification to Teams`, { error: error.message });
                results[channel] = { success: false, error: error.message };
            }
        }

        const success = Object.values(results).some(result => result.success);
        if (success) {
            logger.info(`Successfully sent ${type} notifications`, {
                channels: Object.keys(results).filter(channel => results[channel].success)
            });
        }

        return { success, results };
    }

    getConfigKey(type) {
        return `on${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    }

    async sendToTeams(type, data, options) {
        if (!this.teamsWebhookUrl) {
            throw new Error('Teams webhook URL not configured');
        }

        const payload = this.buildTeamsMessage(type, data, options);
        const response = await axios.post(this.teamsWebhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });

        return { success: true, status: response.status };
    }

    buildTeamsMessage(type, data, options = {}) {
        const facts = [];
        if (options.includeDetails !== false) {
            if (data.environmentUrl) facts.push({ name: 'Environment URL', value: data.environmentUrl });
            if (data.model) facts.push({ name: 'Model', value: data.model });
            if (data.sourceBranch) facts.push({ name: 'Source Branch', value: data.sourceBranch });
            if (data.targetBranch) facts.push({ name: 'Target Branch', value: data.targetBranch });
            if (data.failedStep) facts.push({ name: 'Failed Step', value: data.failedStep });
            if (data.error) facts.push({ name: 'Error', value: this.trim(data.error, 300) });
            if (data.executionTime) facts.push({ name: 'Execution Time', value: this.formatDuration(data.executionTime) });
        }

        facts.push({ name: 'Timestamp', value: new Date().toISOString() });

        return {
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            summary: this.getSummary(type),
            themeColor: this.getThemeColor(type),
            sections: [
                {
                    activityTitle: this.getTitle(type),
                    facts
                }
            ]
        };
    }

    getSummary(type) {
        if (type === 'start') return 'Deployment Started';
        if (type === 'success') return 'Deployment Succeeded';
        if (type === 'failure') return 'Deployment Failed';
        return 'Deployment Update';
    }

    getTitle(type) {
        if (type === 'start') return 'Deployment Started';
        if (type === 'success') return 'Deployment Succeeded';
        if (type === 'failure') return 'Deployment Failed';
        return 'Deployment Update';
    }

    getThemeColor(type) {
        if (type === 'start') return '0078D4';
        if (type === 'success') return '107C10';
        if (type === 'failure') return 'D13438';
        return '808080';
    }

    formatDuration(durationMs) {
        const totalSeconds = Math.floor(durationMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    trim(value, maxLength) {
        if (!value || value.length <= maxLength) {
            return value;
        }
        return `${value.slice(0, maxLength - 3)}...`;
    }
}

module.exports = NotificationService;
