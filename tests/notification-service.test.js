jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../src/core/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const mockAxiosPost = jest.fn().mockResolvedValue({ status: 200 });
jest.mock('axios', () => ({ post: mockAxiosPost }));

const NotificationService = require('../src/core/notification-service');

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TEAMS_WEBHOOK_URL;
    delete process.env.NOTIFICATION_ENABLED;
});

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
// 2. Teams notification payload
// ============================================================================
describe('Teams notification payload', () => {
    test('builds MessageCard with environment URL, model, branches', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('start', {
            environmentUrl: 'https://dev01.axcloud.dynamics.com',
            model: 'NMBPP',
            sourceBranch: 'Dev',
            targetBranch: 'Test',
        });

        expect(payload['@type']).toBe('MessageCard');
        const factNames = payload.sections[0].facts.map(f => f.name);
        expect(factNames).toContain('Environment URL');
        expect(factNames).not.toContain('Environment');
        expect(factNames).toContain('Model');
        expect(factNames).toContain('Source Branch');
        expect(factNames).toContain('Target Branch');
        expect(factNames).toContain('Timestamp');
    });

    test('failure payload includes Failed Step and Error', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('failure', {
            model: 'NMBPP',
            failedStep: 'Build',
            error: 'xppc.exe failed',
        });

        const factNames = payload.sections[0].facts.map(f => f.name);
        expect(factNames).toContain('Failed Step');
        expect(factNames).toContain('Error');
    });

    test('omits Environment URL when not provided', () => {
        const svc = new NotificationService();
        const payload = svc.buildTeamsMessage('start', { model: 'M' });

        const factNames = payload.sections[0].facts.map(f => f.name);
        expect(factNames).not.toContain('Environment URL');
    });
});

// ============================================================================
// 3. Theme colors
// ============================================================================
describe('Theme colors', () => {
    test('start = blue, success = green, failure = red', () => {
        const svc = new NotificationService();
        expect(svc.getThemeColor('start')).toBe('0078D4');
        expect(svc.getThemeColor('success')).toBe('107C10');
        expect(svc.getThemeColor('failure')).toBe('D13438');
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
        const long = 'x'.repeat(500);
        const trimmed = svc.trim(long, 300);
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

    test('posts to configured webhook URL', async () => {
        process.env.TEAMS_WEBHOOK_URL = 'https://outlook.office.com/webhook/test';
        const svc = new NotificationService();
        await svc.sendToTeams('start', { model: 'M' }, {});

        expect(mockAxiosPost).toHaveBeenCalledWith(
            'https://outlook.office.com/webhook/test',
            expect.any(Object),
            expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
        );
    });
});
