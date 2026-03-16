const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

class PowerShellRunner {
    constructor() {
        this.defaultTimeout = 30 * 60 * 1000;
    }

    async execute(script, options = {}) {
        const timeout = options.timeout || this.defaultTimeout;
        const cwd = options.cwd || options.workingDirectory || process.cwd();
        const throwOnError = options.throwOnError !== false;
        const logOutput = options.logOutput !== false;
        const executionPolicy = options.executionPolicy || 'RemoteSigned';
        const deploymentLogDir = options.deploymentLogDir || null;
        const nonInteractive = options.nonInteractive === true;

        return new Promise((resolve, reject) => {
            const psCommand = script.includes('Set-ExecutionPolicy')
                ? script
                : `Set-ExecutionPolicy -ExecutionPolicy ${executionPolicy} -Scope Process -Force; ${script}`;
            const sanitizedScript = this.sanitizeForLogging(script);
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';

            const args = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', psCommand
            ];

            if (nonInteractive) {
                args.unshift('-NonInteractive');
            }

            logger.debug('Executing PowerShell command', {
                command: sanitizedScript,
                workingDirectory: cwd
            });

            const child = spawn('powershell.exe', args, {
                cwd,
                shell: false,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            const timeoutId = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new Error(`PowerShell command timed out after ${timeout}ms`));
            }, timeout);

            child.stdout.on('data', (chunk) => {
                const output = chunk.toString();
                stdout += output;
                if (logOutput) {
                    output.split(/\r?\n/).filter(Boolean).forEach(line => {
                        logger.debug('PowerShell stdout', { line: line.trim() });
                    });
                }
                if (deploymentLogDir) {
                    this.appendToDeploymentLog(deploymentLogDir, 'stdout', output);
                }
            });

            child.stderr.on('data', (chunk) => {
                const output = chunk.toString();
                stderr += output;
                if (logOutput) {
                    output.split(/\r?\n/).filter(Boolean).forEach(line => {
                        logger.warn('PowerShell stderr', { line: line.trim() });
                    });
                }
                if (deploymentLogDir) {
                    this.appendToDeploymentLog(deploymentLogDir, 'stderr', output);
                }
            });

            child.on('error', (error) => {
                clearTimeout(timeoutId);
                reject(new Error(`PowerShell process error: ${error.message}`));
            });

            child.on('close', (code) => {
                clearTimeout(timeoutId);
                const executionTime = Date.now() - startTime;
                const result = {
                    code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    executionTime,
                    success: code === 0
                };

                logger.debug('PowerShell execution completed', {
                    command: sanitizedScript,
                    exitCode: code,
                    executionTime,
                    success: result.success
                });

                if (code !== 0 && throwOnError) {
                    const details = result.stderr || result.stdout || `exit code ${code}`;
                    const error = new Error(`PowerShell command failed with exit code ${code}: ${details}`);
                    error.exitCode = code;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.executionTime = executionTime;
                    reject(error);
                    return;
                }

                resolve(result);
            });
        });
    }

    sanitizeForLogging(script) {
        return script
            .replace(/(["']?)(password|token|key|secret)\1\s*=\s*["'][^"']+["']/gi, '$1$2=***')
            .replace(/(["']?)(connectionString|api[_-]?key)\1\s*=\s*["'][^"']+["']/gi, '$1$2=***')
            .slice(0, 200) + (script.length > 200 ? '...' : '');
    }

    async appendToDeploymentLog(logDir, type, content) {
        try {
            await fs.ensureDir(logDir);
            await fs.appendFile(path.join(logDir, `${type}.log`), content, 'utf8');
        } catch (error) {
            logger.warn('Failed to append PowerShell deployment log', {
                logDir,
                type,
                error: error.message
            });
        }
    }
}

module.exports = PowerShellRunner;
