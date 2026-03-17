jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockPathExists = jest.fn();
const mockReadFile = jest.fn();

jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
    readFile: mockReadFile,
}));

// Must clear the module cache so each test gets a fresh instance
beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENVIRONMENT_TYPE;
    // Reset the module so constructor runs fresh
    jest.resetModules();
});

function getD365Environment() {
    // Re-mock fs-extra since resetModules clears it
    jest.doMock('fs-extra', () => ({
        pathExists: mockPathExists,
        readFile: mockReadFile,
    }));
    return require('../src/core/d365-environment');
}

// ============================================================================
// 1. Environment detection
// ============================================================================
describe('Environment detection', () => {
    test('returns "cloud" when K: drive packages exist', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockImplementation((p) => {
            return Promise.resolve(p.startsWith('K:'));
        });

        const env = new D365Environment();
        const type = await env.detect();
        expect(type).toBe('cloud');
    });

    test('returns "local" when only C: drive packages exist', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockImplementation((p) => {
            return Promise.resolve(p.startsWith('C:'));
        });

        const env = new D365Environment();
        const type = await env.detect();
        expect(type).toBe('local');
    });

    test('returns "local" as default when neither path exists', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockResolvedValue(false);

        const env = new D365Environment();
        const type = await env.detect();
        expect(type).toBe('local');
    });

    test('respects ENVIRONMENT_TYPE override', async () => {
        process.env.ENVIRONMENT_TYPE = 'cloud';
        const D365Environment = getD365Environment();
        mockPathExists.mockResolvedValue(false);

        const env = new D365Environment();
        const type = await env.detect();
        expect(type).toBe('cloud');
    });

    test('ignores "auto" override value', async () => {
        process.env.ENVIRONMENT_TYPE = 'auto';
        const D365Environment = getD365Environment();
        mockPathExists.mockImplementation((p) => Promise.resolve(p.startsWith('C:')));

        const env = new D365Environment();
        const type = await env.detect();
        expect(type).toBe('local');
    });
});

// ============================================================================
// 2. getEnvironmentInfo — reads web.config
// ============================================================================
describe('getEnvironmentInfo', () => {
    test('reads HostUrl and HostName from web.config', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockResolvedValue(true);
        mockReadFile.mockResolvedValue(`
            <configuration>
                <appSettings>
                    <add key="Infrastructure.HostUrl" value="https://myenv.axcloud.dynamics.com" />
                    <add key="Infrastructure.HostName" value="myenv.axcloud.dynamics.com" />
                </appSettings>
            </configuration>
        `);

        const env = new D365Environment();
        const info = await env.getEnvironmentInfo();

        expect(info.url).toBe('https://myenv.axcloud.dynamics.com');
        expect(info.name).toBe('myenv.axcloud.dynamics.com');
    });

    test('returns null url/name when web.config does not exist', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockResolvedValue(false);

        const env = new D365Environment();
        const info = await env.getEnvironmentInfo();

        expect(info.url).toBeNull();
        expect(info.name).toBeNull();
    });

    test('returns null url/name when web.config has no matching keys', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockResolvedValue(true);
        mockReadFile.mockResolvedValue('<configuration><appSettings></appSettings></configuration>');

        const env = new D365Environment();
        const info = await env.getEnvironmentInfo();

        expect(info.url).toBeNull();
        expect(info.name).toBeNull();
    });

    test('caches result after first call', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockResolvedValue(true);
        mockReadFile.mockResolvedValue(
            '<add key="Infrastructure.HostUrl" value="https://cached.dynamics.com" />' +
            '<add key="Infrastructure.HostName" value="cached.dynamics.com" />'
        );

        const env = new D365Environment();
        await env.getEnvironmentInfo();
        await env.getEnvironmentInfo();

        // readFile should only be called once due to caching
        expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    test('handles readFile errors gracefully', async () => {
        const D365Environment = getD365Environment();
        mockPathExists.mockResolvedValue(true);
        mockReadFile.mockRejectedValue(new Error('EACCES'));

        const env = new D365Environment();
        const info = await env.getEnvironmentInfo();

        expect(info.url).toBeNull();
        expect(info.name).toBeNull();
    });
});
