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
const mockStat = jest.fn();
const mockReadFile = jest.fn();
jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
    stat: mockStat,
    readFile: mockReadFile,
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
// 2b. Build diagnostics — xppc writes errors to files, not stdout
// ============================================================================
describe('Build failure diagnostics', () => {
    const ERR_XML = `<?xml version="1.0" encoding="utf-8"?>
<Diagnostics>
  <Items>
    <Diagnostic>
      <DiagnosticType>Compile</DiagnosticType>
      <Severity>Error</Severity>
      <Path>dynamics://Table/NmbWmsParameters</Path>
      <Message>The underlying type 'NmbWmsInventTransferAutoReceive' does not exist.</Message>
    </Diagnostic>
    <Diagnostic>
      <DiagnosticType>Metadata</DiagnosticType>
      <Severity>Error</Severity>
      <Path>AxTable/NmbShipmentLane/Fields/InventTransferAutoReceive/ExtendedDataType</Path>
      <Message>Extended data type 'NmbWmsInventTransferAutoReceive' does not exist.</Message>
    </Diagnostic>
    <Diagnostic>
      <DiagnosticType>Metadata</DiagnosticType>
      <Severity>Error</Severity>
      <Path>AxSecurityRole/NmbDataEntityManager</Path>
      <Message>Security duty 'NmbDataEntityMaintain' does not exist.</Message>
    </Diagnostic>
    <Diagnostic>
      <DiagnosticType>Compile</DiagnosticType>
      <Severity>Warning</Severity>
      <Path>dynamics://Class/Whatever</Path>
      <Message>Some warning that must not be reported as an error.</Message>
    </Diagnostic>
  </Items>
</Diagnostics>`;

    const BUILD_LOG = [
        'Compiling TestModel',
        "Compile Error: Table dynamics://Table/NmbWmsParameters: The underlying type 'X' does not exist.",
        "Metadata Error: AxTable/NmbShipmentLane: Extended data type 'X' does not exist.",
        'Errors: 5',
    ].join('\n');

    // The label build succeeds, then the xppc build fails.
    function stubBuildFailure(message) {
        mockPsExecute
            .mockResolvedValueOnce({ code: 0, success: true, stdout: '', stderr: '', executionTime: 100 })
            .mockRejectedValueOnce(new Error(message));
    }

    function stubDiagnosticFiles(files, mtimeMs) {
        const lookup = filePath => Object.keys(files).find(name => String(filePath).endsWith(name));
        mockStat.mockImplementation(async (filePath) => {
            if (!lookup(filePath)) throw new Error('ENOENT');
            return { mtimeMs };
        });
        mockReadFile.mockImplementation(async (filePath) => {
            const key = lookup(filePath);
            if (!key) throw new Error('ENOENT');
            return files[key];
        });
    }

    test('replaces the useless timing table with the real compile errors', async () => {
        stubBuildFailure('PowerShell command failed with exit code 1: Compilation ended');
        stubDiagnosticFiles({ 'TestModel.BuildModelResult.err.xml': ERR_XML }, Date.now() + 1000);

        const build = new D365Build();
        const error = await build.buildModel('TestModel').then(() => null, e => e);

        expect(error.message).toMatch(/X\+\+ build failed for TestModel with 3 error\(s\)/);
        expect(error.message).toMatch(/NmbWmsInventTransferAutoReceive/);
        expect(error.message).toMatch(/NmbDataEntityMaintain/);
        // Warnings are not errors
        expect(error.message).not.toMatch(/must not be reported/);
        expect(error.diagnostics).toHaveLength(3);
        expect(error.originalMessage).toMatch(/exit code 1/);
    });

    test('caps the listed errors and points at the log for the rest', async () => {
        const many = Array.from({ length: 11 }, (_, i) => `
    <Diagnostic>
      <DiagnosticType>Compile</DiagnosticType>
      <Severity>Error</Severity>
      <Path>dynamics://Table/T${i}</Path>
      <Message>Error number ${i}</Message>
    </Diagnostic>`).join('');

        stubBuildFailure('PowerShell command failed with exit code 1');
        stubDiagnosticFiles(
            { 'TestModel.BuildModelResult.err.xml': `<Diagnostics><Items>${many}</Items></Diagnostics>` },
            Date.now() + 1000
        );

        const build = new D365Build();
        const error = await build.buildModel('TestModel').then(() => null, e => e);

        expect(error.message).toMatch(/with 11 error\(s\)/);
        expect(error.message).toMatch(/8\. \[Compile\]/);
        expect(error.message).not.toMatch(/9\. \[Compile\]/);
        expect(error.message).toMatch(/\(\+3 more — see TestModel\.BuildModelResult\.err\.xml\)/);
    });

    test('falls back to the .log file when no err.xml was written', async () => {
        stubBuildFailure('PowerShell command failed with exit code 1');
        stubDiagnosticFiles({ 'TestModel.BuildModelResult.log': BUILD_LOG }, Date.now() + 1000);

        const build = new D365Build();
        const error = await build.buildModel('TestModel').then(() => null, e => e);

        // "Errors: 5" is trusted over the two lines we could parse
        expect(error.message).toMatch(/with 5 error\(s\)/);
        expect(error.message).toMatch(/\(\+3 more — see TestModel\.BuildModelResult\.log\)/);
    });

    test('ignores diagnostics left over from an earlier run', async () => {
        stubBuildFailure('PowerShell command failed with exit code 1: Compilation ended');
        stubDiagnosticFiles({ 'TestModel.BuildModelResult.err.xml': ERR_XML }, Date.now() - 86400000);

        const build = new D365Build();
        const error = await build.buildModel('TestModel').then(() => null, e => e);

        expect(error.message).toMatch(/exit code 1/);
        expect(error.message).not.toMatch(/NmbWmsInventTransferAutoReceive/);
    });

    test('keeps the original error when no diagnostics can be read', async () => {
        stubBuildFailure('PowerShell command failed with exit code 1: something else broke');
        stubDiagnosticFiles({}, Date.now());

        const build = new D365Build();
        const error = await build.buildModel('TestModel').then(() => null, e => e);

        expect(error.message).toMatch(/something else broke/);
        expect(error.diagnostics).toBeUndefined();
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
