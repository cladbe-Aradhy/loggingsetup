'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { createLogger } = require('../../src/logging/core/logger');
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function createConfig() {
    return {
        serviceName: 'dedupe-test-service',
        serviceVersion: '1.0.0',
        environment: 'test',
        logLevel: 'info',
        enableConsoleMirror: false,
        consoleMirrorInDevelopmentOnly: true,
        redactKeys: [],
        smartSeverityDetection: true,
        emitOnlyWarnErrorFatal: false,
        debug: false,
        logDedupeEnabled: true,
        logDedupeWindowMs: 25,
        logDedupeLevels: ['warn', 'error', 'fatal']
    };
}
async function main() {
    const scenario = process.argv[2];
    const state = {
        otelLogger: null,
        logDedupeEntries: new Map()
    };
    const logger = createLogger(createConfig(), state);
    if (scenario === 'repeat-error') {
        logger.error('DB failed', {
            logger_type: 'console',
            http_method: 'GET',
            http_route: '/orders',
            http_status_code: 500,
            error: new Error('DB failed')
        });
        logger.error('DB failed', {
            logger_type: 'console',
            http_method: 'GET',
            http_route: '/orders',
            http_status_code: 500,
            error: new Error('DB failed')
        });
        await delay(60);
        return;
    }
    if (scenario === 'repeat-info') {
        logger.info('request started', {
            logger_type: 'application',
            http_method: 'GET',
            http_route: '/health',
            http_status_code: 200
        });
        logger.info('request started', {
            logger_type: 'application',
            http_method: 'GET',
            http_route: '/health',
            http_status_code: 200
        });
        await delay(10);
        return;
    }
    if (scenario === 'different-routes') {
        logger.error('DB failed', {
            logger_type: 'console',
            http_method: 'GET',
            http_route: '/orders',
            http_status_code: 500,
            error: new Error('DB failed')
        });
        logger.error('DB failed', {
            logger_type: 'console',
            http_method: 'GET',
            http_route: '/payments',
            http_status_code: 500,
            error: new Error('DB failed')
        });
        await delay(60);
        return;
    }
    if (scenario === 'error-metadata') {
        const cause = new Error('database timed out');
        cause.code = 'DB_TIMEOUT';
        cause.status = 504;
        const error = new Error('request failed');
        error.code = 'ORDER_LOOKUP_FAILED';
        error.status = 500;
        error.statusCode = 502;
        error.cause = cause;
        logger.error('request failed', {
            logger_type: 'application',
            authorization: 'Bearer secret-token',
            error
        });
        await delay(10);
        return;
    }
    throw new Error('Unknown scenario: ' + scenario);
}
main().catch((error) => {
    process.stderr.write(error.stack + '\n');
    process.exit(1);
});
