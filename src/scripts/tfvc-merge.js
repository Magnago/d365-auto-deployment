require('dotenv').config();
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class TFVCMerge {
    constructor() {
        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'Your TFVC Project';
        this.collectionHost = null;
        this.isAzureDevOpsHost = false;
        this.collectionUrl = this.normalizeCollectionUrl(process.env.TFVC_COLLECTION_URL);

        this.rawUsername = process.env.TFVC_USERNAME || process.env.TFVC_LOGIN || 'buildsvc';
        this.username = this.rawUsername;
        this.password = process.env.TFVC_PAT || process.env.TFVC_PASSWORD || process.env.AZURE_PAT;
        this.workspaceName = process.env.TFVC_WORKSPACE;
        this.useCachedAuthOnly = process.env.TFVC_USE_CACHED_AUTH_ONLY === 'true';
        this.forceLoginCommands = new Set(['checkin']);

        this.allowIntegratedAuthFallback = process.env.TFVC_ALLOW_INTEGRATED_AUTH_FALLBACK !== 'false';
        this.usernameVariants = this.buildUsernameVariants();
        this.username = this.usernameVariants[0];

        this.projectServerPath = `$/${this.projectName}`;
        this.sourceBranchPath = `${this.projectServerPath}/${this.sourceBranch}`;
        this.targetBranchPath = `${this.projectServerPath}/${this.targetBranch}`;
        this.sourceLocalPath = null;
        this.targetLocalPath = null;
        this.lastVersionLabel = null;

        this.notificationService = new NotificationService();
        this.deploymentId = 'TFVC-' + new Date().toISOString().replace(/[:.]/g, '-');
        this.tfExePath = this.findTfExecutable();
    }

    async execute() {
        this.validateConfiguration();

        const startTime = Date.now();
        this.lastVersionLabel = null;

        try {
            logger.info('dYs? Starting TFVC merge using pre-configured workspace', {
                workspace: this.workspaceName,
                sourceBranch: this.sourceBranchPath,
                targetBranch: this.targetBranchPath
            });

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('start', {
                    deploymentId: this.deploymentId,
                    stepName: 'TFVC Merge',
                    environmentType: 'TFVC Merge',
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch
                });
            }

            await this.validateWorkspaceContext();

            await this.getLatestBranch(this.sourceBranchPath, 'source');
            await this.getLatestBranch(this.targetBranchPath, 'target');

            await this.handleVersionBumpIfNeeded();

            const mergeResult = await this.performMerge();

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('success', {
                    deploymentId: this.deploymentId,
                    stepName: 'TFVC Merge',
                    environmentType: 'TFVC Merge',
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch,
                    executionTime: Date.now() - startTime,
                    mergeResult
                });
            }

            return {
                success: true,
                message: mergeResult.message,
                details: mergeResult
            };
        } catch (error) {
            logger.error('TFVC Merge failed', { error: error.message });

            if (this.shouldNotify()) {
                await this.notificationService.sendNotification('failure', {
                    deploymentId: this.deploymentId,
                    stepName: 'TFVC Merge',
                    environmentType: 'TFVC Merge',
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch,
                    executionTime: Date.now() - startTime,
                    failedStep: 'TFVC Merge',
                    error: error.message
                });
            }

            throw error;
        }
    }

    async validateWorkspaceContext() {
        logger.info('Validating TF workspace configuration');

        const workspaceList = await this.executeTfCommand([
            'workspaces',
            `/collection:${this.collectionUrl}`,
            '/format:brief',
            `/computer:${os.hostname()}`,
            '/owner:*',
            '/noprompt'
        ], { allowEmpty: true });

        if (!workspaceList.stdout.toLowerCase().includes(this.workspaceName.toLowerCase())) {
            throw new Error(`Workspace "${this.workspaceName}" not found on this machine. Please create or switch to the correct TFVC workspace before rerunning the deployment script.`);
        }

        const mappings = await this.executeTfCommand([
            'workfold',
            `/workspace:${this.workspaceName}`,
            `/collection:${this.collectionUrl}`
        ], { allowEmpty: true });

        this.sourceLocalPath = this.extractLocalPath(mappings.stdout, this.sourceBranchPath);
        this.targetLocalPath = this.extractLocalPath(mappings.stdout, this.targetBranchPath);

        const missing = [];
        if (!this.sourceLocalPath) missing.push(this.sourceBranchPath);
        if (!this.targetLocalPath) missing.push(this.targetBranchPath);

        if (missing.length) {
            throw new Error(`Required TFVC mappings missing from workspace "${this.workspaceName}": ${missing.join(', ')}. Map these branches before running the script.`);
        }

        await this.verifyBranchAccess(this.sourceLocalPath, 'source');
        await this.verifyBranchAccess(this.targetLocalPath, 'target');
    }

    extractLocalPath(workfoldOutput, serverPath) {
        const lines = (workfoldOutput || '').split(/\r?\n/);
        const normalizedServer = serverPath.toLowerCase();

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith('Workspace') || line.startsWith('There are')) {
                continue;
            }

            const parts = line.split(':');
            if (parts.length < 2) {
                continue;
            }

            const server = parts[0].trim().toLowerCase();
            if (server !== normalizedServer) {
                continue;
            }

            let localPath = parts.slice(1).join(':').trim();
            localPath = localPath.replace(/\s+\[.*]$/, '').trim();
            return localPath;
        }

        return null;
    }

    async verifyBranchAccess(localPath, label) {
        const result = await this.executeTfCommand([
            'dir',
            '.'
        ], { cwd: localPath });

        if (!result.success) {
            throw new Error(`TFVC ${label} branch mapping (${localPath}) is not accessible. Error: ${result.stderr || result.stdout}`);
        }
    }

    async getLatestBranch(serverPath, label) {
        logger.info(`Getting latest for ${label} branch`, { branch: serverPath });

        const useServerPath = typeof serverPath === 'string' && serverPath.startsWith('$/');
        const pathArgument = useServerPath ? serverPath : '.';
        const options = useServerPath
            ? {}
            : {
                cwd: label === 'source' ? this.sourceLocalPath : this.targetLocalPath
            };

        await this.executeTfCommand([
            'get',
            pathArgument,
            '/recursive',
            '/overwrite',
            '/force',
            '/noprompt'
        ], options);
    }

    async performMerge() {
        logger.info('Executing TF merge');

        await this.executeTfCommand([
            'merge',
            this.sourceBranchPath,
            this.targetBranchPath,
            '/recursive',
            '/noprompt'
        ], { cwd: this.targetLocalPath });

        let statusResult = await this.getPendingChanges();

        if (this.isNoPendingChangesMessage(statusResult.stdout || statusResult.stderr)) {
            logger.info('No pending changes after merge - branches already in sync');
            return {
                status: 'noChanges',
                message: 'TFVC merge completed - no changes required',
                pendingChanges: 0,
                changeset: null,
                hasChanges: false
            };
        }

        if (this.hasConflicts(statusResult.stdout || statusResult.stderr)) {
            throw new Error('Merge conflicts detected. Resolve the conflicts in Visual Studio and rerun the deployment.');
        }

        const changesetId = await this.checkInChanges();

        if (!changesetId) {
            logger.info('No changes were checked in because no pending changes remained');
            return {
                status: 'noChanges',
                message: 'TFVC merge completed - No pending changes detected at check-in',
                pendingChanges: 0,
                changeset: null,
                hasChanges: false
            };
        }

        return {
            status: 'merged',
            message: `TFVC merge completed successfully (changeset ${changesetId})`,
            pendingChanges: this.extractPendingChangeCount(statusResult.stdout),
            changeset: changesetId,
            hasChanges: true
        };
    }

    async getPendingChanges() {
        return this.executeTfCommand([
            'status',
            '/recursive',
            '/noprompt'
        ], { allowEmpty: true, cwd: this.targetLocalPath });
    }

    async checkInChanges() {
        const baseComment = this.lastVersionLabel
            ? `${this.modelName} ${this.lastVersionLabel}`
            : this.buildMergeComment();
        const comment = baseComment.replace(/"/g, '\'');

        try {
            const result = await this.executeTfCommand([
                'checkin',
                `/comment:${comment}`,
                '/recursive',
                '/noprompt'
            ], { cwd: this.targetLocalPath });

            const changesetMatch = (result.stdout || '').match(/Changeset\s*#?(\d+)/i);
            const changesetId = changesetMatch ? changesetMatch[1] : 'Unknown';
            logger.info('Check-in completed', { changesetId });

            this.lastVersionLabel = null;
            return changesetId;
        } catch (error) {
            if (this.isNoPendingChangesMessage(error.message)) {
                logger.info('Check-in skipped: there are no pending changes to commit');
                return null;
            }
            throw error;
        }
    }

    async executeTfCommand(args, options = {}) {
        if (!this.tfExePath) {
            throw new Error('TF.exe not found. Install Visual Studio with Team Explorer.');
        }

        const baseArgs = this.ensureCollectionArgument(args);
        const commandName = (baseArgs[0] || '').toString().toLowerCase();
        const shouldUseLogin = this.shouldUseLogin(options, commandName);
        const allowFallback = options.disableAuthFallback === true
            ? false
            : this.allowIntegratedAuthFallback;

        let lastAuthError = null;

        if (shouldUseLogin) {
            for (const usernameVariant of this.usernameVariants) {
                try {
                    const finalArgs = this.withLoginArguments(baseArgs, usernameVariant);
                    return await this.spawnTfProcess(this.tfExePath, finalArgs, {
                        ...options,
                        useLogin: true
                    });
                } catch (error) {
                    if (!this.isAuthenticationError(error.message)) {
                        throw error;
                    }

                    lastAuthError = error;
                    logger.warn('TF authentication failed with credential variant', {
                        username: usernameVariant,
                        error: error.message
                    });
                }
            }
        } else {
            return this.spawnTfProcess(this.tfExePath, baseArgs, {
                ...options,
                useLogin: false
            });
        }

        if (allowFallback) {
            logger.warn('TF authentication failed with configured credentials. Retrying with integrated auth.');
            return this.spawnTfProcess(this.tfExePath, this.withoutNoPrompt(baseArgs), {
                ...options,
                useLogin: false
            });
        }

        if (lastAuthError) {
            throw lastAuthError;
        }

        throw new Error('TF authentication failed.');
    }

    withoutNoPrompt(args = []) {
        return args.filter(arg => {
            if (typeof arg !== 'string') {
                return true;
            }
            return arg.toLowerCase() !== '/noprompt';
        });
    }

    ensureCollectionArgument(args = []) {
        if (!this.collectionUrl || !args.length) {
            return [...args];
        }

        const command = (args[0] || '').toString().toLowerCase();
        const commandsRequiringCollection = new Set(['dir']);

        if (!commandsRequiringCollection.has(command)) {
            return [...args];
        }

        const hasCollection = args.some(arg =>
            typeof arg === 'string' && arg.toLowerCase().startsWith('/collection:')
        );

        if (hasCollection) {
            return [...args];
        }

        return [
            ...args,
            `/collection:${this.collectionUrl}`
        ];
    }

    buildUsernameVariants() {
        const variants = [];
        const seen = new Set();
        const addVariant = (value) => {
            if (!value) {
                return;
            }
            const normalized = value.trim();
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            variants.push(normalized);
        };

        const candidateBases = [];
        const baseUsername = (this.rawUsername || 'buildsvc').trim();
        const strippedUsername = this.stripAzureDevOpsPrefix(baseUsername);

        const pushCandidate = (value) => {
            if (value) {
                candidateBases.push(value);
                if (value.includes('@')) {
                    const alias = value.split('@')[0];
                    if (alias) {
                        candidateBases.push(alias);
                    }
                }
            }
        };

        pushCandidate(baseUsername);
        if (strippedUsername && strippedUsername !== baseUsername) {
            pushCandidate(strippedUsername);
        }

        for (const candidate of candidateBases) {
            addVariant(candidate);
            if (this.isAzureDevOpsHost) {
                addVariant(`AzureDevOpsServices\\${candidate}`);
                addVariant(`AzureDevOps\\${candidate}`);
            }
        }

        addVariant('buildsvc');

        return variants;
    }

    stripAzureDevOpsPrefix(value = '') {
        return value.replace(/^(azuredevopsservices|azuredevops)\\+/i, '');
    }

    spawnTfProcess(tfPath, args, options = {}) {
        return new Promise((resolve, reject) => {
            const maskedArgs = this.maskSensitiveArgs(args);
            logger.info(`Executing TF command: tf ${maskedArgs.join(' ')}`);

            const childEnv = { ...process.env };
            if (this.useCachedAuthOnly && options.useLogin !== true) {
                delete childEnv.VS_ENTITLEMENT_TOKEN;
            } else if (this.password) {
                childEnv.VS_ENTITLEMENT_TOKEN = this.password || process.env.VS_ENTITLEMENT_TOKEN;
            }

            const child = spawn(tfPath, args, {
                cwd: options.cwd || process.cwd(),
                env: childEnv
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim(), code });
                    return;
                }

                const errorOutput = `${stderr || ''}${stdout || ''}`.trim();

                if (this.isAuthenticationError(errorOutput)) {
                    logger.error('TF command failed with authentication error', {
                        command: maskedArgs.join(' '),
                        error: errorOutput
                    });
                    reject(new Error(`TF authentication failed: ${errorOutput}`));
                    return;
                }

                logger.error('TF command failed', {
                    command: maskedArgs.join(' '),
                    error: errorOutput || `exit code ${code}`
                });

                reject(new Error(errorOutput || `TF command failed with exit code ${code}`));
            });

            child.on('error', (error) => {
                reject(new Error(`TF command execution error: ${error.message}`));
            });
        });
    }

    shouldUseLogin(options = {}, commandName = '') {
        if (this.forceLoginCommands.has(commandName)) {
            return true;
        }

        if (this.useCachedAuthOnly || options.forceIntegratedAuth) {
            return false;
        }

        if (options.forceLogin) {
            return true;
        }

        return Boolean(this.username && this.password);
    }

    withLoginArguments(args, usernameVariant) {
        if (!usernameVariant || !this.password) {
            return [...args];
        }

        const filteredArgs = args.filter(arg =>
            !(typeof arg === 'string' && arg.toLowerCase().startsWith('/login:'))
        );

        return [
            ...filteredArgs,
            `/login:${usernameVariant},${this.password}`
        ];
    }

    maskSensitiveArgs(args) {
        return args.map(arg => {
            if (typeof arg !== 'string') {
                return arg;
            }
            return arg.toLowerCase().startsWith('/login:')
                ? '/login:***MASKED***'
                : arg;
        });
    }

    isAuthenticationError(message = '') {
        const normalized = (message || '').toLowerCase();
        return normalized.includes('tf30063')
            || normalized.includes('not authorized')
            || normalized.includes('unauthorized')
            || normalized.includes('authentication')
            || normalized.includes('access denied');
    }

    hasConflicts(output = '') {
        const normalized = (output || '').toLowerCase();
        return normalized.includes('conflict') || normalized.includes('resolve');
    }

    isNoPendingChangesMessage(message = '') {
        return (message || '').toLowerCase().includes('no pending changes');
    }

    extractPendingChangeCount(output = '') {
        if (!output) {
            return 0;
        }
        return output
            .split(/\r?\n/)
            .filter(line => line.trim() && !/^(workspace|pending changes)/i.test(line))
            .length;
    }

    findTfExecutable() {
        const possiblePaths = [
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe'
        ];

        for (const candidate of possiblePaths) {
            try {
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            } catch (error) {
                continue;
            }
        }

        return 'tf.exe';
    }

    buildMergeComment() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `Auto-deployment merge from ${this.sourceBranch} to ${this.targetBranch} - ${timestamp}`;
    }

    validateConfiguration() {
        const missing = [];

        if (!this.collectionUrl) missing.push('TFVC_COLLECTION_URL');
        if (!this.projectName) missing.push('TFVC_PROJECT_NAME');
        if (!this.sourceBranch) missing.push('SOURCE_BRANCH');
        if (!this.targetBranch) missing.push('TARGET_BRANCH');
        if (!this.workspaceName) missing.push('TFVC_WORKSPACE');
        if (!this.username) missing.push('TFVC_USERNAME');
        if (!this.password) missing.push('TFVC_PAT or TFVC_PASSWORD');

        if (missing.length) {
            throw new Error(`Missing required TFVC configuration: ${missing.join(', ')}`);
        }

        if (!this.tfExePath) {
            throw new Error('TF.exe not found. Install Visual Studio with Team Explorer.');
        }
    }

    normalizeCollectionUrl(rawUrl) {
        if (!rawUrl) {
            return rawUrl;
        }

        try {
            const parsed = new URL(rawUrl);
            const host = parsed.hostname.toLowerCase();
            this.collectionHost = host;
            this.isAzureDevOpsHost = host.endsWith('visualstudio.com') || host.endsWith('dev.azure.com');

            if (host.endsWith('visualstudio.com')) {
                const trimmedPath = parsed.pathname.replace(/\/+$/, '');
                if (!trimmedPath || trimmedPath === '' || trimmedPath === '/') {
                    parsed.pathname = '/DefaultCollection';
                    logger.info('Normalized TFVC collection URL to include DefaultCollection', {
                        originalUrl: rawUrl,
                        normalizedUrl: parsed.toString()
                    });
                }
            }

            return parsed.toString().replace(/\/+$/, '');
        } catch (error) {
            logger.warn('Failed to normalize TFVC collection URL', {
                rawUrl,
                error: error.message
            });
            return rawUrl;
        }
    }

    async handleVersionBumpIfNeeded() {
        if (!this.enableVersionBump()) {
            return;
        }

        const hasChanges = await this.hasPendingMergeChanges();
        if (!hasChanges) {
            logger.info('No pending merge candidates detected â€“ skipping version bump');
            return;
        }

        await this.bumpModuleVersion();
    }

    enableVersionBump() {
        return Boolean(this.modelName && this.sourceLocalPath);
    }

    async hasPendingMergeChanges() {
        try {
            const preview = await this.executeTfCommand([
                'merge',
                this.sourceBranchPath,
                this.targetBranchPath,
                '/recursive',
                '/noprompt',
                '/preview'
            ], {
                cwd: this.targetLocalPath,
                allowEmpty: true
            });

            const output = `${preview.stdout || ''}\n${preview.stderr || ''}`;
            return !this.isNoPendingChangesMessage(output);
        } catch (error) {
            logger.warn('Unable to preview pending merge changes; assuming changes exist', {
                error: error.message
            });
            return true;
        }
    }

    async bumpModuleVersion() {
        const descriptorPath = this.getDescriptorPath();
        if (!descriptorPath) {
            logger.warn('Descriptor file not found for version bump', { model: this.modelName });
            return;
        }

        logger.info('Incrementing module version', { descriptorPath });

        await this.executeTfCommand([
            'edit',
            descriptorPath,
            '/noprompt'
        ], {
            cwd: path.dirname(descriptorPath),
            allowEmpty: true
        });

        const xmlContent = fs.readFileSync(descriptorPath, 'utf8');
        const version = this.parseDescriptorVersion(xmlContent);
        const newRevision = version.revision + 1;

        const revisionRegex = new RegExp(`(<VersionRevision>)(\\s*)${version.revision}(\\s*)(</VersionRevision>)`, 'i');
        const updatedXml = xmlContent.replace(revisionRegex, `$1$2${newRevision}$3$4`);

        fs.writeFileSync(descriptorPath, updatedXml, 'utf8');

        const versionLabel = `${version.major}.0.${version.minor}.${version.build}.${newRevision}`;
        this.lastVersionLabel = versionLabel;
        logger.info('Checking in version bump', { version: versionLabel });

        await this.executeTfCommand([
            'checkin',
            descriptorPath,
            `/comment:${this.modelName} ${versionLabel}`,
            '/noprompt'
        ], {
            cwd: path.dirname(descriptorPath)
        });
    }

    getDescriptorPath() {
        if (!this.sourceLocalPath || !this.modelName) {
            return null;
        }

        const descriptorPath = path.join(
            this.sourceLocalPath,
            'Main',
            'Metadata',
            this.modelName,
            'Descriptor',
            `${this.modelName}.xml`
        );

        return fs.existsSync(descriptorPath) ? descriptorPath : null;
    }

    parseDescriptorVersion(xmlContent) {
        const resolveTag = (tag) => {
            const match = xmlContent.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
            if (!match) {
                throw new Error(`Unable to locate ${tag} inside descriptor XML`);
            }
            return match[1].trim();
        };

        return {
            major: parseInt(resolveTag('VersionMajor'), 10),
            minor: parseInt(resolveTag('VersionMinor'), 10),
            build: parseInt(resolveTag('VersionBuild'), 10),
            revision: parseInt(resolveTag('VersionRevision'), 10)
        };
    }

    shouldNotify() {
        return process.env.SUPPRESS_STEP_NOTIFICATIONS !== 'true';
    }
}

if (require.main === module) {
    const tfvcMerge = new TFVCMerge();
    tfvcMerge.execute()
        .then((result) => {
            console.log('\ndYZ% TFVC merge completed successfully!');
            console.log(`âœ” Result: ${result.message}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error('\nðŸ’¥ TFVC merge failed:', error.message);
            process.exit(1);
        });
}

module.exports = TFVCMerge;



