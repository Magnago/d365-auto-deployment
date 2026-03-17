const fs = require('fs-extra');
const path = require('path');

class D365Environment {
    constructor() {
        this.environments = require('../../config/environments.json');
        this._cachedInfo = null;
    }

    async detect() {
        const override = (process.env.ENVIRONMENT_TYPE || '').trim().toLowerCase();
        if (override && override !== 'auto') {
            return override;
        }

        if (await fs.pathExists(this.environments.cloud.packages)) {
            return 'cloud';
        }

        if (await fs.pathExists(this.environments.local.packages)) {
            return 'local';
        }

        return 'local';
    }

    getPaths(environmentType) {
        return this.environments[environmentType] || this.environments.local;
    }

    async getEnvironmentInfo() {
        if (this._cachedInfo) {
            return this._cachedInfo;
        }

        const environmentType = await this.detect();
        const paths = this.getPaths(environmentType);
        const webConfigPath = path.join(paths.webRoot, 'web.config');

        const info = { environmentType, url: null, name: null };

        try {
            if (await fs.pathExists(webConfigPath)) {
                const content = await fs.readFile(webConfigPath, 'utf8');

                const urlMatch = content.match(/key\s*=\s*["']Infrastructure\.HostUrl["']\s+value\s*=\s*["']([^"']+)["']/i);
                if (urlMatch) {
                    info.url = urlMatch[1];
                }

                const nameMatch = content.match(/key\s*=\s*["']Infrastructure\.HostName["']\s+value\s*=\s*["']([^"']+)["']/i);
                if (nameMatch) {
                    info.name = nameMatch[1];
                }
            }
        } catch (_) {
            // web.config not readable — leave url/name as null
        }

        this._cachedInfo = info;
        return info;
    }
}

module.exports = D365Environment;
