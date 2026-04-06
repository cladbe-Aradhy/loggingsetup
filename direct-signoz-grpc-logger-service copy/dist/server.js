"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const logger_1 = require("./logger");
const server = app_1.app.listen(config_1.config.port, () => {
    logger_1.logger.info('direct signoz grpc logger service listening', {
        port: config_1.config.port,
        signoz_logs_grpc_url: config_1.config.signozLogsGrpcUrl
    });
});
let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    server.close(async () => {
        await (0, logger_1.shutdownLogger)();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
