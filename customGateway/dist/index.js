"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const config_1 = require("./config");
const grpc_server_1 = require("./grpc/grpc-server");
const http_routes_1 = require("./routes/http-routes");
const queue_processor_1 = require("./services/queue-processor");
const shutdown_service_1 = require("./services/shutdown-service");
const app = new hono_1.Hono();
(0, http_routes_1.registerHttpRoutes)(app);
const grpcServer = (0, grpc_server_1.createGrpcLogsServer)();
const retryInterval = setInterval(() => {
    void (0, queue_processor_1.processStoredPayloadQueue)();
}, config_1.QUEUE_RETRY_INTERVAL_MS);
const httpServer = (0, node_server_1.serve)({
    fetch: app.fetch,
    port: config_1.PORT
}, (info) => {
    process.stdout.write(`custom-gateway HTTP listening on http://127.0.0.1:${info.port}\n`);
});
(0, grpc_server_1.startGrpcLogsServer)(grpcServer);
process.on('SIGTERM', () => {
    void (0, shutdown_service_1.startGracefulShutdown)('SIGTERM', retryInterval, httpServer, grpcServer);
});
process.on('SIGINT', () => {
    void (0, shutdown_service_1.startGracefulShutdown)('SIGINT', retryInterval, httpServer, grpcServer);
});
