const path = require('path');

// --- Stubs & spies set up before requiring the SUT -------------------------

// Prevent dotenv from touching the real .env
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Logger — silent during tests
jest.mock('../src/core/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    startStep: jest.fn(),
    completeStep: jest.fn(),
    failStep: jest.fn(),
}));

// fs-extra — stub ensureDir so no disk I/O
jest.mock('fs-extra', () => ({
    ensureDir: jest.fn().mockResolvedValue(),
    pathExists: jest.fn().mockResolvedValue(false),
    readFile: jest.fn().mockResolvedValue(''),
}));

// child_process.exec — stub service commands
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; }
        cb(null, { stdout: '', stderr: '' });
    }),
    spawn: jest.fn(),
}));

// Notification service — spy
const mockSendNotification = jest.fn().mockResolvedValue({ success: true });
jest.mock('../src/core/notification-service', () => {
    return jest.fn().mockImplementation(() => ({
        sendNotification: mockSendNotification,
    }));
});

// D365Environment — stub
jest.mock('../src/core/d365-environment', () => {
    return jest.fn().mockImplementation(() => ({
        detect: jest.fn().mockResolvedValue('cloud'),
        getPaths: jest.fn().mockReturnValue({
            aosService: 'K:\\AosService',
            packages: 'K:\\AosService\\PackagesLocalDirectory',
            webRoot: 'K:\\AosService\\webroot',
            binPath: 'K:\\AosService\\PackagesLocalDirectory\\bin',
        }),
        getEnvironmentInfo: jest.fn().mockResolvedValue({
            environmentType: 'cloud',
            url: 'https://dev01.axcloud.dynamics.com',
            name: 'dev01.axcloud.dynamics.com',
        }),
    }));
});

// Step runners — each returns a resolved execute()
const mockTfvcExecute = jest.fn();
const mockBuildExecute = jest.fn();
const mockSyncExecute = jest.fn();
const mockReportsExecute = jest.fn();

jest.mock('../src/scripts/tfvc-merge', () => {
    return jest.fn().mockImplementation(() => ({ execute: mockTfvcExecute }));
});
jest.mock('../src/scripts/build-only', () => {
    return jest.fn().mockImplementation(() => ({ execute: mockBuildExecute }));
});
jest.mock('../src/scripts/sync-only', () => {
    return jest.fn().mockImplementation(() => ({ execute: mockSyncExecute }));
});
jest.mock('../src/scripts/reports-only', () => {
    return jest.fn().mockImplementation(() => ({ execute: mockReportsExecute }));
});

// --- Helpers ----------------------------------------------------------------

function setEnv(overrides = {}) {
    const defaults = {
        TFVC_COLLECTION_URL: 'https://dev.azure.com/org/DefaultCollection',
        TFVC_WORKSPACE: 'WS1',
        TFVC_PROJECT_NAME: 'Proj',
        TFVC_USERNAME: 'user',
        TFVC_PAT: 'pat123',
        D365_MODEL: 'TestModel',
        SOURCE_BRANCH: 'Dev',
        TARGET_BRANCH: 'Test',
        NOTIFICATION_ENABLED: 'false',
        ENABLE_SERVICE_CONTROL: 'false',
    };
    Object.assign(process.env, defaults, overrides);
}

function clearEnv() {
    const keys = [
        'TFVC_COLLECTION_URL', 'TFVC_WORKSPACE', 'TFVC_PROJECT_NAME',
        'TFVC_USERNAME', 'TFVC_PAT', 'AZURE_PAT', 'TFVC_PASSWORD',
        'D365_MODEL', 'SOURCE_BRANCH', 'TARGET_BRANCH',
        'NOTIFICATION_ENABLED', 'ENABLE_SERVICE_CONTROL',
        'ENABLE_TFVC_STEP', 'ENABLE_BUILD_STEP', 'ENABLE_SYNC_STEP',
        'ENABLE_REPORTS_STEP', 'SKIP_TFVC_MERGE_OPERATIONS',
        'SERVICE_STOP_COMMANDS', 'SERVICE_START_COMMANDS',
        'SUPPRESS_STEP_NOTIFICATIONS',
    ];
    keys.forEach(k => delete process.env[k]);
}

// --- SUT import (after mocks) -----------------------------------------------

const DeploymentPipeline = require('../src/deployment-pipeline');

// --- Tests ------------------------------------------------------------------

beforeEach(() => {
    jest.clearAllMocks();
    clearEnv();
    setEnv();
});

// ============================================================================
// 1. Happy-path full pipeline
// ============================================================================
describe('Full pipeline — happy path', () => {
    test('runs all steps in order and sends start + success notifications', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true,
            message: 'merged',
            details: { hasChanges: true, changeset: 12345 },
        });
        mockBuildExecute.mockResolvedValue({ success: true, message: 'built' });
        mockSyncExecute.mockResolvedValue({ success: true, message: 'synced' });
        mockReportsExecute.mockResolvedValue({ success: true, message: 'reports done' });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.success).toBe(true);
        expect(mockTfvcExecute).toHaveBeenCalledTimes(1);
        expect(mockBuildExecute).toHaveBeenCalledTimes(1);
        expect(mockSyncExecute).toHaveBeenCalledTimes(1);
        expect(mockReportsExecute).toHaveBeenCalledTimes(1);

        // Start + success = 2 notifications
        const notifCalls = mockSendNotification.mock.calls;
        expect(notifCalls[0][0]).toBe('start');
        expect(notifCalls[notifCalls.length - 1][0]).toBe('success');
    });

    test('results contain timing, deployment id, and model info', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.deploymentId).toMatch(/^DEPLOY-/);
        expect(results.model).toBe('TestModel');
        expect(results.totalDuration).toBeGreaterThanOrEqual(0);
        expect(results.startTime).toBeDefined();
        expect(results.endTime).toBeDefined();
    });
});

// ============================================================================
// 2. Environment URL in notifications
// ============================================================================
describe('Environment info in notifications', () => {
    test('Teams notification data includes environmentUrl and environmentName', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        await pipeline.execute();

        // Every notification should contain env info
        for (const [, data] of mockSendNotification.mock.calls) {
            expect(data.environmentUrl).toBe('https://dev01.axcloud.dynamics.com');
            expect(data.environmentName).toBe('dev01.axcloud.dynamics.com');
        }
    });
});

// ============================================================================
// 3. No changes after merge — early stop
// ============================================================================
describe('No changes after merge', () => {
    test('stops pipeline early without running build/sync/reports', async () => {
        setEnv({ SKIP_TFVC_MERGE_OPERATIONS: 'false' });

        mockTfvcExecute.mockResolvedValue({
            success: true,
            message: 'No changes to merge',
            details: { hasChanges: false },
        });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.hasChanges).toBe(false);
        expect(results.message).toMatch(/no changes/i);
        expect(mockBuildExecute).not.toHaveBeenCalled();
        expect(mockSyncExecute).not.toHaveBeenCalled();
        expect(mockReportsExecute).not.toHaveBeenCalled();

        // Should still send success notification
        const types = mockSendNotification.mock.calls.map(c => c[0]);
        expect(types).toContain('success');
    });

    test('proceeds with build/sync/reports when skipTfvcMergeOperations is true even if hasChanges is absent', async () => {
        setEnv({ SKIP_TFVC_MERGE_OPERATIONS: 'true' });

        mockTfvcExecute.mockResolvedValue({
            success: true,
            message: 'target refreshed',
            details: { hasChanges: true, skipped: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.success).toBe(true);
        expect(mockBuildExecute).toHaveBeenCalledTimes(1);
    });
});

// ============================================================================
// 4. TFVC step failure — services restarted, failure notification sent
// ============================================================================
describe('TFVC step failure (e.g. conflicts)', () => {
    test('stops pipeline, restarts services, sends failure notification', async () => {
        mockTfvcExecute.mockRejectedValue(
            new Error('1 conflict(s) detected while getting latest on target branch')
        );

        const pipeline = new DeploymentPipeline();

        await expect(pipeline.execute()).rejects.toThrow(/conflict/i);

        expect(mockBuildExecute).not.toHaveBeenCalled();
        expect(mockSyncExecute).not.toHaveBeenCalled();
        expect(mockReportsExecute).not.toHaveBeenCalled();

        const types = mockSendNotification.mock.calls.map(c => c[0]);
        expect(types).toContain('failure');

        const failureCall = mockSendNotification.mock.calls.find(c => c[0] === 'failure');
        expect(failureCall[1].error).toMatch(/conflict/i);
        expect(failureCall[1].failedStep).toBeDefined();
    });
});

// ============================================================================
// 5. Build step failure — stops before sync/reports
// ============================================================================
describe('Build step failure', () => {
    test('stops pipeline after build fails, does not run sync or reports', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockRejectedValue(new Error('xppc.exe compilation error'));

        const pipeline = new DeploymentPipeline();

        await expect(pipeline.execute()).rejects.toThrow(/xppc/i);

        expect(mockSyncExecute).not.toHaveBeenCalled();
        expect(mockReportsExecute).not.toHaveBeenCalled();

        const types = mockSendNotification.mock.calls.map(c => c[0]);
        expect(types).toContain('failure');
    });
});

// ============================================================================
// 6. Sync step failure — stops before reports
// ============================================================================
describe('Sync step failure', () => {
    test('stops pipeline after sync fails, does not run reports', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockRejectedValue(new Error('SyncEngine failed'));

        const pipeline = new DeploymentPipeline();

        await expect(pipeline.execute()).rejects.toThrow(/SyncEngine/);

        expect(mockReportsExecute).not.toHaveBeenCalled();

        const types = mockSendNotification.mock.calls.map(c => c[0]);
        expect(types).toContain('failure');
    });
});

// ============================================================================
// 7. Reports step failure
// ============================================================================
describe('Reports step failure', () => {
    test('pipeline fails with failure notification', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockRejectedValue(new Error('SSRS deployment error'));

        const pipeline = new DeploymentPipeline();

        await expect(pipeline.execute()).rejects.toThrow(/SSRS/);

        const types = mockSendNotification.mock.calls.map(c => c[0]);
        expect(types).toContain('failure');
    });
});

// ============================================================================
// 8. Step enable/disable flags
// ============================================================================
describe('Step enable/disable flags', () => {
    test('disabling TFVC skips merge entirely', async () => {
        setEnv({ ENABLE_TFVC_STEP: 'false' });

        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.success).toBe(true);
        expect(mockTfvcExecute).not.toHaveBeenCalled();
    });

    test('disabling build skips build', async () => {
        setEnv({ ENABLE_BUILD_STEP: 'false' });

        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.success).toBe(true);
        expect(mockBuildExecute).not.toHaveBeenCalled();
    });

    test('disabling sync skips sync', async () => {
        setEnv({ ENABLE_SYNC_STEP: 'false' });

        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.success).toBe(true);
        expect(mockSyncExecute).not.toHaveBeenCalled();
    });

    test('disabling reports skips reports', async () => {
        setEnv({ ENABLE_REPORTS_STEP: 'false' });

        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        const results = await pipeline.execute();

        expect(results.success).toBe(true);
        expect(mockReportsExecute).not.toHaveBeenCalled();
    });
});

// ============================================================================
// 9. Notification payload completeness
// ============================================================================
describe('Notification payload completeness', () => {
    test('success notification includes executionTime, environmentUrl, model, and branches', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        await pipeline.execute();

        const successCall = mockSendNotification.mock.calls.find(c => c[0] === 'success');
        expect(successCall).toBeDefined();
        const data = successCall[1];
        expect(data.executionTime).toBeGreaterThanOrEqual(0);
        expect(data.environmentUrl).toBe('https://dev01.axcloud.dynamics.com');
        expect(data.model).toBe('TestModel');
        expect(data.sourceBranch).toBe('Dev');
        expect(data.targetBranch).toBe('Test');
    });

    test('failure notification includes executionTime, failedStep, error, and environment info', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockRejectedValue(new Error('xppc.exe compilation error'));

        const pipeline = new DeploymentPipeline();
        await pipeline.execute().catch(() => {});

        const failureCall = mockSendNotification.mock.calls.find(c => c[0] === 'failure');
        expect(failureCall).toBeDefined();
        const data = failureCall[1];
        expect(data.executionTime).toBeGreaterThanOrEqual(0);
        expect(data.failedStep).toBeDefined();
        expect(data.error).toMatch(/xppc/i);
        expect(data.environmentUrl).toBe('https://dev01.axcloud.dynamics.com');
        expect(data.model).toBe('TestModel');
        expect(data.sourceBranch).toBe('Dev');
        expect(data.targetBranch).toBe('Test');
    });

    test('start notification does NOT include executionTime', async () => {
        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        await pipeline.execute();

        const startCall = mockSendNotification.mock.calls.find(c => c[0] === 'start');
        expect(startCall).toBeDefined();
        expect(startCall[1].executionTime).toBeUndefined();
    });
});

// ============================================================================
// 10. Configuration validation
// ============================================================================
describe('Configuration validation', () => {
    test('throws when required env vars are missing', () => {
        clearEnv();
        const pipeline = new DeploymentPipeline();
        expect(() => pipeline.validateConfiguration()).toThrow(/Missing required/);
    });

    test('passes when all required env vars are present', () => {
        setEnv();
        const pipeline = new DeploymentPipeline();
        expect(() => pipeline.validateConfiguration()).not.toThrow();
    });

    test('requires at least one credential (PAT or password)', () => {
        clearEnv();
        setEnv({ TFVC_PAT: '', AZURE_PAT: '', TFVC_PASSWORD: '' });
        // Force-clear all credential env vars
        delete process.env.TFVC_PAT;
        delete process.env.AZURE_PAT;
        delete process.env.TFVC_PASSWORD;
        const pipeline = new DeploymentPipeline();
        expect(() => pipeline.validateConfiguration()).toThrow(/TFVC_PAT or AZURE_PAT or TFVC_PASSWORD/);
    });
});

// ============================================================================
// 10. Service control
// ============================================================================
describe('Service control', () => {
    const { exec } = require('child_process');

    test('services are not called when ENABLE_SERVICE_CONTROL=false', async () => {
        setEnv({ ENABLE_SERVICE_CONTROL: 'false' });

        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        await pipeline.execute();

        expect(exec).not.toHaveBeenCalled();
    });

    test('stop commands get /y appended for net stop', () => {
        setEnv();
        const pipeline = new DeploymentPipeline();
        expect(pipeline.prepareServiceCommand('net stop W3SVC', 'stop')).toBe('net stop W3SVC /y');
        expect(pipeline.prepareServiceCommand('net stop W3SVC /y', 'stop')).toBe('net stop W3SVC /y');
        expect(pipeline.prepareServiceCommand('iisreset /stop', 'stop')).toBe('iisreset /stop');
    });

    test('non-fatal "already stopped" errors are ignored', () => {
        setEnv();
        const pipeline = new DeploymentPipeline();
        expect(pipeline.getNonFatalServiceError('stop', 'The service has not been started.')).toBe('already stopped');
        expect(pipeline.getNonFatalServiceError('start', 'The service has already been started.')).toBe('already running');
        expect(pipeline.getNonFatalServiceError('stop', 'Access denied')).toBeNull();
    });
});

// ============================================================================
// 11. Deployment ID generation
// ============================================================================
describe('Deployment ID', () => {
    test('generates unique IDs', () => {
        const p1 = new DeploymentPipeline();
        const p2 = new DeploymentPipeline();
        expect(p1.deploymentId).toMatch(/^DEPLOY-/);
        expect(p1.deploymentId).not.toBe(p2.deploymentId);
    });
});

// ============================================================================
// 12. SUPPRESS_STEP_NOTIFICATIONS is restored after execute()
// ============================================================================
describe('SUPPRESS_STEP_NOTIFICATIONS cleanup', () => {
    test('restores original value after successful run', async () => {
        setEnv();
        delete process.env.SUPPRESS_STEP_NOTIFICATIONS;

        mockTfvcExecute.mockResolvedValue({
            success: true, message: 'ok',
            details: { hasChanges: true },
        });
        mockBuildExecute.mockResolvedValue({ success: true });
        mockSyncExecute.mockResolvedValue({ success: true });
        mockReportsExecute.mockResolvedValue({ success: true });

        const pipeline = new DeploymentPipeline();
        await pipeline.execute();

        expect(process.env.SUPPRESS_STEP_NOTIFICATIONS).toBeUndefined();
    });

    test('restores original value after failed run', async () => {
        setEnv();
        process.env.SUPPRESS_STEP_NOTIFICATIONS = 'original';

        mockTfvcExecute.mockRejectedValue(new Error('fail'));

        const pipeline = new DeploymentPipeline();
        await pipeline.execute().catch(() => {});

        expect(process.env.SUPPRESS_STEP_NOTIFICATIONS).toBe('original');
    });
});
