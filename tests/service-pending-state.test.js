/**
 * Focused tests for the "service is starting or stopping" retry/poll logic:
 *   - extractServiceName
 *   - waitForServiceStopped
 *   - manageServices  (pending-state branch only)
 */

// ── Mocks (must come before the SUT is required) ────────────────────────────

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../src/core/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    startStep: jest.fn(),
    completeStep: jest.fn(),
    failStep: jest.fn(),
}));

jest.mock('fs-extra', () => ({
    ensureDir: jest.fn().mockResolvedValue(),
    pathExists: jest.fn().mockResolvedValue(false),
    readFile: jest.fn().mockResolvedValue(''),
}));

// exec is controlled per-test via mockImplementation
jest.mock('child_process', () => ({
    exec: jest.fn(),
    spawn: jest.fn(),
}));

const mockSendNotification = jest.fn().mockResolvedValue({ success: true });
jest.mock('../src/core/notification-service', () =>
    jest.fn().mockImplementation(() => ({ sendNotification: mockSendNotification }))
);

jest.mock('../src/core/d365-environment', () =>
    jest.fn().mockImplementation(() => ({
        detect: jest.fn().mockResolvedValue('cloud'),
        getPaths: jest.fn().mockReturnValue({}),
        getEnvironmentInfo: jest.fn().mockResolvedValue({
            environmentType: 'cloud',
            url: 'https://test.axcloud.dynamics.com',
            name: 'test.axcloud.dynamics.com',
        }),
    }))
);

jest.mock('../src/scripts/tfvc-merge',   () => jest.fn().mockImplementation(() => ({ execute: jest.fn() })));
jest.mock('../src/scripts/build-only',   () => jest.fn().mockImplementation(() => ({ execute: jest.fn() })));
jest.mock('../src/scripts/sync-only',    () => jest.fn().mockImplementation(() => ({ execute: jest.fn() })));
jest.mock('../src/scripts/reports-only', () => jest.fn().mockImplementation(() => ({ execute: jest.fn() })));

// ── Fix util.promisify so execAsync resolves with {stdout, stderr} ───────────
// The real child_process.exec has a util.promisify.custom symbol that makes
// promisify return {stdout, stderr}. The jest.fn() mock doesn't carry that
// symbol, so we attach it here — BEFORE requiring DeploymentPipeline so that
// execAsync = promisify(exec) picks it up at module-load time.
const { exec } = require('child_process');
const { promisify } = require('util');

exec[promisify.custom] = (cmd, opts) =>
    new Promise((resolve, reject) => {
        exec(cmd, opts || {}, (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });

// ── SUT (required after promisify fix is in place) ───────────────────────────
const DeploymentPipeline = require('../src/deployment-pipeline');

// ── Helpers ──────────────────────────────────────────────────────────────────

function setEnv(overrides = {}) {
    Object.assign(process.env, {
        TFVC_COLLECTION_URL: 'https://dev.azure.com/org',
        TFVC_WORKSPACE: 'WS1',
        TFVC_PROJECT_NAME: 'Proj',
        TFVC_USERNAME: 'user',
        TFVC_PAT: 'pat123',
        D365_MODEL: 'TestModel',
        SOURCE_BRANCH: 'Dev',
        TARGET_BRANCH: 'Test',
        NOTIFICATION_ENABLED: 'false',
        ENABLE_SERVICE_CONTROL: 'true',
    }, overrides);
}

function clearEnv() {
    [
        'TFVC_COLLECTION_URL', 'TFVC_WORKSPACE', 'TFVC_PROJECT_NAME',
        'TFVC_USERNAME', 'TFVC_PAT', 'AZURE_PAT', 'TFVC_PASSWORD',
        'D365_MODEL', 'SOURCE_BRANCH', 'TARGET_BRANCH',
        'NOTIFICATION_ENABLED', 'ENABLE_SERVICE_CONTROL',
        'SERVICE_STOP_COMMANDS', 'SERVICE_START_COMMANDS',
        'SUPPRESS_STEP_NOTIFICATIONS',
    ].forEach(k => delete process.env[k]);
}

/** Build an exec mock that dispatches by command pattern */
function makeExec(routes) {
    return (cmd, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; }
        for (const { pattern, error, stdout } of routes) {
            if (pattern.test(cmd)) {
                if (error) {
                    const err = new Error(error);
                    err.stderr = error;
                    return cb(err, '', error);
                }
                return cb(null, stdout || '', '');
            }
        }
        cb(null, '', '');
    };
}

/** sc query stdout for a given state string */
function scQueryOutput(state) {
    return [
        'SERVICE_NAME: DynamicsAxBatch',
        '        TYPE               : 10  WIN32_OWN_PROCESS',
        `        STATE              : 3  ${state}`,
        '',
    ].join('\n');
}

beforeEach(() => {
    jest.clearAllMocks();
    clearEnv();
    setEnv();
});

// ============================================================================
// 1. extractServiceName
// ============================================================================
describe('extractServiceName', () => {
    let pipeline;
    beforeEach(() => { pipeline = new DeploymentPipeline(); });

    test('extracts name from plain net stop command', () => {
        expect(pipeline.extractServiceName('net stop DynamicsAxBatch')).toBe('DynamicsAxBatch');
    });

    test('extracts name from net stop with /y flag', () => {
        expect(pipeline.extractServiceName('net stop DynamicsAxBatch /y')).toBe('DynamicsAxBatch');
    });

    test('extracts name from net start command', () => {
        expect(pipeline.extractServiceName('net start W3SVC')).toBe('W3SVC');
    });

    test('extracts name with leading/trailing whitespace', () => {
        expect(pipeline.extractServiceName('  net stop MR2012ProcessService  ')).toBe('MR2012ProcessService');
    });

    test('returns null for non-net commands', () => {
        expect(pipeline.extractServiceName('iisreset /stop')).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(pipeline.extractServiceName('')).toBeNull();
    });

    test('returns null for null/undefined', () => {
        expect(pipeline.extractServiceName(null)).toBeNull();
        expect(pipeline.extractServiceName(undefined)).toBeNull();
    });
});

// ============================================================================
// 2. waitForServiceStopped — uses fake timers to control the poll loop
// ============================================================================
describe('waitForServiceStopped', () => {
    const POLL_MS = 5_000;
    const MAX_MS  = 10 * 60 * 1000; // 10 min

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('returns true when service is STOPPED on the first poll', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /sc query/i, stdout: scQueryOutput('STOPPED') },
        ]));

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceStopped('DynamicsAxBatch', 'net stop DynamicsAxBatch /y');

        await jest.advanceTimersByTimeAsync(POLL_MS);
        expect(await promise).toBe(true);
    });

    test('returns true when sc query fails (service already gone)', async () => {
        exec.mockImplementation((cmd, opts, cb) => {
            if (typeof opts === 'function') { cb = opts; }
            if (/sc query/i.test(cmd)) {
                cb(new Error('The specified service does not exist'), '', '');
            } else {
                cb(null, '', '');
            }
        });

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceStopped('DynamicsAxBatch', 'net stop DynamicsAxBatch /y');

        await jest.advanceTimersByTimeAsync(POLL_MS);
        expect(await promise).toBe(true);
    });

    test('keeps polling while STOP_PENDING then returns true when STOPPED', async () => {
        let callCount = 0;
        exec.mockImplementation((cmd, opts, cb) => {
            if (typeof opts === 'function') { cb = opts; }
            if (/sc query/i.test(cmd)) {
                callCount++;
                const state = callCount < 3 ? 'STOP_PENDING' : 'STOPPED';
                cb(null, scQueryOutput(state), '');
            } else {
                cb(null, '', '');
            }
        });

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceStopped('DynamicsAxBatch', 'net stop DynamicsAxBatch /y');

        await jest.advanceTimersByTimeAsync(POLL_MS * 3);
        expect(await promise).toBe(true);
        expect(callCount).toBe(3);
    });

    test('returns false when service stays STOP_PENDING past the 10-minute timeout', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /sc query/i, stdout: scQueryOutput('STOP_PENDING') },
        ]));

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceStopped('DynamicsAxBatch', 'net stop DynamicsAxBatch /y');

        await jest.advanceTimersByTimeAsync(MAX_MS + POLL_MS);
        expect(await promise).toBe(false);
    });

    test('throws immediately when service state flips to RUNNING', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /sc query/i, stdout: scQueryOutput('RUNNING') },
        ]));

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceStopped('DynamicsAxBatch', 'net stop DynamicsAxBatch /y');
        // Register a handler immediately so the rejection is never "unhandled"
        // when it fires inside advanceTimersByTimeAsync.
        promise.catch(() => {});

        await jest.advanceTimersByTimeAsync(POLL_MS);
        await expect(promise).rejects.toThrow(/returned to state "RUNNING"/i);
    });

    test('throws immediately when service state is START_PENDING', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /sc query/i, stdout: scQueryOutput('START_PENDING') },
        ]));

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceStopped('DynamicsAxBatch', 'net stop DynamicsAxBatch /y');
        promise.catch(() => {});

        await jest.advanceTimersByTimeAsync(POLL_MS);
        await expect(promise).rejects.toThrow(/returned to state "START_PENDING"/i);
    });
});

// ============================================================================
// 3. manageServices — "starting or stopping" pending-state branch
//
// manageServices(action) reads commands from this.serviceStopCommands /
// this.serviceStartCommands, so we set those directly on the instance.
// waitForServiceStopped is spied on to avoid real timer/exec complexity.
// ============================================================================
describe('manageServices — pending service state', () => {
    const PENDING_ERROR = 'The service is starting or stopping. Please try again later.';

    function setupPipeline(stopCommands) {
        const pipeline = new DeploymentPipeline();
        pipeline.serviceStopCommands = stopCommands;
        pipeline.serviceStartCommands = [];
        return pipeline;
    }

    /** exec mock that fails net stop with the Windows pending-state message */
    function pendingStopExec() {
        return makeExec([
            { pattern: /net stop/i, error: PENDING_ERROR },
        ]);
    }

    test('DynamicsAxBatch: poll returns true (stopped) → succeeds silently, no warning notification', async () => {
        exec.mockImplementation(pendingStopExec());
        const pipeline = setupPipeline(['net stop DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(true);

        await expect(pipeline.manageServices('stop')).resolves.toBeDefined();

        expect(mockSendNotification).not.toHaveBeenCalledWith('warning', expect.anything());
    });

    test('DynamicsAxBatch: poll times out (returns false) → warns, sends Teams warning, does NOT throw', async () => {
        exec.mockImplementation(pendingStopExec());
        const pipeline = setupPipeline(['net stop DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(false);

        await expect(pipeline.manageServices('stop')).resolves.toBeDefined();

        expect(mockSendNotification).toHaveBeenCalledWith('warning', expect.objectContaining({
            warning: expect.stringContaining('DynamicsAxBatch'),
        }));
    });

    test('DynamicsAxBatch: warning notification contains model and branch context', async () => {
        exec.mockImplementation(pendingStopExec());
        const pipeline = setupPipeline(['net stop DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(false);

        await pipeline.manageServices('stop');

        const warningCall = mockSendNotification.mock.calls.find(c => c[0] === 'warning');
        expect(warningCall).toBeDefined();
        const data = warningCall[1];
        expect(data.model).toBe('TestModel');
        expect(data.sourceBranch).toBe('Dev');
        expect(data.targetBranch).toBe('Test');
        expect(data.warning).toMatch(/DynamicsAxBatch/);
    });

    test('DynamicsAxBatch: command is still counted in executed list when poll times out', async () => {
        exec.mockImplementation(pendingStopExec());
        const pipeline = setupPipeline(['net stop DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(false);

        const result = await pipeline.manageServices('stop');
        expect(result.details.commandsExecuted).toHaveLength(1);
    });

    test('non-batch service: poll times out → throws hard error', async () => {
        exec.mockImplementation(pendingStopExec());
        const pipeline = setupPipeline(['net stop W3SVC']);
        jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(false);

        await expect(pipeline.manageServices('stop')).rejects.toThrow(/Stop command failed/i);
        expect(mockSendNotification).not.toHaveBeenCalledWith('warning', expect.anything());
    });

    test('non-batch service: poll returns true → continues without error or warning', async () => {
        exec.mockImplementation(pendingStopExec());
        const pipeline = setupPipeline(['net stop W3SVC']);
        jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(true);

        await expect(pipeline.manageServices('stop')).resolves.toBeDefined();
        expect(mockSendNotification).not.toHaveBeenCalledWith('warning', expect.anything());
    });

    test('multiple services: batch times out (warns+continues), other service stops cleanly', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /net stop DynamicsAxBatch/i, error: PENDING_ERROR },
            // W3SVC succeeds (falls through to default cb(null,'',''))
        ]));
        const pipeline = setupPipeline(['net stop W3SVC', 'net stop DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(false);

        const result = await pipeline.manageServices('stop');

        // Both commands counted (W3SVC succeeded, DynamicsAxBatch warned+continued)
        expect(result.details.commandsExecuted).toHaveLength(2);
        expect(mockSendNotification).toHaveBeenCalledWith('warning', expect.objectContaining({
            warning: expect.stringContaining('DynamicsAxBatch'),
        }));
    });

    test('unrelated stop error (not "starting or stopping") still fails immediately', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /net stop/i, error: 'Access is denied.' },
        ]));
        const pipeline = setupPipeline(['net stop DynamicsAxBatch']);
        const spy = jest.spyOn(pipeline, 'waitForServiceStopped');

        await expect(pipeline.manageServices('stop')).rejects.toThrow(/Access is denied/i);
        expect(spy).not.toHaveBeenCalled();
    });

    test('waitForServiceStopped is called with the correct service name and command', async () => {
        exec.mockImplementation(pendingStopExec());
        const pipeline = setupPipeline(['net stop DynamicsAxBatch']);
        const spy = jest.spyOn(pipeline, 'waitForServiceStopped').mockResolvedValue(true);

        await pipeline.manageServices('stop');

        expect(spy).toHaveBeenCalledWith(
            'DynamicsAxBatch',
            expect.stringContaining('DynamicsAxBatch')
        );
    });
});

// ============================================================================
// 4. manageServices — error 1064 (exception in service) retry logic on start
// ============================================================================
describe('manageServices — error 1064 on start', () => {
    const ERROR_1064 = 'System error 1064 has occurred.\r\nAn exception occurred in the service when handling the control request.';

    function setupStartPipeline(startCommands) {
        const pipeline = new DeploymentPipeline();
        pipeline.serviceStopCommands = [];
        pipeline.serviceStartCommands = startCommands;
        return pipeline;
    }

    test('service recovers on its own (poll returns true) — succeeds without retry', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /net start DynamicsAxBatch/i, error: ERROR_1064 },
        ]));
        const pipeline = setupStartPipeline(['net start DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceRunning').mockResolvedValue(true);

        const result = await pipeline.manageServices('start');
        expect(result.details.commandsExecuted).toHaveLength(1);
    });

    test('retry succeeds after poll returns false — resolves cleanly', async () => {
        let callCount = 0;
        exec.mockImplementation((cmd, opts, cb) => {
            if (typeof opts === 'function') { cb = opts; }
            if (/net start DynamicsAxBatch/i.test(cmd)) {
                callCount++;
                if (callCount === 1) {
                    // First call: fail with 1064
                    const err = new Error(ERROR_1064);
                    err.stderr = ERROR_1064;
                    return cb(err, '', ERROR_1064);
                }
                // Retry: succeed
                return cb(null, 'Service started successfully.', '');
            }
            cb(null, '', '');
        });

        const pipeline = setupStartPipeline(['net start DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceRunning').mockResolvedValue(false);
        jest.useFakeTimers();

        const promise = pipeline.manageServices('start');
        await jest.advanceTimersByTimeAsync(10_000); // skip the 10s retry delay
        const result = await promise;

        jest.useRealTimers();
        expect(result.details.commandsExecuted).toHaveLength(1);
        expect(callCount).toBe(2);
    });

    test('retry also fails — throws with clear retry error message', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /net start DynamicsAxBatch/i, error: ERROR_1064 },
        ]));
        const pipeline = setupStartPipeline(['net start DynamicsAxBatch']);
        jest.spyOn(pipeline, 'waitForServiceRunning').mockResolvedValue(false);
        jest.useFakeTimers();

        const promise = pipeline.manageServices('start');
        // Register the rejection handler before advancing timers so the rejection
        // is never treated as unhandled while the timer fires.
        const assertion = expect(promise).rejects.toThrow(/Start command failed after retry/i);
        await jest.advanceTimersByTimeAsync(10_000);
        await assertion;

        jest.useRealTimers();
    });

    test('waitForServiceRunning is called with the correct service name', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /net start DynamicsAxBatch/i, error: ERROR_1064 },
        ]));
        const pipeline = setupStartPipeline(['net start DynamicsAxBatch']);
        const spy = jest.spyOn(pipeline, 'waitForServiceRunning').mockResolvedValue(true);

        await pipeline.manageServices('start');

        expect(spy).toHaveBeenCalledWith('DynamicsAxBatch');
    });

    test('unrelated start error does not trigger error 1064 path', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /net start DynamicsAxBatch/i, error: 'Access is denied.' },
        ]));
        const pipeline = setupStartPipeline(['net start DynamicsAxBatch']);
        const spy = jest.spyOn(pipeline, 'waitForServiceRunning');

        await expect(pipeline.manageServices('start')).rejects.toThrow(/Access is denied/i);
        expect(spy).not.toHaveBeenCalled();
    });

    test('other services in the list are still started after DynamicsAxBatch recovers', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /net start DynamicsAxBatch/i, error: ERROR_1064 },
            // W3SVC and SSRS fall through to success
        ]));
        const pipeline = setupStartPipeline([
            'net start W3SVC',
            'net start DynamicsAxBatch',
            'net start SQLServerReportingServices',
        ]);
        jest.spyOn(pipeline, 'waitForServiceRunning').mockResolvedValue(true);

        const result = await pipeline.manageServices('start');
        expect(result.details.commandsExecuted).toHaveLength(3);
    });
});

// ============================================================================
// 5. waitForServiceRunning — poll loop behaviour
// ============================================================================
describe('waitForServiceRunning', () => {
    const POLL_MS = 5_000;
    const MAX_MS  = 2 * 60 * 1000; // 2 min

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('returns true immediately when service is RUNNING on first poll', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /sc query/i, stdout: scQueryOutput('RUNNING') },
        ]));

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceRunning('DynamicsAxBatch');

        await jest.advanceTimersByTimeAsync(POLL_MS);
        expect(await promise).toBe(true);
    });

    test('returns false when service is STOPPED on first poll', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /sc query/i, stdout: scQueryOutput('STOPPED') },
        ]));

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceRunning('DynamicsAxBatch');

        await jest.advanceTimersByTimeAsync(POLL_MS);
        expect(await promise).toBe(false);
    });

    test('keeps polling through START_PENDING then returns true when RUNNING', async () => {
        let callCount = 0;
        exec.mockImplementation((cmd, opts, cb) => {
            if (typeof opts === 'function') { cb = opts; }
            if (/sc query/i.test(cmd)) {
                callCount++;
                const state = callCount < 3 ? 'START_PENDING' : 'RUNNING';
                cb(null, scQueryOutput(state), '');
            } else {
                cb(null, '', '');
            }
        });

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceRunning('DynamicsAxBatch');

        await jest.advanceTimersByTimeAsync(POLL_MS * 3);
        expect(await promise).toBe(true);
        expect(callCount).toBe(3);
    });

    test('returns false when service stays START_PENDING past the 2-minute timeout', async () => {
        exec.mockImplementation(makeExec([
            { pattern: /sc query/i, stdout: scQueryOutput('START_PENDING') },
        ]));

        const pipeline = new DeploymentPipeline();
        const promise = pipeline.waitForServiceRunning('DynamicsAxBatch');

        await jest.advanceTimersByTimeAsync(MAX_MS + POLL_MS);
        expect(await promise).toBe(false);
    });
});
