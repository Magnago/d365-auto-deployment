jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../src/core/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('fs-extra', () => ({
    ensureDir: jest.fn().mockResolvedValue(),
    appendFile: jest.fn().mockResolvedValue(),
}));

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: mockSpawn }));

const PowerShellRunner = require('../src/core/powershell-runner');

beforeEach(() => jest.clearAllMocks());

function setupSpawn({ exitCode = 0, stdout = '', stderr = '', error = null, delay = 0 } = {}) {
    mockSpawn.mockImplementation(() => {
        const handlers = {};
        const stdoutHandlers = {};
        const stderrHandlers = {};

        const child = {
            stdout: { on: (evt, cb) => { stdoutHandlers[evt] = cb; } },
            stderr: { on: (evt, cb) => { stderrHandlers[evt] = cb; } },
            on: (evt, cb) => { handlers[evt] = cb; },
            kill: jest.fn(),
        };

        setTimeout(() => {
            if (error) {
                if (handlers.error) handlers.error(error);
                return;
            }
            if (stdout && stdoutHandlers.data) stdoutHandlers.data(Buffer.from(stdout));
            if (stderr && stderrHandlers.data) stderrHandlers.data(Buffer.from(stderr));
            if (handlers.close) handlers.close(exitCode);
        }, delay);

        return child;
    });
}

// ============================================================================
// 1. Successful execution
// ============================================================================
describe('Successful execution', () => {
    test('resolves with exit code 0, stdout, stderr', async () => {
        setupSpawn({ exitCode: 0, stdout: 'hello', stderr: '' });

        const runner = new PowerShellRunner();
        const result = await runner.execute('Write-Host hello');

        expect(result.success).toBe(true);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe('hello');
    });

    test('spawns powershell.exe with -NoProfile and -ExecutionPolicy Bypass', async () => {
        setupSpawn({ exitCode: 0 });

        const runner = new PowerShellRunner();
        await runner.execute('test');

        const args = mockSpawn.mock.calls[0][1];
        expect(args).toContain('-NoProfile');
        expect(args).toContain('-ExecutionPolicy');
        expect(args).toContain('Bypass');
    });
});

// ============================================================================
// 2. Failed execution
// ============================================================================
describe('Failed execution', () => {
    test('rejects when exit code is non-zero and throwOnError=true', async () => {
        setupSpawn({ exitCode: 1, stderr: 'something failed' });

        const runner = new PowerShellRunner();
        await expect(runner.execute('bad-command')).rejects.toThrow(/exit code 1/);
    });

    test('resolves when exit code is non-zero and throwOnError=false', async () => {
        setupSpawn({ exitCode: 1, stderr: 'failed' });

        const runner = new PowerShellRunner();
        const result = await runner.execute('cmd', { throwOnError: false });

        expect(result.success).toBe(false);
        expect(result.code).toBe(1);
    });
});

// ============================================================================
// 3. Process error
// ============================================================================
describe('Process error', () => {
    test('rejects when spawn emits an error event', async () => {
        setupSpawn({ error: new Error('ENOENT: powershell.exe not found') });

        const runner = new PowerShellRunner();
        await expect(runner.execute('test')).rejects.toThrow(/ENOENT/);
    });
});

// ============================================================================
// 4. Credential sanitization
// ============================================================================
describe('Credential sanitization', () => {
    test('masks password values in log output', () => {
        const runner = new PowerShellRunner();
        const sanitized = runner.sanitizeForLogging('$password="secret123"');
        expect(sanitized).not.toContain('secret123');
    });

    test('masks token values', () => {
        const runner = new PowerShellRunner();
        const sanitized = runner.sanitizeForLogging('$token="abc-xyz-123"');
        expect(sanitized).not.toContain('abc-xyz-123');
    });

    test('truncates long scripts', () => {
        const runner = new PowerShellRunner();
        const long = 'x'.repeat(300);
        const sanitized = runner.sanitizeForLogging(long);
        expect(sanitized.length).toBeLessThanOrEqual(203); // 200 + "..."
    });
});

// ============================================================================
// 5. NonInteractive flag
// ============================================================================
describe('NonInteractive flag', () => {
    test('adds -NonInteractive when nonInteractive=true', async () => {
        setupSpawn({ exitCode: 0 });

        const runner = new PowerShellRunner();
        await runner.execute('test', { nonInteractive: true });

        const args = mockSpawn.mock.calls[0][1];
        expect(args).toContain('-NonInteractive');
    });

    test('does not add -NonInteractive by default', async () => {
        setupSpawn({ exitCode: 0 });

        const runner = new PowerShellRunner();
        await runner.execute('test');

        const args = mockSpawn.mock.calls[0][1];
        expect(args).not.toContain('-NonInteractive');
    });
});
