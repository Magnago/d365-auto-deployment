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

const mockDetect = jest.fn().mockResolvedValue('cloud');
const mockGetPaths = jest.fn().mockReturnValue({
    packages: 'K:\\AosService\\PackagesLocalDirectory',
    binPath: 'K:\\AosService\\PackagesLocalDirectory\\bin',
    webRoot: 'K:\\AosService\\webroot',
});
jest.mock('../src/core/d365-environment', () => {
    return jest.fn().mockImplementation(() => ({
        detect: mockDetect,
        getPaths: mockGetPaths,
    }));
});

const mockPathExists = jest.fn().mockResolvedValue(true);
jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
}));

const D365Build = require('../src/modules/d365-build');

beforeEach(() => {
    jest.clearAllMocks();
    process.env.D365_MODEL = 'TestModel';
});

// ============================================================================
// 1. Successful build
// ============================================================================
describe('Successful build', () => {
    test('calls labelc.exe then xppc.exe with correct arguments', async () => {
        mockPsExecute.mockResolvedValue({
            code: 0, success: true, stdout: 'Build succeeded', stderr: '', executionTime: 5000,
        });

        const build = new D365Build();
        const result = await build.buildModel('TestModel');

        expect(result.success).toBe(true);
        expect(result.model).toBe('TestModel');
        expect(result.environmentType).toBe('cloud');
        expect(result.labelBuild).toEqual({ success: true, executionTime: 5000 });

        expect(mockPsExecute).toHaveBeenCalledTimes(2);

        const labelCommand = mockPsExecute.mock.calls[0][0];
        expect(labelCommand).toContain('labelc.exe');
        expect(labelCommand).toContain('-modelmodule="TestModel"');
        expect(labelCommand).toContain('-metadata="K:\\AosService\\PackagesLocalDirectory"');
        expect(labelCommand).toContain('-output="K:\\AosService\\PackagesLocalDirectory\\TestModel"');
        expect(labelCommand).not.toContain('-xmllog');
        expect(labelCommand).not.toContain('-verbose');

        const xppcCommand = mockPsExecute.mock.calls[1][0];
        expect(xppcCommand).toContain('xppc.exe');
        expect(xppcCommand).toContain('TestModel');
        expect(xppcCommand).toContain('-verbose');
    });

});

// ============================================================================
// 2. Build failure
// ============================================================================
describe('Build failure', () => {
    test('throws when PowerShell exits with non-zero code', async () => {
        mockPsExecute.mockRejectedValue(
            new Error('PowerShell command failed with exit code 1: Compilation errors detected')
        );

        const build = new D365Build();
        await expect(build.buildModel('TestModel')).rejects.toThrow(/Compilation errors/);
    });
});

// ============================================================================
// 3. Missing prerequisites
// ============================================================================
describe('Missing prerequisites', () => {
    test('throws when xppc.exe does not exist', async () => {
        mockPathExists.mockImplementation((p) => {
            return Promise.resolve(!p.endsWith('xppc.exe'));
        });

        const build = new D365Build();
        await expect(build.buildModel('TestModel')).rejects.toThrow(/Build prerequisite not found.*xppc\.exe/);
    });

    test('throws when labelc.exe does not exist', async () => {
        mockPathExists.mockImplementation((p) => {
            return Promise.resolve(!p.endsWith('labelc.exe'));
        });

        const build = new D365Build();
        await expect(build.buildModel('TestModel')).rejects.toThrow(/Build prerequisite not found.*labelc\.exe/);
    });

    test('throws when model directory does not exist', async () => {
        mockPathExists.mockImplementation((p) => {
            return Promise.resolve(!p.endsWith('TestModel'));
        });

        const build = new D365Build();
        await expect(build.buildModel('TestModel')).rejects.toThrow(/Build prerequisite not found/);
    });
});

// ============================================================================
// 4. Timeout from env var
// ============================================================================
describe('Build timeout', () => {
    test('uses BUILD_TIMEOUT env var', async () => {
        process.env.BUILD_TIMEOUT = '120000';
        mockPathExists.mockResolvedValue(true);
        mockPsExecute.mockResolvedValue({
            code: 0, success: true, stdout: '', stderr: '', executionTime: 1000,
        });

        const build = new D365Build();
        await build.buildModel('TestModel');

        const options = mockPsExecute.mock.calls[0][1];
        expect(options.timeout).toBe(120000);

        delete process.env.BUILD_TIMEOUT;
    });
});
