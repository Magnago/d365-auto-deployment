const path = require('path');

// --- Stubs ------------------------------------------------------------------

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

const mockSendNotification = jest.fn().mockResolvedValue({ success: true });
jest.mock('../src/core/notification-service', () => {
    return jest.fn().mockImplementation(() => ({
        sendNotification: mockSendNotification,
    }));
});

// Mock child_process.spawn to simulate the PowerShell TFVC operations script
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: mockSpawn }));

// Mock fs for descriptor operations
jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    return {
        ...real,
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(
            '<AxModelInfo>' +
            '<VersionMajor>1</VersionMajor>' +
            '<VersionMinor>2</VersionMinor>' +
            '<VersionBuild>3</VersionBuild>' +
            '<VersionRevision>100</VersionRevision>' +
            '</AxModelInfo>'
        ),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
    };
});

// --- Helpers ----------------------------------------------------------------

function setEnv(overrides = {}) {
    const defaults = {
        TFVC_COLLECTION_URL: 'https://dev.azure.com/org/DefaultCollection',
        TFVC_WORKSPACE: 'WS1',
        TFVC_PROJECT_NAME: 'MyProject',
        TFVC_USERNAME: 'user@example.com',
        TFVC_PAT: 'test-pat-token',
        D365_MODEL: 'TestModel',
        SOURCE_BRANCH: 'Dev',
        TARGET_BRANCH: 'Test',
        SKIP_TFVC_MERGE_OPERATIONS: 'false',
        SUPPRESS_STEP_NOTIFICATIONS: 'true',
    };
    Object.assign(process.env, defaults, overrides);
}

function clearEnv() {
    [
        'TFVC_COLLECTION_URL', 'TFVC_WORKSPACE', 'TFVC_PROJECT_NAME',
        'TFVC_USERNAME', 'TFVC_PAT', 'AZURE_PAT', 'TFVC_PASSWORD',
        'D365_MODEL', 'SOURCE_BRANCH', 'TARGET_BRANCH',
        'SKIP_TFVC_MERGE_OPERATIONS', 'SUPPRESS_STEP_NOTIFICATIONS',
        'TFVC_CREDENTIAL_MODE', 'TFVC_WORKSPACE_OWNER',
    ].forEach(k => delete process.env[k]);
}

/**
 * Sets up mockSpawn so that the next N calls resolve with the given JSON results.
 * Each entry in `results` becomes one powershell.exe invocation's stdout.
 */
function setupSpawnSequence(results) {
    const queue = [...results];
    mockSpawn.mockImplementation(() => {
        const result = queue.shift() || { success: true };
        const stdout = JSON.stringify(result);

        const handlers = {};
        const stdoutHandlers = {};
        const stderrHandlers = {};

        const child = {
            stdout: { on: (evt, cb) => { stdoutHandlers[evt] = cb; } },
            stderr: { on: (evt, cb) => { stderrHandlers[evt] = cb; } },
            on: (evt, cb) => { handlers[evt] = cb; },
        };

        // Emit data + close on next tick
        process.nextTick(() => {
            if (stdoutHandlers.data) stdoutHandlers.data(Buffer.from(stdout));
            if (handlers.close) handlers.close(result.success === false ? 1 : 0);
        });

        return child;
    });
}

// --- SUT --------------------------------------------------------------------

const TFVCMerge = require('../src/scripts/tfvc-merge');

// --- Tests ------------------------------------------------------------------

beforeEach(() => {
    jest.clearAllMocks();
    clearEnv();
    setEnv();
});

// ============================================================================
// 1. Conflict detection during get latest
// ============================================================================
describe('getLatestBranch — conflict detection', () => {
    test('throws when getlatest returns numConflicts > 0', async () => {
        setupSpawnSequence([
            // workspaces
            {
                success: true,
                name: 'WS1',
                owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest for source — has conflicts
            {
                success: true,
                branchPath: '$/MyProject/Dev',
                numConflicts: 2,
                numUpdated: 100,
                noActionNeeded: false,
            },
        ]);

        const merge = new TFVCMerge();
        await expect(merge.execute()).rejects.toThrow(/2 conflict\(s\) detected while getting latest/);
    });

    test('succeeds when getlatest returns numConflicts = 0', async () => {
        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest source
            { success: true, numConflicts: 0, noActionNeeded: false, numUpdated: 50 },
            // mergecandidates — has changes
            { success: true, count: 1, changesets: [{ changesetId: 500, comment: 'test' }] },
            // edit (source descriptor)
            { success: true, pendedCount: 1 },
            // checkin source
            { success: true, changeset: 998 },
            // merge
            { success: true, numConflicts: 0, noActionNeeded: false, numUpdated: 10 },
            // conflicts query
            { success: true, count: 0, conflicts: [] },
            // checkin target
            { success: true, changeset: 999 },
            // getlatest target
            { success: true, numConflicts: 0, noActionNeeded: false },
        ]);

        const merge = new TFVCMerge();
        const result = await merge.execute();

        expect(result.success).toBe(true);
        expect(result.details.targetChangeset).toBe(999);
    });
});

// ============================================================================
// 2. Conflict detection during merge
// ============================================================================
describe('mergeSourceIntoTarget — conflict detection', () => {
    test('throws immediately on non-descriptor conflicts (never auto-resolves)', async () => {
        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest source — no conflicts
            { success: true, numConflicts: 0, noActionNeeded: false },
            // mergecandidates — has changes
            { success: true, count: 1, changesets: [{ changesetId: 500, comment: 'test' }] },
            // edit (source descriptor)
            { success: true, pendedCount: 1 },
            // checkin source
            { success: true, changeset: 998 },
            // merge — has conflicts
            { success: true, numConflicts: 2, noActionNeeded: false },
            // conflicts query — returns non-descriptor conflicts
            { success: true, count: 2, conflicts: [
                { serverItem: '$/MyProject/Test/SomeClass.xml', type: 'Content' },
                { serverItem: '$/MyProject/Test/Main/Metadata/TestModel/Descriptor/TestModel.xml', type: 'Content' },
            ] },
            // NO resolveconflicts call — should fail before that
        ]);

        const merge = new TFVCMerge();
        await expect(merge.execute()).rejects.toThrow(/1 merge conflict\(s\) detected.*SomeClass\.xml/);
    });

    test('auto-resolves only descriptor conflicts and continues merge', async () => {
        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest source
            { success: true, numConflicts: 0, noActionNeeded: false },
            // mergecandidates — has changes
            { success: true, count: 1, changesets: [{ changesetId: 500, comment: 'test' }] },
            // edit (source descriptor)
            { success: true, pendedCount: 1 },
            // checkin source
            { success: true, changeset: 998 },
            // merge — has 1 conflict (descriptor only)
            { success: true, numConflicts: 1, noActionNeeded: false },
            // conflicts query — only descriptor conflict
            { success: true, count: 1, conflicts: [
                { serverItem: '$/MyProject/Test/Main/Metadata/TestModel/Descriptor/TestModel.xml', type: 'Content' },
            ] },
            // resolveconflicts — resolved
            { success: true, resolvedCount: 1, failedCount: 0, resolved: [{ serverItem: '$/MyProject/Test/Descriptor/TestModel.xml' }], failed: [] },
            // safety-net conflicts query — 0 remaining
            { success: true, count: 0, conflicts: [] },
            // checkin target
            { success: true, changeset: 999 },
            // getlatest target
            { success: true, numConflicts: 0, noActionNeeded: false },
        ]);

        const merge = new TFVCMerge();
        const result = await merge.execute();

        expect(result.success).toBe(true);
        expect(result.details.hasChanges).toBe(true);
        expect(result.details.targetChangeset).toBe(999);
    });
});

// ============================================================================
// 3. Safety-net queryConflicts
// ============================================================================
describe('Safety-net queryConflicts after merge', () => {
    test('throws when safety-net queryConflicts finds conflicts after merge', async () => {
        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest source
            { success: true, numConflicts: 0, noActionNeeded: false },
            // mergecandidates — has changes
            { success: true, count: 1, changesets: [{ changesetId: 500, comment: 'test' }] },
            // edit (source descriptor)
            { success: true, pendedCount: 1 },
            // checkin source
            { success: true, changeset: 998 },
            // merge — reports 0 conflicts (no auto-resolve needed)
            { success: true, numConflicts: 0, noActionNeeded: false },
            // safety-net conflicts query — finds 1
            { success: true, count: 1, conflicts: [{ serverItem: '$/file.xml', type: 'Content' }] },
        ]);

        const merge = new TFVCMerge();
        await expect(merge.execute()).rejects.toThrow(/1 conflict\(s\) detected after merge/);
    });
});

// ============================================================================
// 4. No changes to merge — skip descriptor bump
// ============================================================================
describe('No unmerged changesets (mergecandidates count=0)', () => {
    test('skips descriptor bump, merge, and checkin, returns hasChanges=false', async () => {
        const fs = require('fs');

        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest source
            { success: true, numConflicts: 0, noActionNeeded: false },
            // mergecandidates — no unmerged changesets
            { success: true, count: 0, changesets: [] },
            // NO further calls expected
        ]);

        const merge = new TFVCMerge();
        const result = await merge.execute();

        expect(result.success).toBe(true);
        expect(result.details.hasChanges).toBe(false);
        expect(result.details.changeset).toBeNull();

        // Descriptor should NOT have been written
        expect(fs.writeFileSync).not.toHaveBeenCalled();

        // Only 3 PowerShell calls: workspaces, getlatest source, mergecandidates
        expect(mockSpawn).toHaveBeenCalledTimes(3);
    });
});

// ============================================================================
// 5. Full merge with changes — descriptor bump + checkin
// ============================================================================
describe('Merge with changes — descriptor bump on source, then merge', () => {
    test('bumps descriptor on source, checks in source, merges to target, checks in target', async () => {
        const fs = require('fs');

        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest source
            { success: true, numConflicts: 0, noActionNeeded: false },
            // mergecandidates — has changes
            { success: true, count: 2, changesets: [{ changesetId: 500 }, { changesetId: 501 }] },
            // edit (pend edit on SOURCE descriptor)
            { success: true, pendedCount: 1 },
            // checkin SOURCE
            { success: true, changeset: 1233 },
            // merge source → target
            { success: true, numConflicts: 0, noActionNeeded: false, numUpdated: 5 },
            // conflicts query
            { success: true, count: 0, conflicts: [] },
            // checkin TARGET
            { success: true, changeset: 1234, filesCheckedIn: 3 },
            // getlatest target after checkin
            { success: true, numConflicts: 0, noActionNeeded: false },
        ]);

        const merge = new TFVCMerge();
        const result = await merge.execute();

        expect(result.success).toBe(true);
        expect(result.details.hasChanges).toBe(true);
        expect(result.details.sourceChangeset).toBe(1233);
        expect(result.details.targetChangeset).toBe(1234);

        // Descriptor was read and written
        expect(fs.readFileSync).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled();

        // Written content should have bumped revision from 100 → 101
        const writtenContent = fs.writeFileSync.mock.calls[0][1];
        expect(writtenContent).toContain('101');
    });
});

// ============================================================================
// 6. refreshTargetOnly (SKIP_TFVC_MERGE_OPERATIONS=true)
// ============================================================================
describe('refreshTargetOnly mode', () => {
    test('only gets latest on target, does not merge', async () => {
        setEnv({ SKIP_TFVC_MERGE_OPERATIONS: 'true' });

        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest target
            { success: true, numConflicts: 0, noActionNeeded: false, numUpdated: 200 },
        ]);

        const merge = new TFVCMerge();
        const result = await merge.execute();

        expect(result.success).toBe(true);
        expect(result.details.skipped).toBe(true);
        expect(result.details.hasChanges).toBe(true);

        // Only 2 PS calls: workspaces + getlatest
        expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    test('throws on conflict during target refresh', async () => {
        setEnv({ SKIP_TFVC_MERGE_OPERATIONS: 'true' });

        setupSpawnSequence([
            // workspaces
            {
                success: true, name: 'WS1', owner: 'user',
                folders: [
                    { serverItem: '$/MyProject/Dev', localItem: 'C:\\Dev' },
                    { serverItem: '$/MyProject/Test', localItem: 'C:\\Test' },
                ],
            },
            // getlatest target — conflict
            { success: true, numConflicts: 1, noActionNeeded: false },
        ]);

        const merge = new TFVCMerge();
        await expect(merge.execute()).rejects.toThrow(/conflict\(s\) detected while getting latest on target/);
    });
});

// ============================================================================
// 7. Credential resolution
// ============================================================================
describe('Credential resolution', () => {
    test('auto mode prefers TFVC_PAT over TFVC_PASSWORD', () => {
        setEnv({ TFVC_PAT: 'pat-value', TFVC_PASSWORD: 'pw-value' });
        const merge = new TFVCMerge();
        expect(merge.authSecret).toBe('pat-value');
        expect(merge.authSource).toBe('TFVC_PAT');
    });

    test('auto mode falls back to AZURE_PAT', () => {
        clearEnv();
        setEnv({ TFVC_PAT: '', AZURE_PAT: 'azure-pat', TFVC_PASSWORD: 'pw' });
        const merge = new TFVCMerge();
        expect(merge.authSecret).toBe('azure-pat');
        expect(merge.authSource).toBe('AZURE_PAT');
    });

    test('auto mode falls back to TFVC_PASSWORD when no PAT', () => {
        clearEnv();
        setEnv({ TFVC_PAT: '', AZURE_PAT: '', TFVC_PASSWORD: 'the-password' });
        const merge = new TFVCMerge();
        expect(merge.authSecret).toBe('the-password');
        expect(merge.authSource).toBe('TFVC_PASSWORD');
    });

    test('password mode forces TFVC_PASSWORD', () => {
        clearEnv();
        setEnv({ TFVC_PAT: 'pat', TFVC_PASSWORD: 'pw', TFVC_CREDENTIAL_MODE: 'password' });
        const merge = new TFVCMerge();
        expect(merge.authSecret).toBe('pw');
        expect(merge.authSource).toBe('TFVC_PASSWORD');
    });
});

// ============================================================================
// 8. Collection URL normalization
// ============================================================================
describe('Collection URL normalization', () => {
    test('appends /DefaultCollection for visualstudio.com URLs without path', () => {
        setEnv({ TFVC_COLLECTION_URL: 'https://myorg.visualstudio.com' });
        const merge = new TFVCMerge();
        expect(merge.collectionUrl).toBe('https://myorg.visualstudio.com/DefaultCollection');
    });

    test('leaves dev.azure.com URLs untouched', () => {
        setEnv({ TFVC_COLLECTION_URL: 'https://dev.azure.com/org/DefaultCollection' });
        const merge = new TFVCMerge();
        expect(merge.collectionUrl).toBe('https://dev.azure.com/org/DefaultCollection');
    });

    test('strips trailing slashes', () => {
        setEnv({ TFVC_COLLECTION_URL: 'https://dev.azure.com/org/DefaultCollection/' });
        const merge = new TFVCMerge();
        expect(merge.collectionUrl).toBe('https://dev.azure.com/org/DefaultCollection');
    });
});

// ============================================================================
// 9. Configuration validation
// ============================================================================
describe('TFVC configuration validation', () => {
    test('throws when workspace is missing', () => {
        clearEnv();
        setEnv({ TFVC_WORKSPACE: '' });
        const merge = new TFVCMerge();
        expect(() => merge.validateConfiguration()).toThrow(/TFVC_WORKSPACE/);
    });

    test('throws when no credential is provided', () => {
        clearEnv();
        setEnv({ TFVC_PAT: '', AZURE_PAT: '', TFVC_PASSWORD: '' });
        const merge = new TFVCMerge();
        expect(() => merge.validateConfiguration()).toThrow(/credential/i);
    });
});

// ============================================================================
// 10. Descriptor version parsing
// ============================================================================
describe('Descriptor version parsing', () => {
    test('parses version from XML', () => {
        const merge = new TFVCMerge();
        const xml = `
            <AxModelInfo>
                <VersionMajor>7</VersionMajor>
                <VersionMinor>0</VersionMinor>
                <VersionBuild>4</VersionBuild>
                <VersionRevision>42</VersionRevision>
            </AxModelInfo>`;
        const version = merge.parseDescriptorVersion(xml);
        expect(version).toEqual({ major: 7, minor: 0, build: 4, revision: 42 });
    });

    test('throws when version tag is missing', () => {
        const merge = new TFVCMerge();
        expect(() => merge.parseDescriptorVersion('<AxModelInfo></AxModelInfo>'))
            .toThrow(/Unable to locate VersionMajor/);
    });
});
