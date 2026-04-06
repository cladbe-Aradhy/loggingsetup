'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
async function main() {
    const scenario = process.argv[2];
    if (scenario === 'preload-express') {
        require('express');
    }
    const bootstrap = require('../../src/bootstrap');
    try {
        await bootstrap.initObservability({
            logLevel: 'fatal',
            enableConsoleCapture: false,
            captureUncaught: false,
            captureUnhandledRejection: false
        });
    }
    finally {
        await bootstrap.shutdownObservability().catch(() => undefined);
    }
}
main().catch((error) => {
    process.stderr.write(error.stack + '\n');
    process.exit(1);
});
