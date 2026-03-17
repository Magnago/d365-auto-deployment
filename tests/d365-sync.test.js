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

const mockPsExecute = jest.fn();
jest.mock('../src/core/powershell-runner', () => {
    return jest.fn().mockImplementation(() => ({
        execute: mockPsExecute,
    }));
});

jest.mock('../src/core/d365-environment', () => {
    return jest.fn().mockImplementation(() => ({
        detect: jest.fn().mockResolvedValue('cloud'),
        getPaths: jest.fn().mockReturnValue({
            packages: 'K:\\AosService\\PackagesLocalDirectory',
            binPath: 'K:\\AosService\\PackagesLocalDirectory\\bin',
            webRoot: 'K:\\AosService\\webroot',
        }),
    }));
});

const mockPathExists = jest.fn().mockResolvedValue(true);
jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
}));

const D365Sync = require('../src/modules/d365-sync');

beforeEach(() => jest.clearAllMocks());

// ============================================================================
// 1. Successful sync
// ============================================================================
describe('Successful sync', () => {
    test('calls SyncEngine.exe with fullall mode', async () => {
        mockPsExecute.mockResolvedValue({
            code: 0, success: true, stdout: 'Sync complete', stderr: '', executionTime: 30000,
        });

        const sync = new D365Sync();
        const result = await sync.performFullSync();

        expect(result.success).toBe(true);
        expect(result.syncMode).toBe('full');
        expect(result.environmentType).toBe('cloud');

        const command = mockPsExecute.mock.calls[0][0];
        expect(command).toContain('SyncEngine.exe');
        expect(command).toContain('-syncmode=fullall');
        expect(command).toContain('AxDB');
    });
});

// ============================================================================
// 2. Sync failure
// ============================================================================
describe('Sync failure', () => {
    test('throws when SyncEngine.exe fails', async () => {
        mockPsExecute.mockRejectedValue(
            new Error('PowerShell command failed with exit code 1: Schema sync error')
        );

        const sync = new D365Sync();
        await expect(sync.performFullSync()).rejects.toThrow(/Schema sync error/);
    });
});

// ============================================================================
// 3. Missing SyncEngine.exe
// ============================================================================
describe('Missing prerequisites', () => {
    test('throws when SyncEngine.exe does not exist', async () => {
        mockPathExists.mockImplementation((p) => {
            return Promise.resolve(!p.endsWith('SyncEngine.exe'));
        });

        const sync = new D365Sync();
        await expect(sync.performFullSync()).rejects.toThrow(/sync prerequisite not found.*SyncEngine/i);
    });
});
