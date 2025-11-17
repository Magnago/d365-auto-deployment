const { spawn, exec } = require('child_process');
const util = require('util');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

class PowerShellRunner {
    constructor() {
        this.defaultTimeout = 30 * 60 * 1000; // 30 minutes default timeout
    }

    /**
     * Execute PowerShell command with proper error handling
     * @param {string} script - PowerShell script or command to execute
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} - Execution result
     */
    async execute(script, options = {}) {
        const {
            timeout = this.defaultTimeout,
            cwd = null,
            workingDirectory = null,
            throwOnError = true,
            logOutput = true,
            executionPolicy = 'RemoteSigned',
            deploymentLogDir = null,
            nonInteractive = false
        } = options;

        return new Promise((resolve, reject) => {
            const workDir = cwd || workingDirectory || process.cwd();

            // Prepare PowerShell execution command
            let psCommand = script;
            if (!script.includes('Set-ExecutionPolicy')) {
                psCommand = `Set-ExecutionPolicy -ExecutionPolicy ${executionPolicy} -Scope Process -Force; ${script}`;
            }

            // Log the command (without sensitive data)
            const sanitizedScript = this.sanitizeForLogging(script);
            logger.debug('Executing PowerShell command', {
                command: sanitizedScript,
                workingDirectory: workDir
            });

            const startTime = Date.now();
            let stdout = '';
            let stderr = '';

            // Build PowerShell arguments
            const psArgs = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', psCommand
            ];

            // Add non-interactive flag if requested
            if (nonInteractive) {
                psArgs.splice(0, 0, '-NonInteractive');
            }

            // Spawn PowerShell process
            const ps = spawn('powershell.exe', psArgs, {
                cwd: workDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true
            });

            // Set up timeout
            const timeoutId = setTimeout(() => {
                ps.kill('SIGTERM');
                const timeoutError = new Error(`PowerShell command timed out after ${timeout}ms`);
                logger.error('PowerShell execution timeout', {
                    command: sanitizedScript,
                    timeout,
                    executionTime: Date.now() - startTime
                });
                reject(timeoutError);
            }, timeout);

            // Handle stdout
            ps.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;

                if (logOutput) {
                    // Log each line separately for better readability
                    output.split('\n').filter(line => line.trim()).forEach(line => {
                        logger.debug('PowerShell stdout', { line: line.trim() });
                    });
                }

                // Save to deployment log file if provided
                if (deploymentLogDir) {
                    this.appendToDeploymentLog(deploymentLogDir, 'stdout', output);
                }
            });

            // Handle stderr
            ps.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;

                if (logOutput) {
                    output.split('\n').filter(line => line.trim()).forEach(line => {
                        logger.warn('PowerShell stderr', { line: line.trim() });
                    });
                }

                // Save to deployment log file if provided
                if (deploymentLogDir) {
                    this.appendToDeploymentLog(deploymentLogDir, 'stderr', output);
                }
            });

            // Handle process completion
            ps.on('close', (code) => {
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
                    const error = new Error(`PowerShell command failed with exit code ${code}: ${stderr}`);
                    error.exitCode = code;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.executionTime = executionTime;
                    reject(error);
                } else {
                    resolve(result);
                }
            });

            // Handle process errors
            ps.on('error', (error) => {
                clearTimeout(timeoutId);
                logger.error('PowerShell process error', {
                    command: sanitizedScript,
                    error: error.message
                });
                reject(error);
            });
        });
    }

    /**
     * Execute PowerShell script file
     * @param {string} scriptPath - Path to PowerShell script file
     * @param {Array} arguments - Script arguments
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} - Execution result
     */
    async executeScript(scriptPath, args = [], options = {}) {
        if (!await fs.pathExists(scriptPath)) {
            throw new Error(`PowerShell script not found: ${scriptPath}`);
        }

        // Build command with arguments
        let command = `& "${scriptPath}"`;
        if (args.length > 0) {
            command += ' ' + args.map(arg => {
                // Quote arguments that contain spaces
                if (arg.includes(' ')) {
                    return `"${arg}"`;
                }
                return arg;
            }).join(' ');
        }

        return this.execute(command, options);
    }

    /**
     * Execute D365 specific PowerShell cmdlets
     * @param {string} cmdlet - D365 cmdlet to execute
     * @param {Object} parameters - Cmdlet parameters
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} - Execution result
     */
    async executeD365Cmdlet(cmdlet, parameters = {}, options = {}) {
        // Build parameter string
        const paramStrings = [];
        for (const [key, value] of Object.entries(parameters)) {
            if (value !== null && value !== undefined) {
                if (typeof value === 'boolean') {
                    paramStrings.push(`-${key}:${'$' + value}`);
                } else if (typeof value === 'string' && value.includes(' ')) {
                    paramStrings.push(`-${key} "${value}"`);
                } else {
                    paramStrings.push(`-${key} ${value}`);
                }
            }
        }

        const command = `${cmdlet} ${paramStrings.join(' ')}`;
        return this.execute(command, {
            ...options,
            timeout: options.timeout || 60 * 60 * 1000 // 1 hour default for D365 operations
        });
    }

    /**
     * Check if running in elevated mode (Administrator)
     * @returns {Promise<boolean>}
     */
    async isElevated() {
        try {
            const result = await this.execute(
                '([System.Security.Principal.WindowsPrincipal] [System.Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)',
                { logOutput: false }
            );
            return result.stdout.trim().toLowerCase() === 'true';
        } catch (error) {
            logger.warn('Failed to check elevation status', { error: error.message });
            return false;
        }
    }

    /**
     * Sanitize script for logging (remove sensitive information)
     * @param {string} script - PowerShell script
     * @returns {string} - Sanitized script
     */
    sanitizeForLogging(script) {
        // Remove potential passwords, tokens, and other sensitive data
        return script
            .replace(/(["']?)(password|token|key|secret)\1\s*=\s*["'][^"']+["']/gi, '$1$2=$3***$3')
            .replace(/(["']?)(connectionString|api[_-]?key)\1\s*=\s*["'][^"']+["']/gi, '$1$2=$3***$3')
            .substring(0, 200) + (script.length > 200 ? '...' : '');
    }

    /**
     * Append output to deployment log file
     * @param {string} logDir - Deployment log directory
     * @param {string} type - Log type (stdout/stderr)
     * @param {string} content - Log content
     */
    async appendToDeploymentLog(logDir, type, content) {
        try {
            // Ensure log directory exists
            await fs.ensureDir(logDir);
            const logFile = path.join(logDir, `${type}.log`);
            await fs.appendFile(logFile, content, 'utf8');
        } catch (error) {
            logger.warn('Failed to write to deployment log file', {
                logDir,
                type,
                error: error.message
            });
        }
    }

    /**
     * Execute multiple PowerShell commands in sequence
     * @param {Array<string>} commands - Array of PowerShell commands
     * @param {Object} options - Execution options
     * @returns {Promise<Array<Object>>} - Array of results
     */
    async executeSequence(commands, options = {}) {
        const results = [];

        for (let i = 0; i < commands.length; i++) {
            try {
                logger.debug(`Executing command ${i + 1}/${commands.length}`);
                const result = await this.execute(commands[i], options);
                results.push(result);
            } catch (error) {
                if (options.stopOnError !== false) {
                    throw error;
                }
                results.push({
                    success: false,
                    error: error.message,
                    code: error.exitCode || -1
                });
            }
        }

        return results;
    }
}

module.exports = PowerShellRunner;