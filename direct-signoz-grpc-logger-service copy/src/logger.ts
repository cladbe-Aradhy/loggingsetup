import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { config } from './config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;
type AnyValuePayload =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { bytesValue: Buffer }
  | { arrayValue: { values: AnyValuePayload[] } }
  | { kvlistValue: { values: KeyValuePayload[] } };

type KeyValuePayload = {
  key: string;
  value: AnyValuePayload;
};

type AppLogger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};

const protoRoot = path.resolve(__dirname, '../proto');
const logsServiceProtoPath = path.join(
  protoRoot,
  'opentelemetry/proto/collector/logs/v1/logs_service.proto'
);

const packageDefinition = protoLoader.loadSync(logsServiceProtoPath, {
  longs: String,
  defaults: true,
  enums: Number,
  oneofs: true,
  includeDirs: [protoRoot]
});

const loadedDefinition = grpc.loadPackageDefinition(packageDefinition) as any;
const LogsServiceClient =
  loadedDefinition.opentelemetry.proto.collector.logs.v1.LogsService;

function usesTls(target: string) {
  return target.startsWith('https://') || target.startsWith('grpcs://');
}

function normalizeGrpcTarget(target: string) {
  return target.replace(/^[a-z]+:\/\//i, '');
}

const client = new LogsServiceClient(
  normalizeGrpcTarget(config.signozLogsGrpcUrl),
  usesTls(config.signozLogsGrpcUrl)
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure()
);

const pendingExports = new Set<Promise<void>>();
const resourceAttributes = [
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
];

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

// Convert normal JS values into OTLP AnyValue shapes.
function toAnyValue(value: unknown): AnyValuePayload {
  if (
    typeof value === 'string' ||
    value === null ||
    value === undefined
  ) {
    return {
      stringValue: value == null ? 'null' : value
    };
  }

  if (typeof value === 'boolean') {
    return {
      boolValue: value
    };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return {
        intValue: String(value)
      };
    }

    return {
      doubleValue: value
    };
  }

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return {
      bytesValue: Buffer.from(value)
    };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toAnyValue(item))
      }
    };
  }

  if (value instanceof Error) {
    return {
      kvlistValue: {
        values: [
          {
            key: 'name',
            value: {
              stringValue: value.name
            }
          },
          {
            key: 'message',
            value: {
              stringValue: value.message
            }
          },
          {
            key: 'stack',
            value: {
              stringValue: value.stack || ''
            }
          }
        ]
      }
    };
  }

  if (typeof value === 'object') {
    return {
      kvlistValue: {
        values: Object.entries(value).map(([key, nestedValue]) => ({
          key,
          value: toAnyValue(nestedValue)
        }))
      }
    };
  }

  return {
    stringValue: String(value)
  };
}

function toKeyValues(fields: LogFields): KeyValuePayload[] {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      key,
      value: toAnyValue(value)
    }));
}

function sendToSigNoz(level: LogLevel, message: string, fields: LogFields) {
  const requestPayload = {
    resourceLogs: [
      {
        resource: {
          attributes: resourceAttributes
        },
        scopeLogs: [
          {
            scope: {
              name: 'direct-signoz-grpc-logger',
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
                attributes: toKeyValues(fields)
              }
            ]
          }
        ]
      }
    ]
  };

  const exportPromise = new Promise<void>((resolve) => {
    client.Export(requestPayload, (error: Error | null) => {
      if (error) {
        console.error({
          level: 'error',
          message: 'failed to send log to signoz over grpc',
          signozLogsGrpcUrl: config.signozLogsGrpcUrl,
          originalMessage: message,
          sendError: error.message
        });
      }

      resolve();
    });
  });

  pendingExports.add(exportPromise);
  void exportPromise.finally(() => {
    pendingExports.delete(exportPromise);
  });
}

function emit(level: LogLevel, message: string, fields: LogFields = {}) {
  consoleMirror(level, message, fields);
  sendToSigNoz(level, message, fields);
}

async function shutdownLogger() {
  await Promise.allSettled([...pendingExports]);

  await new Promise<void>((resolve) => {
    client.close();
    resolve();
  });
}

export type { AppLogger, LogFields };

export const logger: AppLogger = {
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
export { shutdownLogger };
