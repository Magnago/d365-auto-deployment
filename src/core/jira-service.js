const axios = require('axios');
const logger = require('./logger');

class JiraService {
    constructor() {
        this.baseUrl = (process.env.JIRA_URL || '').replace(/\/+$/, '');
        this.email = process.env.JIRA_EMAIL || '';
        this.apiToken = process.env.JIRA_API_TOKEN || '';
        this.project = process.env.JIRA_PROJECT || '';
        this.promoter = process.env.JIRA_PROMOTER || '';
        this.fromStatus = process.env.JIRA_FROM_STATUS || '';
        this.toStatus = process.env.JIRA_TO_STATUS || '';
        this.defaultTester = process.env.JIRA_DEFAULT_TESTER || '';
        this.testers = (process.env.JIRA_TESTERS || '')
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);

        this.auth = {
            username: this.email,
            password: this.apiToken
        };
    }

    validateConfiguration() {
        const required = [
            ['JIRA_URL', this.baseUrl],
            ['JIRA_EMAIL', this.email],
            ['JIRA_API_TOKEN', this.apiToken],
            ['JIRA_PROJECT', this.project],
            ['JIRA_PROMOTER', this.promoter],
            ['JIRA_FROM_STATUS', this.fromStatus],
            ['JIRA_TO_STATUS', this.toStatus],
            ['JIRA_DEFAULT_TESTER', this.defaultTester]
        ];

        const missing = required.filter(([, value]) => !value).map(([name]) => name);
        if (missing.length > 0) {
            throw new Error(`Missing required Jira configuration: ${missing.join(', ')}`);
        }
    }

    async execute(mergeCandidates = []) {
        this.validateConfiguration();

        logger.info('Starting Jira ticket transition step', {
            project: this.project,
            promoter: this.promoter,
            fromStatus: this.fromStatus,
            toStatus: this.toStatus,
            mergeCandidates: mergeCandidates.length
        });

        this.mergeCandidates = mergeCandidates;
        const issues = await this.findIssues();
        if (issues.length === 0) {
            logger.info('No Jira tickets found to transition');
            return {
                message: 'No tickets to transition',
                details: { transitioned: 0, issues: [] }
            };
        }

        logger.info(`Found ${issues.length} ticket(s) to transition`, {
            keys: issues.map(i => i.key)
        });

        const results = [];
        for (const issue of issues) {
            try {
                const result = await this.processIssue(issue);
                results.push(result);
            } catch (error) {
                logger.error(`Failed to process ${issue.key}`, { error: error.message });
                results.push({ key: issue.key, success: false, error: error.message });
            }
        }

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        logger.info('Jira transition step completed', { succeeded, failed });

        return {
            message: `Transitioned ${succeeded} ticket(s)${failed > 0 ? `, ${failed} failed` : ''}`,
            details: { transitioned: succeeded, failed, issues: results }
        };
    }

    async findIssues() {
        const jql = `project = "${this.project}" AND status = "${this.fromStatus}" AND assignee = "${this.promoter}" ORDER BY created ASC`;
        logger.info('Searching Jira issues', { jql });

        const response = await axios.get(`${this.baseUrl}/rest/api/3/search/jql`, {
            auth: this.auth,
            params: {
                jql,
                fields: 'key,summary,status,assignee,issuelinks',
                maxResults: 100
            }
        });

        return response.data.issues || [];
    }

    getLinkedKeys(issue) {
        const links = issue.fields?.issuelinks || [];
        const keys = [];
        for (const link of links) {
            const linked = link.outwardIssue || link.inwardIssue;
            if (linked) {
                keys.push(linked.key);
            }
        }
        return keys;
    }

    async processIssue(issue) {
        const issueKey = issue.key;
        const linkedKeys = this.getLinkedKeys(issue);
        const allKeys = [issueKey, ...linkedKeys];

        logger.info(`Processing ticket ${issueKey}`, {
            summary: issue.fields?.summary,
            linkedTickets: linkedKeys
        });

        // Determine tester from comments across main ticket and all linked tickets
        const tester = await this.determineTester(allKeys);
        logger.info(`Tester for ${issueKey} (and linked): ${tester}`);

        // Process main ticket
        await this.addComment(issueKey);
        await this.transitionIssue(issueKey);
        await this.assignIssue(issueKey, tester);

        // Process linked tickets
        const linkedResults = [];
        for (const linkedKey of linkedKeys) {
            logger.info(`Processing linked ticket ${linkedKey}`, { parentKey: issueKey });
            try {
                await this.addComment(linkedKey);
                await this.transitionIssue(linkedKey);
                await this.assignIssue(linkedKey, tester);
                logger.info(`Linked ticket ${linkedKey} processed successfully`);
                linkedResults.push({ key: linkedKey, success: true, assignedTo: tester });
            } catch (error) {
                logger.error(`Failed to process linked ticket ${linkedKey}`, { error: error.message });
                linkedResults.push({ key: linkedKey, success: false, error: error.message });
            }
        }

        return { key: issueKey, success: true, assignedTo: tester, linkedIssues: linkedResults };
    }

    async determineTester(issueKeys) {
        if (this.testers.length === 0) {
            return this.defaultTester;
        }

        const keys = Array.isArray(issueKeys) ? issueKeys : [issueKeys];

        // Gather comments from all tickets
        const allComments = [];
        for (const key of keys) {
            const comments = await this.getComments(key);
            allComments.push(...comments);
        }

        if (allComments.length === 0) {
            return this.defaultTester;
        }

        // Count how many comments each tester has across all tickets
        const counts = {};
        for (const tester of this.testers) {
            counts[tester] = 0;
        }

        for (const comment of allComments) {
            const authorEmail = (comment.author?.emailAddress || '').toLowerCase();
            if (counts[authorEmail] !== undefined) {
                counts[authorEmail]++;
            }
        }

        // Find testers with comments
        const withComments = Object.entries(counts)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1]);

        if (withComments.length === 0) {
            return this.defaultTester;
        }

        // If there's a clear winner, use them
        if (withComments.length === 1 || withComments[0][1] > withComments[1][1]) {
            return withComments[0][0];
        }

        // Tie — use default
        return this.defaultTester;
    }

    async getComments(issueKey) {
        const response = await axios.get(`${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
            auth: this.auth,
            params: { maxResults: 100 }
        });

        return response.data.comments || [];
    }

    async addComment(issueKey) {
        const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

        const content = [
            {
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: `Deployed to DEV TEST environment on ${now} by auto deployment.`
                    }
                ]
            }
        ];

        if (this.mergeCandidates.length > 0) {
            const changesetLines = this.mergeCandidates
                .map(c => `CS${c.changesetId}: ${c.comment || 'No comment'}`)
                .join('\n');

            content.push({
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: 'Changesets included:',
                        marks: [{ type: 'strong' }]
                    }
                ]
            });
            content.push({
                type: 'codeBlock',
                content: [
                    {
                        type: 'text',
                        text: changesetLines
                    }
                ]
            });
        }

        const body = {
            body: {
                version: 1,
                type: 'doc',
                content
            }
        };

        await axios.post(`${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`, body, {
            auth: this.auth,
            headers: { 'Content-Type': 'application/json' }
        });

        logger.info(`Comment added to ${issueKey}`);
    }

    async transitionIssue(issueKey) {
        // First, find the transition ID for the target status
        const transitionsResponse = await axios.get(`${this.baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
            auth: this.auth
        });

        const transitions = transitionsResponse.data.transitions || [];
        const target = transitions.find(t => t.name.toLowerCase() === this.toStatus.toLowerCase());

        if (!target) {
            const available = transitions.map(t => t.name).join(', ');
            throw new Error(`Transition to "${this.toStatus}" not available for ${issueKey}. Available: ${available}`);
        }

        await axios.post(`${this.baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
            transition: { id: target.id }
        }, {
            auth: this.auth,
            headers: { 'Content-Type': 'application/json' }
        });

        logger.info(`Transitioned ${issueKey} to "${this.toStatus}"`);
    }

    async assignIssue(issueKey, testerEmail) {
        // Look up the Jira account ID by email
        const accountId = await this.findAccountId(testerEmail);

        await axios.put(`${this.baseUrl}/rest/api/3/issue/${issueKey}/assignee`, {
            accountId
        }, {
            auth: this.auth,
            headers: { 'Content-Type': 'application/json' }
        });

        logger.info(`Assigned ${issueKey} to ${testerEmail}`);
    }

    async findAccountId(email) {
        const response = await axios.get(`${this.baseUrl}/rest/api/3/user/search`, {
            auth: this.auth,
            params: { query: email }
        });

        const users = response.data || [];
        const match = users.find(u => (u.emailAddress || '').toLowerCase() === email.toLowerCase());

        if (!match) {
            throw new Error(`Jira user not found for email: ${email}`);
        }

        return match.accountId;
    }
}

module.exports = JiraService;
