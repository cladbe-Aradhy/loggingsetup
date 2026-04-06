"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const logger_1 = require("./logger");
const server = app_1.app.listen(config_1.config.port, () => {
    logger_1.logger.info('direct signoz logger service listening', {
        port: config_1.config.port,
        signoz_logs_url: config_1.config.signozLogsUrl
    });
});
function shutdown() {
    server.close(() => {
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
