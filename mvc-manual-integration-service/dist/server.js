"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const observability_node_ts_1 = require("@my-org/observability-node-ts");
const env_1 = require("./config/env");
let server = null;
async function main() {
    await (0, observability_node_ts_1.initObservability)({
        serviceName: process.env.OTEL_SERVICE_NAME || 'mvc-manual-integration-service',
        serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || env_1.env.nodeEnv,
        otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4317',
        otlpProtocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'grpc'
    });
    const { app } = await Promise.resolve().then(() => __importStar(require('./app')));
    server = app.listen(env_1.env.port, () => {
        process.stdout.write(`mvc-manual-integration-service listening on http://127.0.0.1:${env_1.env.port}\n`);
    });
}
async function shutdown() {
    if (!server) {
        await (0, observability_node_ts_1.shutdownObservability)();
        process.exit(0);
        return;
    }
    server.close(async () => {
        await (0, observability_node_ts_1.shutdownObservability)();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
    process.exit(1);
});
