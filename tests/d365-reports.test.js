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
            reportsScriptPath: 'K:\\AosService\\PackagesLocalDirectory\\Plugins\\AxReportVmRoleStartupTask\\DeployAllReportsToSSRS.ps1',
        }),
    }));
});

const mockPathExists = jest.fn().mockResolvedValue(true);
jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
}));

// Mock child_process.execFile for registry operations
const mockExecFile = jest.fn().mockImplementation((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; }
    cb(null, { stdout: '', stderr: '' });
});
jest.mock('child_process', () => ({
    execFile: mockExecFile,
}));
jest.mock('util', () => ({
    promisify: (fn) => jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

const D365Reports = require('../src/modules/d365-reports');

beforeEach(() => {
    jest.clearAllMocks();
    process.env.D365_MODEL = 'TestModel';
});

// ============================================================================
// 1. Successful reports deployment
// ============================================================================
describe('Successful reports deployment', () => {
    test('calls DeployAllReportsToSSRS.ps1 with correct module', async () => {
        mockPsExecute.mockResolvedValue({
            code: 0, success: true,
            stdout: 'Deployed 5 reports\n3 reports published',
            stderr: '', executionTime: 60000,
        });

        const reports = new D365Reports();
        const result = await reports.deployAllReports({ module: 'TestModel' });

        expect(result.success).toBe(true);
        expect(result.module).toBe('TestModel');
        expect(result.environmentType).toBe('cloud');

        const command = mockPsExecute.mock.calls[0][0];
        expect(command).toContain('DeployAllReportsToSSRS.ps1');
        expect(command).toContain('TestModel');
    });
});

// ============================================================================
// 2. Deployment output parsing
// ============================================================================
describe('Deployment output parsing', () => {
    test('parses deployed/failed/skipped/warning counts', () => {
        const reports = new D365Reports();
        const stats = reports.parseDeploymentOutput([
            'Report A deployed successfully',
            'Report B deployed successfully',
            'Report C published successfully',
            'Report D failed with error',
            'Report E skipped - already exists',
            'Warning: Report F has issues',
            'Processing 10 reports total',
        ].join('\n'));

        expect(stats.deployedReports).toBe(3); // deployed + published
        expect(stats.failedReports).toBe(1);
        expect(stats.skippedReports).toBe(1);
        expect(stats.warnings).toBe(1);
        expect(stats.errors).toBe(1);
        expect(stats.totalReports).toBe(10);
    });

    test('handles empty output', () => {
        const reports = new D365Reports();
        const stats = reports.parseDeploymentOutput('');
        expect(stats.totalReports).toBe(0);
        expect(stats.deployedReports).toBe(0);
    });
});

// ============================================================================
// 3. Reports failure
// ============================================================================
describe('Reports failure', () => {
    test('throws when deployment script fails', async () => {
        mockPsExecute.mockRejectedValue(new Error('SSRS connection refused'));

        const reports = new D365Reports();
        await expect(reports.deployAllReports({ module: 'TestModel' }))
            .rejects.toThrow(/SSRS connection refused/);
    });
});

// ============================================================================
// 4. Missing prerequisites
// ============================================================================
describe('Missing prerequisites', () => {
    test('throws when reports script does not exist', async () => {
        mockPathExists.mockImplementation((p) => {
            return Promise.resolve(!p.endsWith('.ps1'));
        });

        const reports = new D365Reports();
        await expect(reports.deployAllReports({ module: 'TestModel' }))
            .rejects.toThrow(/Reports deployment prerequisite not found/);
    });
});
