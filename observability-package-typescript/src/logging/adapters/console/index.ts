'use strict';

const util = require('util');
const { resolveSeverity } = require('../../core/severity');

function createConsoleCapture(rootLogger, config) {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  function wrapConsoleMethod(level, originalMethod) {
    return function patchedConsoleMethod() {
      const args = Array.from(arguments);
      const message = util.format.apply(util, args);
      const resolvedLevel = resolveSeverity({
        fallbackLevel: level,
        message,
        args,
        smartSeverityDetection: config.smartSeverityDetection
      });

      rootLogger.emitWithArgs(resolvedLevel, message, {
        logger_type: 'console'
      }, args);

      if (config.enableConsoleMirror && (config.environment !== 'production' || !config.consoleMirrorInDevelopmentOnly)) {
        originalMethod.apply(console, args);
      }
    };
  }

  console.log = wrapConsoleMethod('info', original.log);
  console.info = wrapConsoleMethod('info', original.info);
  console.warn = wrapConsoleMethod('warn', original.warn);
  console.error = wrapConsoleMethod('error', original.error);
  console.debug = wrapConsoleMethod('debug', original.debug);

  return function restoreConsole() {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  };
}

module.exports = {
  createConsoleCapture
};
