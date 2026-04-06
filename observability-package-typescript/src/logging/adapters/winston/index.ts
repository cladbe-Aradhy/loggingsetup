'use strict';

const Transport = require('winston-transport');
const { resolveSeverity } = require('../../core/severity');

const WINSTON_TRANSPORT_SYMBOL = Symbol.for('observability.winston.transport');

function createWinstonTransport(packageLogger, bindings) {
  return new class ObservabilityWinstonTransport extends Transport {
    log(info, callback) {
      const level = info.level === 'verbose' ? 'debug' : info.level;
      const message = info.message || 'winston log';
      const resolvedLevel = resolveSeverity({
        fallbackLevel: level,
        message,
        fields: info
      });

      packageLogger[resolvedLevel] ? packageLogger[resolvedLevel](message, {
        logger_type: 'winston',
        ...(bindings || {}),
        ...info
      }) : packageLogger.info(message, {
        logger_type: 'winston',
        ...(bindings || {}),
        ...info
      });

      if (typeof callback === 'function') {
        callback();
      }
    }
  }();
}

function instrumentWinstonLogger(winstonLogger, packageLogger, bindings) {
  if (winstonLogger[WINSTON_TRANSPORT_SYMBOL]) {
    return {
      logger: winstonLogger,
      transport: winstonLogger[WINSTON_TRANSPORT_SYMBOL]
    };
  }

  const transport = createWinstonTransport(packageLogger, bindings);
  winstonLogger.add(transport);
  winstonLogger[WINSTON_TRANSPORT_SYMBOL] = transport;
  return {
    logger: winstonLogger,
    transport
  };
}

module.exports = {
  createWinstonTransport,
  instrumentWinstonLogger
};
