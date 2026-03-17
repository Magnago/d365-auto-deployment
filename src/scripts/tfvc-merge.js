require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../core/logger');
const NotificationService = require('../core/notification-service');

class TFVCMerge {
    constructor() {
        this.modelName = process.env.D365_MODEL || 'YourD365Model';
        this.projectName = process.env.TFVC_PROJECT_NAME || 'YourTFVCProject';
        this.sourceBranch = process.env.SOURCE_BRANCH || 'Auto-Deployment-Dev';
        this.targetBranch = process.env.TARGET_BRANCH || 'Auto-Deployment-Test';
        this.workspaceName = (process.env.TFVC_WORKSPACE || '').trim();
        this.workspaceOwner = (process.env.TFVC_WORKSPACE_OWNER || '').trim() || null;
        this.collectionUrl = this.normalizeCollectionUrl(process.env.TFVC_COLLECTION_URL);
        this.rawUsername = process.env.TFVC_USERNAME || process.env.TFVC_LOGIN || '';
        this.credentialMode = (process.env.TFVC_CREDENTIAL_MODE || 'auto').trim().toLowerCase();
        const credential = this.resolveCredential(this.credentialMode);
        this.authSecret = credential.value;
        this.authSource = credential.source;
        this.skipMergeOperations = this.getBooleanEnv(process.env.SKIP_TFVC_MERGE_OPERATIONS, false);

        this.sourceBranchPath = `$/${this.projectName}/${this.sourceBranch}`;
        this.targetBranchPath = `$/${this.projectName}/${this.targetBranch}`;
        this.workspaceMappings = [];
        this.sourceLocalPath = null;
        this.targetLocalPath = null;
        this.lastVersionLabel = null;

        this.notifications = new NotificationService();
        this.executionId = `TFVC-${new Date().toISOString().replace(/[:.]/g, '-')}`;

        this.tfvcOpsScript = path.join(__dirname, 'tfvc-operations.ps1');
    }

    async execute() {
        this.validateConfiguration();
        const startedAt = Date.now();

        try {
            logger.info('Starting TFVC branch operation', {
                workspace: this.workspaceName,
                sourceBranch: this.sourceBranchPath,
                targetBranch: this.targetBranchPath,
                credentialMode: this.credentialMode,
                credentialSource: this.authSource,
                authMethod: 'dotnet-BasicAuthCredential'
            });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('start', {
                    deploymentId: this.executionId,
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch
                });
            }

            await this.validateWorkspaceContext();

            const details = this.skipMergeOperations
                ? await this.refreshTargetOnly()
                : await this.executeMergeWorkflow();

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('success', {
                    deploymentId: this.executionId,
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch,
                    executionTime: Date.now() - startedAt
                });
            }

            return {
                success: true,
                message: details.message,
                details
            };
        } catch (error) {
            logger.error('TFVC branch operation failed', { error: error.message });

            if (this.shouldNotify()) {
                await this.notifications.sendNotification('failure', {
                    deploymentId: this.executionId,
                    model: this.modelName,
                    sourceBranch: this.sourceBranch,
                    targetBranch: this.targetBranch,
                    failedStep: 'TFVC / Branch Operation',
                    error: error.message,
                    executionTime: Date.now() - startedAt
                });
            }

            throw error;
        }
    }

    /**
     * Execute a TFVC operation via the .NET client library PowerShell script.
     * Uses BasicAuthCredential + TfsClientCredentials which properly sends HTTP Basic auth,
     * bypassing TF.exe's broken VssBasicCredential/ADAL flow.
     */
    async executeTfvcOperation(operation, args = {}) {
        const jsonArgs = JSON.stringify(args);
        logger.info(`Executing TFVC operation: ${operation}`, { args });

        return new Promise((resolve, reject) => {
            const psArgs = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.tfvcOpsScript,
                '-Operation', operation,
                '-JsonArgs', jsonArgs,
                '-CollectionUrl', this.collectionUrl,
                '-Pat', this.authSecret,
                '-WorkspaceName', this.workspaceName
            ];

            if (this.workspaceOwner) {
                psArgs.push('-WorkspaceOwner', this.workspaceOwner);
            }

            const child = spawn('powershell.exe', psArgs, {
                cwd: process.cwd(),
                shell: false,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (error) => {
                reject(new Error(`PowerShell TFVC operation error: ${error.message}`));
            });

            child.on('close', (code) => {
                const output = stdout.trim();

                if (output) {
                    try {
                        const result = JSON.parse(output);
                        if (result.success) {
                            logger.info(`TFVC operation ${operation} succeeded`, result);
                            resolve(result);
                        } else {
                            reject(new Error(result.error || `TFVC operation ${operation} failed`));
                        }
                        return;
                    } catch (_) {
                        // Not JSON — fall through
                    }
                }

                if (code === 0) {
                    resolve({ success: true, stdout: output, stderr: stderr.trim() });
                } else {
                    const errorMsg = stderr.trim() || output || `TFVC operation ${operation} failed with exit code ${code}`;
                    reject(new Error(errorMsg));
                }
            });
        });
    }

    async validateWorkspaceContext() {
        const result = await this.executeTfvcOperation('workspaces');

        this.workspaceMappings = (result.folders || []).map(f => ({
            serverPath: f.serverItem,
            localPath: f.localItem
        }));

        this.sourceLocalPath = this.getExactMappedPath(this.sourceBranchPath);
        this.targetLocalPath = this.getExactMappedPath(this.targetBranchPath);

        if (!this.sourceLocalPath || !this.targetLocalPath) {
            throw new Error('Source or target branch is not mapped in the configured TFVC workspace.');
        }

        await this.ensureLocalPath(this.sourceLocalPath);
        await this.ensureLocalPath(this.targetLocalPath);

        logger.info('Workspace validated', {
            workspace: result.name,
            owner: result.owner,
            sourceLocalPath: this.sourceLocalPath,
            targetLocalPath: this.targetLocalPath,
            mappings: this.workspaceMappings.length
        });
    }

    async refreshTargetOnly() {
        await this.getLatestBranch(this.targetBranchPath, 'target');
        return {
            skipped: true,
            hasChanges: true,
            targetRefreshed: true,
            message: 'TFVC merge skipped; target branch refreshed'
        };
    }

    async executeMergeWorkflow() {
        await this.getLatestBranch(this.sourceBranchPath, 'source');

        // Check if there are unmerged changesets from source → target
        const candidates = await this.checkMergeCandidates();
        if (candidates.count === 0) {
            logger.info('No unmerged changesets from source to target, nothing to do');
            return {
                skipped: false,
                hasChanges: false,
                changeset: null,
                targetRefreshed: false,
                message: 'No changes to merge from source into target branch'
            };
        }

        logger.info(`Found ${candidates.count} unmerged changeset(s) from source to target`, {
            count: candidates.count,
            changesets: candidates.changesets
        });

        // Step 1: Bump descriptor on SOURCE branch and check it in
        await this.bumpDescriptorVersion(this.sourceLocalPath, this.sourceBranchPath);
        const sourceChangeset = await this.checkInChanges(
            this.sourceBranchPath,
            `${this.modelName} ${this.lastVersionLabel || 'descriptor version bump'}`
        );
        logger.info('Descriptor version bumped on source branch', {
            changeset: sourceChangeset,
            version: this.lastVersionLabel
        });

        // Step 2: Merge source → target (includes the descriptor bump)
        const mergeResult = await this.mergeSourceIntoTarget();

        // Safety-net conflict check (mergeSourceIntoTarget already checks, but be thorough)
        const conflicts = await this.queryConflicts();
        if (conflicts.count > 0) {
            throw new Error(
                `${conflicts.count} conflict(s) detected after merge. Resolve them in Visual Studio and rerun the deployment.`
            );
        }

        // Step 3: Check in merged changes on target (same version label as source)
        const targetChangeset = await this.checkInChanges(
            this.targetBranchPath,
            `${this.modelName} ${this.lastVersionLabel || 'descriptor version bump'}`
        );
        await this.getLatestBranch(this.targetBranchPath, 'target');

        return {
            skipped: false,
            hasChanges: true,
            sourceChangeset,
            targetChangeset,
            targetRefreshed: true,
            message: `Source branch merged into target branch (source changeset ${sourceChangeset || 'N/A'}, target changeset ${targetChangeset || 'N/A'})`
        };
    }

    async checkMergeCandidates() {
        logger.info('Checking for unmerged changesets', {
            sourceBranch: this.sourceBranchPath,
            targetBranch: this.targetBranchPath
        });

        return this.executeTfvcOperation('mergecandidates', {
            sourcePath: this.sourceBranchPath,
            targetPath: this.targetBranchPath
        });
    }

    async getLatestBranch(branchPath, label) {
        logger.info(`Getting latest for ${label} branch`, { branch: branchPath });

        const mappings = this.getMappedPathsForBranch(branchPath);
        if (mappings.length === 0) {
            throw new Error(`No TFVC mappings found for branch ${branchPath}`);
        }

        for (const mapping of mappings) {
            await this.ensureLocalPath(mapping.localPath);
            logger.info('Refreshing TFVC mapped path', {
                branch: branchPath,
                label,
                mappedServerPath: mapping.serverPath,
                localPath: mapping.localPath
            });

            const result = await this.executeTfvcOperation('getlatest', {
                branchPath: mapping.serverPath
            });

            if (result.numConflicts > 0) {
                throw new Error(
                    `${result.numConflicts} conflict(s) detected while getting latest on ${label} branch (${mapping.serverPath}). ` +
                    'Resolve conflicts in Visual Studio and rerun the deployment.'
                );
            }
        }
    }

    async mergeSourceIntoTarget() {
        logger.info('Merging source branch into target branch', {
            sourceBranch: this.sourceBranchPath,
            targetBranch: this.targetBranchPath
        });

        const result = await this.executeTfvcOperation('merge', {
            sourcePath: this.sourceBranchPath,
            targetPath: this.targetBranchPath
        });

        if (result.numConflicts > 0) {
            // Query the actual conflicts to inspect them
            const conflictsResult = await this.queryConflicts();
            const descriptorFileName = `${this.modelName}.xml`.toLowerCase();

            const descriptorConflicts = [];
            const nonDescriptorConflicts = [];

            for (const conflict of (conflictsResult.conflicts || [])) {
                const serverItem = (conflict.serverItem || '').toLowerCase();
                if (serverItem.endsWith(`/descriptor/${descriptorFileName}`)) {
                    descriptorConflicts.push(conflict);
                } else {
                    nonDescriptorConflicts.push(conflict);
                }
            }

            // Non-descriptor conflicts must NEVER be auto-resolved
            if (nonDescriptorConflicts.length > 0) {
                const conflictPaths = nonDescriptorConflicts.map(c => c.serverItem).join(', ');
                throw new Error(
                    `${nonDescriptorConflicts.length} merge conflict(s) detected merging ${this.sourceBranchPath} into ${this.targetBranchPath}: ${conflictPaths}. ` +
                    'Resolve conflicts in Visual Studio and rerun the deployment.'
                );
            }

            // Only descriptor conflicts — auto-resolve with AcceptTheirs (take source version)
            if (descriptorConflicts.length > 0) {
                logger.info(`${descriptorConflicts.length} descriptor conflict(s) detected, auto-resolving with AcceptTheirs (source version)`);

                const resolveResult = await this.executeTfvcOperation('resolveconflicts', {
                    path: this.targetBranchPath,
                    resolution: 'AcceptTheirs'
                });

                logger.info('Descriptor conflict auto-resolve result', {
                    resolvedCount: resolveResult.resolvedCount,
                    failedCount: resolveResult.failedCount
                });

                if (resolveResult.failedCount > 0) {
                    throw new Error(
                        `Failed to auto-resolve descriptor conflict. Resolve in Visual Studio and rerun the deployment.`
                    );
                }
            }
        }

        return result;
    }

    async queryConflicts() {
        return this.executeTfvcOperation('conflicts', {
            path: this.targetBranchPath
        });
    }

    async bumpDescriptorVersion(localPath, branchPath) {
        const resolvedLocalPath = localPath || this.targetLocalPath;
        const resolvedBranchPath = branchPath || this.targetBranchPath;

        const descriptorPath = this.getDescriptorPath(resolvedLocalPath, resolvedBranchPath);
        if (!descriptorPath) {
            throw new Error(`Descriptor file not found for model ${this.modelName}`);
        }

        await this.executeTfvcOperation('edit', {
            filePath: descriptorPath
        });

        const xml = fs.readFileSync(descriptorPath, 'utf8');
        const version = this.parseDescriptorVersion(xml);
        const nextRevision = version.revision + 1;
        const updatedXml = xml.replace(
            new RegExp(`(<VersionRevision>)(\\s*)${version.revision}(\\s*)(</VersionRevision>)`, 'i'),
            `$1$2${nextRevision}$3$4`
        );

        fs.writeFileSync(descriptorPath, updatedXml, 'utf8');
        this.lastVersionLabel = `${version.major}.0.${version.minor}.${version.build}.${nextRevision}`;
    }

    async checkInChanges(branchPath, comment) {
        const resolvedPath = branchPath || this.targetBranchPath;
        const resolvedComment = (comment || (this.lastVersionLabel
            ? `${this.modelName} ${this.lastVersionLabel}`
            : `Auto-deployment merge from ${this.sourceBranch} to ${this.targetBranch}`))
            .replace(/"/g, '\'');

        const result = await this.executeTfvcOperation('checkin', {
            path: resolvedPath,
            comment: resolvedComment
        });

        return result.changeset || null;
    }

    getExactMappedPath(serverPath) {
        const normalized = serverPath.toLowerCase();
        const match = this.workspaceMappings.find(mapping => mapping.serverPath.toLowerCase() === normalized);
        return match ? match.localPath : null;
    }

    getMappedPathsForBranch(branchPath) {
        const normalized = branchPath.toLowerCase();
        return this.workspaceMappings
            .filter(mapping => {
                const serverPath = mapping.serverPath.toLowerCase();
                return serverPath === normalized || serverPath.startsWith(`${normalized}/`);
            })
            .sort((left, right) => right.serverPath.length - left.serverPath.length);
    }

    async ensureLocalPath(localPath) {
        if (!fs.existsSync(localPath)) {
            fs.mkdirSync(localPath, { recursive: true });
        }
    }

    getDescriptorPath(baseLocalPath, branchPath) {
        // The descriptor's server path under the specified branch (defaults to target)
        const resolvedBranchPath = branchPath || this.targetBranchPath;
        const descriptorServerPath = `${resolvedBranchPath}/Main/Metadata/${this.modelName}/Descriptor/${this.modelName}.xml`;

        // Check workspace mappings to resolve the local path
        // (handles sub-mappings like $/project/branch/.../NMBPP → K:\...\NMBPP)
        // Sort by longest server path first so the most specific mapping wins
        const sorted = [...this.workspaceMappings].sort((a, b) => b.serverPath.length - a.serverPath.length);
        for (const mapping of sorted) {
            if (descriptorServerPath.toLowerCase().startsWith(mapping.serverPath.toLowerCase())) {
                const relativePath = descriptorServerPath
                    .substring(mapping.serverPath.length)
                    .replace(/\//g, path.sep);
                const candidate = path.join(mapping.localPath, relativePath);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }

        // Fallback: standard path under the base local path
        const fallbackPath = path.join(
            baseLocalPath,
            'Main',
            'Metadata',
            this.modelName,
            'Descriptor',
            `${this.modelName}.xml`
        );

        return fs.existsSync(fallbackPath) ? fallbackPath : null;
    }

    parseDescriptorVersion(xmlContent) {
        const readTag = (tag) => {
            const match = xmlContent.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
            if (!match) {
                throw new Error(`Unable to locate ${tag} in descriptor XML`);
            }
            return parseInt(match[1].trim(), 10);
        };

        return {
            major: readTag('VersionMajor'),
            minor: readTag('VersionMinor'),
            build: readTag('VersionBuild'),
            revision: readTag('VersionRevision')
        };
    }

    validateConfiguration() {
        const required = [
            ['TFVC_COLLECTION_URL', this.collectionUrl],
            ['TFVC_PROJECT_NAME', this.projectName],
            ['SOURCE_BRANCH', this.sourceBranch],
            ['TARGET_BRANCH', this.targetBranch],
            ['TFVC_WORKSPACE', this.workspaceName],
            ['TFVC credential (TFVC_PAT/AZURE_PAT/TFVC_PASSWORD)', this.authSecret]
        ];

        const missing = required.filter(([, value]) => !value).map(([name]) => name);
        if (missing.length > 0) {
            throw new Error(`Missing required TFVC configuration: ${missing.join(', ')}`);
        }
    }

    resolveCredential(mode) {
        const normalizedMode = (mode || 'auto').trim().toLowerCase();
        const tfvcPat = (process.env.TFVC_PAT || '').trim();
        const azurePat = (process.env.AZURE_PAT || '').trim();
        const password = (process.env.TFVC_PASSWORD || '').trim();

        const patValue = tfvcPat || azurePat;
        const patSource = tfvcPat ? 'TFVC_PAT' : (azurePat ? 'AZURE_PAT' : null);

        if (normalizedMode === 'pat') {
            return { value: patValue, source: patSource || 'PAT' };
        }

        if (normalizedMode === 'password') {
            return { value: password, source: 'TFVC_PASSWORD' };
        }

        if (patValue) {
            return { value: patValue, source: patSource || 'PAT' };
        }

        return { value: password, source: 'TFVC_PASSWORD' };
    }

    normalizeCollectionUrl(rawUrl) {
        if (!rawUrl) {
            return rawUrl;
        }

        const parsed = new URL(rawUrl);
        if (parsed.hostname.toLowerCase().endsWith('visualstudio.com') && (!parsed.pathname || parsed.pathname === '/')) {
            parsed.pathname = '/DefaultCollection';
        }
        return parsed.toString().replace(/\/+$/, '');
    }

    getBooleanEnv(value, defaultValue) {
        if (value === undefined || value === null || value === '') {
            return defaultValue;
        }

        const normalized = value.toString().trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return defaultValue;
    }

    shouldNotify() {
        return process.env.SUPPRESS_STEP_NOTIFICATIONS !== 'true';
    }
}

if (require.main === module) {
    const runner = new TFVCMerge();
    runner.execute()
        .then((result) => {
            console.log(result.message);
            process.exit(0);
        })
        .catch((error) => {
            console.error(`TFVC branch operation failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = TFVCMerge;
