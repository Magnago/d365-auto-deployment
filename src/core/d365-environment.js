const fs = require('fs-extra');

class D365Environment {
    constructor() {
        this.environments = require('../../config/environments.json');
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
}

module.exports = D365Environment;
