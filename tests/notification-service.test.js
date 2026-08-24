jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../src/core/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const mockAxiosPost = jest.fn().mockResolvedValue({ status: 202, data: '' });
jest.mock('axios', () => ({ post: mockAxiosPost }));

const NotificationService = require('../src/core/notification-service');
const logger = require('../src/core/logger');

const WORKFLOW_URL = 'https://contoso.environment.api.powerplatform.com/powerautomate/automations/direct/cu/04/workflows/abc/triggers/manual/paths/invoke?sig=x';

beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ status: 202, data: '' });
    delete process.env.TEAMS_WEBHOOK_URL;
    delete process.env.NOTIFICATION_ENABLED;
    delete process.env.TEAMS_REQUEST_TIMEOUT_MS;
});

function cardOf(payload) {
    return payload.attachments[0].content;
}

function factTitles(payload) {
    const factSet = cardOf(payload).body.find(b => b.type === 'FactSet');
    return factSet.facts.map(f => f.title);
}

// ============================================================================
// 1. Notifications disabled
// ============================================================================
describe('Notifications disabled', () => {
    test('skips sending when NOTIFICATION_ENABLED is not true', async () => {
        process.env.NOTIFICATION_ENABLED = 'false';
        const svc = new NotificationService();
        const result = await svc.sendNotification('start', {});
        expect(result.skipped).toBe(true);
        expect(mockAxiosPost).not.toHaveBeenCalled();
    });
});

// ============================================================================
// 2. Adaptive Card payload (Teams Workflows transport)
// ============================================================================
describe('Teams notification payload', () => {
    test('wraps an Adaptive Card in the Workflows message envelope', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('start', { model: 'NMBPP' });

        expect(payload.type).toBe('message');
        expect(payload.attachments).toHaveLength(1);
        expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
        expect(cardOf(payload).type).toBe('AdaptiveCard');
        // MessageCard is the retired connector format and must not come back.
        expect(payload['@type']).toBeUndefined();
    });

    test('includes environment URL, model and branches as facts', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('start', {
            environmentUrl: 'https://dev01.axcloud.dynamics.com',
            model: 'NMBPP',
            sourceBranch: 'Dev',
            targetBranch: 'Test',
        });

        const titles = factTitles(payload);
        expect(titles).toContain('Environment URL');
        expect(titles).not.toContain('Environment');
        expect(titles).toContain('Model');
        expect(titles).toContain('Source Branch');
        expect(titles).toContain('Target Branch');
        expect(titles).toContain('Timestamp');
    });

    test('adds an Open environment action when an environment URL is present', () => {
        const svc = new NotificationService();
        const withUrl = svc.buildTeamsMessage('success', { environmentUrl: 'https://env.example.com' });
        const withoutUrl = svc.buildTeamsMessage('success', { model: 'M' });

        expect(cardOf(withUrl).actions).toEqual([
            { type: 'Action.OpenUrl', title: 'Open environment', url: 'https://env.example.com' },
        ]);
        expect(cardOf(withoutUrl).actions).toBeUndefined();
    });

    test('failure payload keeps Failed Step as a fact and error text as a block', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('failure', {
            model: 'NMBPP',
            failedStep: 'Pre-flight Build Check',
            error: 'X++ build failed for NMBPP with 13 error(s)',
        });

        expect(factTitles(payload)).toContain('Failed Step');

        const texts = cardOf(payload).body.filter(b => b.type === 'TextBlock').map(b => b.text);
        expect(texts).toContain('Error details');
        expect(texts).toContain('X++ build failed for NMBPP with 13 error(s)');
    });

    test('failure cards allow longer diagnostics than the old 300-char fact limit', () => {
        const svc = new NotificationService();
        const longError = 'e'.repeat(1500);

        const withLogs = svc.buildTeamsMessage('failure', { error: longError }, { includeLogs: true });
        const withoutLogs = svc.buildTeamsMessage('failure', { error: longError }, { includeLogs: false });

        const textOf = payload => cardOf(payload).body.filter(b => b.fontType === 'Monospace')[0].text;
        expect(textOf(withLogs)).toHaveLength(1500);
        expect(textOf(withoutLogs)).toHaveLength(600);
    });

    test('omits Environment URL when not provided', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('start', { model: 'M' });
        expect(factTitles(payload)).not.toContain('Environment URL');
    });

    test('includeDetails=false leaves only the timestamp', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('start', { model: 'M' }, { includeDetails: false });
        expect(factTitles(payload)).toEqual(['Timestamp']);
    });
});

// ============================================================================
// 3. Card colors
// ============================================================================
describe('Card colors', () => {
    test('maps each type to an Adaptive Card color', () => {
        const svc = new NotificationService();
        expect(svc.getCardColor('start')).toBe('Accent');
        expect(svc.getCardColor('success')).toBe('Good');
        expect(svc.getCardColor('failure')).toBe('Attention');
        expect(svc.getCardColor('warning')).toBe('Warning');
    });
});

// ============================================================================
// 4. Duration formatting
// ============================================================================
describe('Duration formatting', () => {
    test('formats seconds only', () => {
        const svc = new NotificationService();
        expect(svc.formatDuration(45000)).toBe('45s');
    });

    test('formats minutes + seconds', () => {
        const svc = new NotificationService();
        expect(svc.formatDuration(125000)).toBe('2m 5s');
    });

    test('formats hours + minutes + seconds', () => {
        const svc = new NotificationService();
        expect(svc.formatDuration(3661000)).toBe('1h 1m 1s');
    });
});

// ============================================================================
// 5. Error trimming
// ============================================================================
describe('Error trimming', () => {
    test('truncates long error messages', () => {
        const svc = new NotificationService();
        const trimmed = svc.trim('x'.repeat(500), 300);
        expect(trimmed.length).toBe(300);
        expect(trimmed).toMatch(/\.\.\.$/);
    });

    test('leaves short messages unchanged', () => {
        const svc = new NotificationService();
        expect(svc.trim('short', 300)).toBe('short');
    });
});

// ============================================================================
// 6. Webhook URL validation
// ============================================================================
describe('Webhook URL validation', () => {
    test('throws when webhook URL is not configured', async () => {
        const svc = new NotificationService();
        await expect(svc.sendToTeams('start', {}, {})).rejects.toThrow(/webhook URL not configured/);
    });

    test('rejects retired Office 365 connector hosts instead of posting into the void', async () => {
        process.env.TEAMS_WEBHOOK_URL = 'https://nmbsolution.webhook.office.com/webhookb2/abc/IncomingWebhook/def';
        const svc = new NotificationService();

        await expect(svc.sendToTeams('start', {}, {})).rejects.toThrow(/retired Office 365 connector/);
        expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    test('rejects the legacy outlook.office.com host too', async () => {
        process.env.TEAMS_WEBHOOK_URL = 'https://outlook.office.com/webhook/test';
        const svc = new NotificationService();
        await expect(svc.sendToTeams('start', {}, {})).rejects.toThrow(/retired Office 365 connector/);
    });

    test('rejects a malformed URL', async () => {
        process.env.TEAMS_WEBHOOK_URL = 'not-a-url';
        const svc = new NotificationService();
        await expect(svc.sendToTeams('start', {}, {})).rejects.toThrow(/not a valid URL/);
    });

    test('posts to a Workflows webhook URL', async () => {
        process.env.TEAMS_WEBHOOK_URL = WORKFLOW_URL;
        const svc = new NotificationService();
        const result = await svc.sendToTeams('start', { model: 'M' }, {});

        expect(mockAxiosPost).toHaveBeenCalledWith(
            WORKFLOW_URL,
            expect.objectContaining({ type: 'message' }),
            expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
        );
        expect(result).toMatchObject({ success: true, status: 202 });
    });
});

// ============================================================================
// 7. Delivery verification
// ============================================================================
describe('Delivery verification', () => {
    beforeEach(() => {
        process.env.TEAMS_WEBHOOK_URL = WORKFLOW_URL;
    });

    test('accepts 200, 201, 202 and 204', async () => {
        const svc = new NotificationService();
        for (const status of [200, 201, 202, 204]) {
            mockAxiosPost.mockResolvedValueOnce({ status, data: '' });
            await expect(svc.sendToTeams('start', {}, {})).resolves.toMatchObject({ status });
        }
    });

    test('treats an unexpected 2xx-adjacent status as a failure', async () => {
        mockAxiosPost.mockResolvedValueOnce({ status: 299, data: 'weird' });
        const svc = new NotificationService();
        await expect(svc.sendToTeams('start', {}, {})).rejects.toThrow(/unexpected HTTP 299/);
    });

    test('surfaces the HTTP status and body when the webhook rejects the post', async () => {
        mockAxiosPost.mockRejectedValueOnce({
            response: { status: 403, data: { message: 'Forbidden' } },
            message: 'Request failed with status code 403',
        });
        const svc = new NotificationService();
        await expect(svc.sendToTeams('start', {}, {})).rejects.toThrow(/HTTP 403 — {"message":"Forbidden"}/);
    });

    test('surfaces transport errors that carry no response', async () => {
        mockAxiosPost.mockRejectedValueOnce({ message: 'timeout of 10000ms exceeded' });
        const svc = new NotificationService();
        await expect(svc.sendToTeams('start', {}, {})).rejects.toThrow(/request failed: timeout/);
    });

    test('logs the webhook status so a silently-dropping endpoint is visible', async () => {
        mockAxiosPost.mockResolvedValueOnce({ status: 202, data: '' });
        const svc = new NotificationService();
        await svc.sendToTeams('success', {}, {});

        expect(logger.debug).toHaveBeenCalledWith(
            'Teams webhook response',
            expect.objectContaining({ status: 202 })
        );
    });

    test('honours TEAMS_REQUEST_TIMEOUT_MS', async () => {
        process.env.TEAMS_REQUEST_TIMEOUT_MS = '2500';
        const svc = new NotificationService();
        await svc.sendToTeams('start', {}, {});

        expect(mockAxiosPost).toHaveBeenCalledWith(
            WORKFLOW_URL,
            expect.any(Object),
            expect.objectContaining({ timeout: 2500 })
        );
    });
});

// ============================================================================
// 8. sendNotification reporting
// ============================================================================
describe('sendNotification reporting', () => {
    test('logs an error when no channel could deliver', async () => {
        process.env.NOTIFICATION_ENABLED = 'true';
        process.env.TEAMS_WEBHOOK_URL = 'https://nmbsolution.webhook.office.com/webhookb2/a/IncomingWebhook/b';
        const svc = new NotificationService();

        const result = await svc.sendNotification('success', {});

        expect(result.success).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(
            'No success notification could be delivered',
            expect.any(Object)
        );
    });

    test('reports success with the accepted status', async () => {
        process.env.NOTIFICATION_ENABLED = 'true';
        process.env.TEAMS_WEBHOOK_URL = WORKFLOW_URL;
        const svc = new NotificationService();

        const result = await svc.sendNotification('success', { model: 'M' });

        expect(result.success).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(
            'Successfully sent success notifications',
            expect.objectContaining({ channels: ['teams'], statuses: [202] })
        );
    });
});
