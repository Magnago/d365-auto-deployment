const path = require('path');
const fs = require('fs-extra');
const D365Environment = require('../core/d365-environment');
const PowerShellRunner = require('../core/powershell-runner');
const logger = require('../core/logger');

class D365Build {
    constructor() {
        this.environment = new D365Environment();
        this.psRunner = new PowerShellRunner();
        this.defaultTimeout = 60 * 60 * 1000;
    }

    async buildModel(model, options = {}) {
        const timeout = Number(process.env.BUILD_TIMEOUT) || options.timeout || this.defaultTimeout;
        const deploymentLogDir = options.deploymentLogDir || null;

        logger.startStep('D365 Full Build', { model });

        try {
            const environmentType = await this.environment.detect();
            const paths = this.environment.getPaths(environmentType);
            await this.validateEnvironment(paths, model);

            const labelCommand = this.prepareLabelCommand(paths, model);
            logger.info('Starting D365 label build', {
                environmentType,
                model,
                packagesPath: paths.packages,
                binPath: paths.binPath,
                timeout
            });

            const labelResult = await this.psRunner.execute(labelCommand, {
                timeout,
                cwd: paths.binPath,
                logOutput: true,
                deploymentLogDir
            });

            logger.info('D365 label build completed', {
                model,
                executionTime: labelResult.executionTime
            });

            const command = this.prepareBuildCommand(paths, model);
            logger.info('Starting D365 build', {
                environmentType,
                model,
                packagesPath: paths.packages,
                binPath: paths.binPath,
                timeout
            });

            const buildStartedAt = Date.now();
            let result;
            try {
                result = await this.psRunner.execute(command, {
                    timeout,
                    cwd: paths.binPath,
                    logOutput: true,
                    deploymentLogDir
                });
            } catch (error) {
                // xppc.exe writes its diagnostics to the -log/-xmllog files, not to
                // stdout, so the raw failure only carries a phase timing table. Pull
                // the real errors in so the log and the Teams card can show them.
                const diagnostics = await this.collectBuildDiagnostics(paths, model, buildStartedAt);
                throw this.decorateBuildError(error, diagnostics, model);
            }

            logger.completeStep('D365 Full Build', {
                model,
                environmentType,
                executionTime: result.executionTime,
                labelExecutionTime: labelResult.executionTime
            });

            return {
                ...result,
                model,
                environmentType,
                paths,
                labelBuild: {
                    success: labelResult.success,
                    executionTime: labelResult.executionTime
                }
            };
        } catch (error) {
            logger.failStep('D365 Full Build', error, { model });
            throw error;
        }
    }

    async validateEnvironment(paths, model) {
        const requiredPaths = [
            paths.packages,
            paths.binPath,
            path.join(paths.binPath, 'xppc.exe'),
            path.join(paths.binPath, 'labelc.exe'),
            path.join(paths.packages, model),
            path.join(paths.packages, model, 'Descriptor', `${model}.xml`)
        ];

        for (const requiredPath of requiredPaths) {
            if (!await fs.pathExists(requiredPath)) {
                throw new Error(`Build prerequisite not found: ${requiredPath}`);
            }
        }
    }

    prepareLabelCommand(paths, model) {
        const labelcPath = path.join(paths.binPath, 'labelc.exe');
        const metadataPath = paths.packages;
        const modulePath = path.join(paths.packages, model);
        const labelLogPath = path.join(modulePath, `${model}.BuildLabelsResult.log`);
        const labelErrLogPath = path.join(modulePath, `${model}.BuildLabelsResult.err`);

        return [
            `& "${labelcPath}"`,
            `-metadata="${metadataPath}"`,
            `-modelmodule="${model}"`,
            `-output="${modulePath}"`,
            `-outlog="${labelLogPath}"`,
            `-errlog="${labelErrLogPath}"`
        ].join(' ');
    }

    prepareBuildCommand(paths, model) {
        const xppcPath = path.join(paths.binPath, 'xppc.exe');
        const metadataPath = paths.packages;
        const modulePath = path.join(paths.packages, model);
        const moduleBinPath = path.join(modulePath, 'bin');
        const buildLogPath = path.join(modulePath, `${model}.BuildModelResult.log`);
        const buildXmlLogPath = path.join(modulePath, `${model}.BuildModelResult.xml`);

        return [
            `& "${xppcPath}"`,
            `-metadata="${metadataPath}"`,
            `-compilermetadata="${metadataPath}"`,
            '-xref',
            `-appBase="${paths.binPath}"`,
            `-modelmodule="${model}"`,
            `-referenceFolder="${metadataPath}"`,
            `-refPath="${moduleBinPath}"`,
            `-output="${moduleBinPath}"`,
            `-log="${buildLogPath}"`,
            `-xmllog="${buildXmlLogPath}"`,
            '-verbose'
        ].join(' ');
    }

    async collectBuildDiagnostics(paths, model, since) {
        const modulePath = path.join(paths.packages, model);
        const errXmlPath = path.join(modulePath, `${model}.BuildModelResult.err.xml`);
        const logPath = path.join(modulePath, `${model}.BuildModelResult.log`);

        const fromXml = await this.readErrorXml(errXmlPath, since);
        if (fromXml) {
            return fromXml;
        }

        return this.readErrorLog(logPath, since);
    }

    async readErrorXml(filePath, since) {
        const content = await this.readIfFresh(filePath, since);
        if (!content) {
            return null;
        }

        const errors = [];
        const blocks = content.match(/<Diagnostic>[\s\S]*?<\/Diagnostic>/g) || [];

        for (const block of blocks) {
            const severity = this.matchTag(block, 'Severity');
            if (severity && severity.toLowerCase() !== 'error') {
                continue;
            }

            const message = this.matchTag(block, 'Message');
            if (!message) {
                continue;
            }

            errors.push({
                type: this.matchTag(block, 'DiagnosticType'),
                path: this.matchTag(block, 'Path'),
                message
            });
        }

        if (errors.length === 0) {
            return null;
        }

        return { errors, total: errors.length, source: path.basename(filePath) };
    }

    async readErrorLog(filePath, since) {
        const content = await this.readIfFresh(filePath, since);
        if (!content) {
            return null;
        }

        const errors = [];
        for (const line of content.split(/\r?\n/)) {
            const match = line.match(/^\s*(Compile|Metadata|Build)\s+Error:\s*(.+)$/);
            if (match) {
                errors.push({ type: match[1], path: null, message: match[2].trim() });
            }
        }

        if (errors.length === 0) {
            return null;
        }

        const reported = content.match(/^\s*Errors:\s*(\d+)/m);
        const total = reported ? Math.max(Number(reported[1]), errors.length) : errors.length;

        return { errors, total, source: path.basename(filePath) };
    }

    async readIfFresh(filePath, since) {
        try {
            const stats = await fs.stat(filePath);
            // A stale file is from an earlier run — reporting it would be misleading.
            if (Number.isFinite(since) && stats.mtimeMs < since) {
                return null;
            }
            return this.decodeXmlEntities(await fs.readFile(filePath, 'utf8'));
        } catch (_) {
            return null;
        }
    }

    matchTag(block, tag) {
        const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
        return match ? match[1].trim() : null;
    }

    decodeXmlEntities(value) {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }

    decorateBuildError(error, diagnostics, model) {
        if (!diagnostics || diagnostics.errors.length === 0) {
            return error;
        }

        const shown = diagnostics.errors.slice(0, 8);
        const lines = shown.map((diagnostic, index) => {
            const type = diagnostic.type ? `[${diagnostic.type}] ` : '';
            const location = diagnostic.path ? `${diagnostic.path} — ` : '';
            return `${index + 1}. ${type}${location}${diagnostic.message}`;
        });

        const hidden = diagnostics.total - shown.length;
        if (hidden > 0) {
            lines.push(`(+${hidden} more — see ${diagnostics.source})`);
        }

        const decorated = new Error(
            `X++ build failed for ${model} with ${diagnostics.total} error(s):\n${lines.join('\n')}`
        );
        decorated.diagnostics = diagnostics.errors;
        decorated.diagnosticsSource = diagnostics.source;
        decorated.originalMessage = error.message;
        return decorated;
    }
}

module.exports = D365Build;
