const winston = require('winston');
const fs = require('fs-extra');
const path = require('path');

class Logger {
    constructor() {
        this.logger = null;
        this.initialize();
    }

    async initialize() {
        // Ensure logs directory exists
        const logsDir = path.join(process.cwd(), 'logs');
        await fs.ensureDir(logsDir);

        const logLevel = process.env.LOG_LEVEL || 'info';
        const logFilePath = process.env.LOG_FILE_PATH || path.join(logsDir, 'deployment.log');
        const maxSize = process.env.MAX_LOG_SIZE || '10m';
        const maxFiles = parseInt(process.env.MAX_LOG_FILES) || 5;

        const logFormat = winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            winston.format.errors({ stack: true }),
            winston.format.json(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                return JSON.stringify({
                    timestamp: new Date().toISOString(), // Use current actual timestamp
                    level: level.toUpperCase(),
                    message,
                    ...meta
                });
            })
        );

        this.logger = winston.createLogger({
            level: logLevel,
            format: logFormat,
            transports: [
                new winston.transports.File({
                    filename: logFilePath,
                    maxsize: this.parseSize(maxSize),
                    maxFiles: maxFiles,
                    tailable: true
                }),
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple(),
                        winston.format.printf(({ timestamp, level, message, ...meta }) => {
                            return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                        })
                    )
                })
            ],
            handleExceptions: true,
            handleRejections: true
        });
    }

    parseSize(sizeStr) {
        const units = { b: 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 };
        const match = sizeStr.toLowerCase().match(/^(\d+)([bkmg]?)$/);
        if (!match) return 10 * 1024 * 1024; // Default 10MB
        const [, size, unit] = match;
        return parseInt(size) * (units[unit] || 1);
    }

    info(message, meta = {}) {
        if (this.logger) {
            this.logger.info(message, meta);
        }
    }

    error(message, meta = {}) {
        if (this.logger) {
            this.logger.error(message, meta);
        }
    }

    warn(message, meta = {}) {
        if (this.logger) {
            this.logger.warn(message, meta);
        }
    }

    debug(message, meta = {}) {
        if (this.logger) {
            this.logger.debug(message, meta);
        }
    }

    startStep(stepName, meta = {}) {
        this.info(`Starting step: ${stepName}`, { ...meta, step: stepName, status: 'started' });
    }

    completeStep(stepName, meta = {}) {
        this.info(`Completed step: ${stepName}`, { ...meta, step: stepName, status: 'completed' });
    }

    failStep(stepName, error, meta = {}) {
        this.error(`Failed step: ${stepName}`, {
            ...meta,
            step: stepName,
            status: 'failed',
            error: error.message || error,
            stack: error.stack
        });
    }

    async createDeploymentLog(deploymentId) {
        const deploymentLogDir = path.join(process.cwd(), 'logs', deploymentId);
        await fs.ensureDir(deploymentLogDir);
        return deploymentLogDir;
    }
}

module.exports = new Logger();