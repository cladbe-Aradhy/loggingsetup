import axios from 'axios';
import { config } from './config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

type AppLogger = {
  child(bindings?: LogFields): AppLogger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};

const axiosClient = axios.create({
  timeout: 10000
});

function toSeverityNumber(level: LogLevel) {
  if (level === 'error') {
    return 17;
  }

  if (level === 'warn') {
    return 13;
  }

  if (level === 'debug') {
    return 5;
  }

  return 9;
}

function toOtlpAttributes(fields: LogFields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      key,
      value: {
        stringValue: typeof value === 'string' ? value : JSON.stringify(value)
      }
    }));
}

function consoleMirror(level: LogLevel, message: string, fields: LogFields) {
  if (!config.enableConsoleMirror) {
    return;
  }

  const payload = {
    level,
    message,
    ...fields
  };

  if (level === 'error') {
    console.error(payload);
    return;
  }

  if (level === 'warn') {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

async function sendToSigNoz(level: LogLevel, message: string, fields: LogFields) {
  const payload = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: {
                stringValue: config.serviceName
              }
            },
            {
              key: 'service.version',
              value: {
                stringValue: config.serviceVersion
              }
            },
            {
              key: 'deployment.environment.name',
              value: {
                stringValue: config.nodeEnv
              }
            }
          ]
        },
        scopeLogs: [
          {
            scope: {
              name: 'direct-signoz-logger',
              version: '1.0.0'
            },
            logRecords: [
              {
                timeUnixNano: String(Date.now() * 1_000_000),
                severityNumber: toSeverityNumber(level),
                severityText: level.toUpperCase(),
                body: {
                  stringValue: message
                },
                attributes: toOtlpAttributes(fields)
              }
            ]
          }
        ]
      }
    ]
  };




  try {
    await axiosClient.post(config.signozLogsUrl, payload, {
      headers: {
        'content-type': 'application/json'
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error({
      level: 'error',
      message: 'failed to send log to signoz',
      signozLogsUrl: config.signozLogsUrl,
      originalMessage: message,
      sendError: errorMessage
    });
  }
}




function createLogger(bindings: LogFields = {}): AppLogger {
  function emit(level: LogLevel, message: string, fields: LogFields = {}) {
    const mergedFields = {
      ...bindings,
      ...fields
    };

    consoleMirror(level, message, mergedFields);
    void sendToSigNoz(level, message, mergedFields);
  }

  return {
    child(childBindings: LogFields = {}) {
      return createLogger({
        ...bindings,
        ...childBindings
      });
    },
    debug(message: string, fields?: LogFields) {
      emit('debug', message, fields);
    },
    info(message: string, fields?: LogFields) {
      emit('info', message, fields);
    },
    warn(message: string, fields?: LogFields) {
      emit('warn', message, fields);
    },
    error(message: string, fields?: LogFields) {
      emit('error', message, fields);
    }
  };
}

export type { AppLogger, LogFields };


export const logger = createLogger();
