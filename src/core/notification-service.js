const axios = require('axios');
const logger = require('./logger');

// Office 365 connector webhooks are retired. They keep answering 2xx while
// silently discarding every card, so a dead webhook looks identical to a
// working one. Reject them up front instead of posting into the void.
const RETIRED_WEBHOOK_HOSTS = [
    'webhook.office.com',
    'webhook.office365.com',
    'outlook.office.com',
    'outlook.office365.com'
];

// Teams Workflows (Power Automate) answers 202 on accept; plain 200/201/204
// are accepted too so a different connector shape doesn't read as a failure.
const ACCEPTED_STATUS_CODES = [200, 201, 202, 204];

class NotificationService {
    constructor() {
        this.teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
        this.notificationsEnabled = process.env.NOTIFICATION_ENABLED === 'true';
        this.requestTimeout = Number(process.env.TEAMS_REQUEST_TIMEOUT_MS) || 10000;
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

        const delivered = Object.keys(results).filter(channel => results[channel].success);
        const success = delivered.length > 0;

        if (success) {
            logger.info(`Successfully sent ${type} notifications`, {
                channels: delivered,
                statuses: delivered.map(channel => results[channel].status)
            });
        } else {
            logger.error(`No ${type} notification could be delivered`, {
                errors: Object.keys(results).map(channel => `${channel}: ${results[channel].error}`)
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

        this.assertSupportedWebhook();

        const payload = this.buildTeamsMessage(type, data, options);

        let response;
        try {
            response = await axios.post(this.teamsWebhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: this.requestTimeout
            });
        } catch (error) {
            const status = error.response?.status;
            const body = this.describeBody(error.response?.data);
            throw new Error(status
                ? `Teams webhook returned HTTP ${status}${body ? ` — ${body}` : ''}`
                : `Teams webhook request failed: ${error.message}`);
        }

        const body = this.describeBody(response.data);

        // Always record what the endpoint actually said, so a webhook that
        // starts accepting-and-dropping is visible in the log.
        logger.debug('Teams webhook response', { type, status: response.status, body });

        if (!ACCEPTED_STATUS_CODES.includes(response.status)) {
            throw new Error(`Teams webhook returned unexpected HTTP ${response.status}${body ? ` — ${body}` : ''}`);
        }

        return { success: true, status: response.status, body };
    }

    assertSupportedWebhook() {
        let host;
        try {
            host = new URL(this.teamsWebhookUrl).hostname.toLowerCase();
        } catch (_) {
            throw new Error('Teams webhook URL is not a valid URL');
        }

        const retired = RETIRED_WEBHOOK_HOSTS.find(
            candidate => host === candidate || host.endsWith(`.${candidate}`)
        );

        if (retired) {
            throw new Error(
                `Teams webhook host "${host}" is a retired Office 365 connector. `
                + 'These endpoints answer 2xx but never deliver the card. Replace TEAMS_WEBHOOK_URL '
                + 'with a Teams Workflows (Power Automate) webhook URL.'
            );
        }
    }

    buildTeamsMessage(type, data, options = {}) {
        const facts = [];
        if (options.includeDetails !== false) {
            if (data.environmentUrl) facts.push({ title: 'Environment URL', value: data.environmentUrl });
            if (data.model) facts.push({ title: 'Model', value: data.model });
            if (data.sourceBranch) facts.push({ title: 'Source Branch', value: data.sourceBranch });
            if (data.targetBranch) facts.push({ title: 'Target Branch', value: data.targetBranch });
            if (data.failedStep) facts.push({ title: 'Failed Step', value: data.failedStep });
            if (data.executionTime) facts.push({ title: 'Execution Time', value: this.formatDuration(data.executionTime) });
        }

        facts.push({ title: 'Timestamp', value: new Date().toISOString() });

        const body = [
            {
                type: 'TextBlock',
                text: this.getTitle(type),
                weight: 'Bolder',
                size: 'Large',
                color: this.getCardColor(type),
                wrap: true
            },
            { type: 'FactSet', facts }
        ];

        // Build diagnostics can run long, so give them room on failure cards
        // instead of the 300 characters a fact value can carry.
        const detailLimit = options.includeLogs ? 2000 : 600;
        if (data.warning) body.push(...this.detailBlocks('Warning', data.warning, detailLimit));
        if (data.error) body.push(...this.detailBlocks('Error details', data.error, detailLimit));

        const card = {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body
        };

        if (data.environmentUrl) {
            card.actions = [{ type: 'Action.OpenUrl', title: 'Open environment', url: data.environmentUrl }];
        }

        return {
            type: 'message',
            attachments: [
                {
                    contentType: 'application/vnd.microsoft.card.adaptive',
                    contentUrl: null,
                    content: card
                }
            ]
        };
    }

    detailBlocks(label, text, maxLength) {
        return [
            { type: 'TextBlock', text: label, weight: 'Bolder', spacing: 'Medium', wrap: true },
            {
                type: 'TextBlock',
                text: this.trim(String(text), maxLength),
                wrap: true,
                fontType: 'Monospace',
                spacing: 'None'
            }
        ];
    }

    describeBody(data) {
        if (data === undefined || data === null || data === '') {
            return '';
        }
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        return this.trim(text.trim(), 300);
    }

    getSummary(type) {
        if (type === 'start') return 'Deployment Started';
        if (type === 'success') return 'Deployment Succeeded';
        if (type === 'failure') return 'Deployment Failed';
        if (type === 'warning') return 'Deployment Warning';
        return 'Deployment Update';
    }

    getTitle(type) {
        return this.getSummary(type);
    }

    getCardColor(type) {
        if (type === 'start') return 'Accent';
        if (type === 'success') return 'Good';
        if (type === 'failure') return 'Attention';
        if (type === 'warning') return 'Warning';
        return 'Default';
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
