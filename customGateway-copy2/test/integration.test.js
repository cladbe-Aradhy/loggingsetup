const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const gatewayDir = path.resolve(__dirname, '..');
const protoRoot = path.resolve(gatewayDir, 'proto');
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
const loadedDefinition = grpc.loadPackageDefinition(packageDefinition);
const LogsService =
  loadedDefinition.opentelemetry.proto.collector.logs.v1.LogsService;

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function waitFor(fn, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError || new Error('timed out while waiting');
}

async function jsonFetch(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return {
    status: response.status,
    body
  };
}

async function waitForGatewayReady(port) {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    if (!response.ok) {
      throw new Error(`gateway not ready yet: ${response.status}`);
    }
  }, 8000, 100);
}

async function spawnGateway(customEnv = {}) {
  const port = await getFreePort();
  const grpcPort = await getFreePort();
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: gatewayDir,
    env: {
      ...process.env,
      PORT: String(port),
      GRPC_PORT: String(grpcPort),
      ENABLE_SIGNOZ_FORWARD: 'true',
      QUEUE_RETRY_INTERVAL_MS: '100',
      RETRY_BASE_DELAY_MS: '100',
      RETRY_MAX_DELAY_MS: '300',
      MAX_LIVE_QUEUE_SIZE: '100',
      MAX_DEAD_QUEUE_SIZE: '100',
      SHUTDOWN_DRAIN_TIMEOUT_MS: '2000',
      SIGNOZ_FORWARD_TIMEOUT_MS: '500',
      ...customEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  child.on('exit', (code, signal) => {
    logs += `\n[exit code=${code} signal=${signal}]`;
  });

  await waitForGatewayReady(port);

  return {
    child,
    port,
    grpcPort,
    getLogs() {
      return logs;
    }
  };
}

async function stopGateway(instance, signal = 'SIGTERM') {
  if (!instance || instance.child.exitCode !== null) {
    return {
      code: instance?.child.exitCode ?? null,
      signal: null
    };
  }

  instance.child.kill(signal);
  const [code, receivedSignal] = await once(instance.child, 'exit');
  return {
    code,
    signal: receivedSignal
  };
}

async function startMockHttpServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const body = Buffer.concat(chunks);
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      bodyText: body.toString('utf8')
    });

    await handler(req, res, { requests });
  });

  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address.port);
    });
  });

  return {
    port,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

async function startMockGrpcServer(exportImpl) {
  const requests = [];
  const server = new grpc.Server();

  server.addService(LogsService.service, {
    Export(call, callback) {
      requests.push(call.request);
      exportImpl(call, callback, { requests });
    }
  });

  const port = await new Promise((resolve, reject) => {
    server.bindAsync(
      '127.0.0.1:0',
      grpc.ServerCredentials.createInsecure(),
      (error, boundPort) => {
        if (error) {
          reject(error);
          return;
        }

        server.start();
        resolve(boundPort);
      }
    );
  });

  return {
    port,
    requests,
    async close() {
      await new Promise((resolve) => {
        server.tryShutdown(() => resolve());
      });
    }
  };
}

async function sendGrpcExport(port, requestPayload) {
  const client = new LogsService(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure()
  );

  try {
    return await new Promise((resolve, reject) => {
      client.Export(requestPayload, (error, response) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(response);
      });
    });
  } finally {
    client.close();
  }
}

function sampleGrpcLogsPayload(message) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: {
                stringValue: 'integration-test-client'
              }
            }
          ],
          droppedAttributesCount: 0
        },
        schemaUrl: '',
        scopeLogs: [
          {
            scope: {
              name: 'test-scope',
              version: '1.0.0',
              attributes: [],
              droppedAttributesCount: 0
            },
            schemaUrl: '',
            logRecords: [
              {
                timeUnixNano: String(Date.now() * 1_000_000),
                observedTimeUnixNano: '0',
                severityNumber: 9,
                severityText: 'INFO',
                body: {
                  stringValue: message
                },
                attributes: [],
                droppedAttributesCount: 0,
                flags: 0,
                traceId: '',
                spanId: ''
              }
            ]
          }
        ]
      }
    ]
  };
}

function getFirstLogBodyString(requestPayload) {
  return requestPayload.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]?.body?.stringValue;
}

function createGrpcServiceError(code, message, metadataEntries = {}) {
  const error = new Error(message);
  error.code = code;

  const metadata = new grpc.Metadata();
  for (const [key, value] of Object.entries(metadataEntries)) {
    metadata.set(key, value);
  }

  error.metadata = metadata;
  return error;
}

test('HTTP success path forwards immediately and leaves queues empty', async (t) => {
  const upstream = await startMockGrpcServer((_call, callback) => {
    callback(null, {});
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const response = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('http success'))
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.forward.forwarded, true);

  const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(debugStore.body.queueCounts.fresh, 0);
  assert.equal(debugStore.body.queueCounts.retry, 0);
  assert.equal(debugStore.body.queueCounts.dead, 0);
  assert.equal(upstream.requests.length, 1);
  assert.equal(getFirstLogBodyString(upstream.requests[0]), 'http success');
});

test('HTTP retryable failure moves payload to retryQueue and later forwards it', async (t) => {
  let callCount = 0;
  const upstream = await startMockGrpcServer((_call, callback) => {
    callCount += 1;

    if (callCount === 1) {
      callback(createGrpcServiceError(grpc.status.UNAVAILABLE, 'temporarily unavailable'));
      return;
    }

    callback(null, {});
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const response = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('http retry'))
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.ok, true);
  assert.match(response.body.message, /retry queue/i);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(upstream.requests.length, 2);
  }, 5000, 100);
});

test('retry queue processing starts multiple due items in parallel', async (t) => {
  const attemptByKey = {
    slow: 0,
    fast: 0
  };
  const secondAttemptStartedAt = {
    slow: null,
    fast: null
  };

  const upstream = await startMockGrpcServer(async (call, callback) => {
    const key = getFirstLogBodyString(call.request);
    attemptByKey[key] += 1;

    if (attemptByKey[key] === 1) {
      callback(createGrpcServiceError(grpc.status.UNAVAILABLE, 'queue me bhejo'));
      return;
    }

    secondAttemptStartedAt[key] = Date.now();

    if (key === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    callback(null, {});
  });

  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`,
    RETRY_BASE_DELAY_MS: '100',
    RETRY_MAX_DELAY_MS: '100',
    QUEUE_RETRY_INTERVAL_MS: '100',
    QUEUE_PROCESSING_CONCURRENCY: '2',
    SIGNOZ_FORWARD_TIMEOUT_MS: '2000'
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const first = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('slow'))
  });
  const second = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('fast'))
  });

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(attemptByKey.slow, 2);
    assert.equal(attemptByKey.fast, 2);
    assert.ok(secondAttemptStartedAt.slow);
    assert.ok(secondAttemptStartedAt.fast);
    assert.ok(
      Math.abs(secondAttemptStartedAt.fast - secondAttemptStartedAt.slow) < 250,
      `expected retry attempts to start in parallel, got delta ${
        Math.abs(secondAttemptStartedAt.fast - secondAttemptStartedAt.slow)
      }ms`
    );
  }, 5000, 100);
});

test('HTTP non-retryable schema failure moves payload to deadQueue', async (t) => {
  const upstream = await startMockGrpcServer((_call, callback) => {
    callback(createGrpcServiceError(grpc.status.INVALID_ARGUMENT, 'invalid schema'));
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const response = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('http dead'))
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /dead queue/i);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 1);
    assert.equal(debugStore.body.deadQueue[0].failureType, 'invalid_schema');
  }, 2000, 100);
});

test('HTTP auth/config failure does not loop in retryQueue and moves payload to deadQueue', async (t) => {
  const upstream = await startMockGrpcServer((_call, callback) => {
    callback(createGrpcServiceError(grpc.status.NOT_FOUND, 'wrong upstream endpoint'));
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const response = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('http auth config dead'))
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /dead queue/i);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 1);
    assert.equal(debugStore.body.deadQueue[0].failureType, 'auth_or_config_error');
    assert.equal(upstream.requests.length, 1);
  }, 2000, 100);
});

test('dead queue overflow is tracked instead of silently disappearing', async (t) => {
  const upstream = await startMockGrpcServer((_call, callback) => {
    callback(createGrpcServiceError(grpc.status.INVALID_ARGUMENT, 'invalid schema'));
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`,
    MAX_DEAD_QUEUE_SIZE: '1'
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const first = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('first'))
  });
  const second = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('second'))
  });

  assert.equal(first.status, 422);
  assert.equal(second.status, 422);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.dead, 1);
    assert.equal(debugStore.body.queueCounts.deadDropped, 1);
    assert.equal(debugStore.body.deadQueueOverflow.totalDropped, 1);
    assert.equal(debugStore.body.deadQueueOverflow.recentDrops.length, 1);
    assert.equal(
      getFirstLogBodyString(debugStore.body.deadQueue[0].bodyJson),
      'second'
    );
    assert.equal(debugStore.body.deadQueueOverflow.recentDrops[0].id, first.body.item.id);
  }, 2000, 100);
});

test('HTTP ingest respects gRPC retry pushback before retrying upstream', async (t) => {
  let callCount = 0;
  const upstream = await startMockGrpcServer((_call, callback) => {
    callCount += 1;

    if (callCount === 1) {
      callback(
        createGrpcServiceError(grpc.status.RESOURCE_EXHAUSTED, 'slow down', {
          'grpc-retry-pushback-ms': '1000'
        })
      );
      return;
    }

    callback(null, {});
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`,
    RETRY_BASE_DELAY_MS: '100',
    RETRY_MAX_DELAY_MS: '100',
    QUEUE_RETRY_INTERVAL_MS: '100'
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const response = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('retry-after'))
  });

  assert.equal(response.status, 202);
  assert.match(response.body.message, /retry queue/i);

  await new Promise((resolve) => setTimeout(resolve, 350));

  const stillQueued = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(stillQueued.body.queueCounts.retry, 1);
  assert.equal(callCount, 1);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(callCount, 2);
  }, 4000, 100);
});

test('gRPC success path forwards immediately and leaves queues empty', async (t) => {
  const upstream = await startMockGrpcServer((call, callback) => {
    callback(null, {});
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  await sendGrpcExport(gateway.grpcPort, sampleGrpcLogsPayload('grpc success'));

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(upstream.requests.length, 1);
  }, 3000, 100);
});

test('gRPC retryable failure returns UNAVAILABLE and later drains retryQueue', async (t) => {
  let callCount = 0;
  const upstream = await startMockGrpcServer((_call, callback) => {
    callCount += 1;

    if (callCount === 1) {
      const error = new Error('temporarily unavailable');
      error.code = grpc.status.UNAVAILABLE;
      callback(error);
      return;
    }

    callback(null, {});
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, sampleGrpcLogsPayload('grpc retry')),
    (error) => {
      assert.equal(error.code, grpc.status.UNAVAILABLE);
      assert.match(error.details, /queued it for retry/i);
      return true;
    }
  );

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(upstream.requests.length, 2);
  }, 4000, 100);
});

test('gRPC duplicate retryable payload does not create a second queued item', async (t) => {
  let callCount = 0;
  const upstream = await startMockGrpcServer((_call, callback) => {
    callCount += 1;
    const error = new Error('temporarily unavailable');
    error.code = grpc.status.UNAVAILABLE;
    callback(error);
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`,
    RETRY_BASE_DELAY_MS: '2000',
    RETRY_MAX_DELAY_MS: '2000',
    QUEUE_RETRY_INTERVAL_MS: '2000'
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  const payload = sampleGrpcLogsPayload('grpc duplicate retryable');

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, payload),
    (error) => {
      assert.equal(error.code, grpc.status.UNAVAILABLE);
      return true;
    }
  );

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, payload),
    (error) => {
      assert.equal(error.code, grpc.status.ALREADY_EXISTS);
      assert.match(error.details, /already has the same log payload/i);
      return true;
    }
  );

  const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(debugStore.body.queueCounts.retry, 1);
  assert.equal(debugStore.body.retryQueue.length, 1);
  assert.equal(callCount, 1);
});

test('gRPC invalid payload moves item to deadQueue', async (t) => {
  const upstream = await startMockGrpcServer((_call, callback) => {
    const error = new Error('invalid schema');
    error.code = grpc.status.INVALID_ARGUMENT;
    callback(error);
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, sampleGrpcLogsPayload('grpc dead')),
    (error) => {
      assert.equal(error.code, grpc.status.INVALID_ARGUMENT);
      assert.match(error.details, /dead queue/i);
      return true;
    }
  );

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 1);
    assert.equal(debugStore.body.deadQueue[0].failureType, 'invalid_schema');
  }, 3000, 100);
});

test('gRPC auth/config failure does not loop in retryQueue and moves item to deadQueue', async (t) => {
  const upstream = await startMockGrpcServer((_call, callback) => {
    const error = new Error('permission denied');
    error.code = grpc.status.PERMISSION_DENIED;
    callback(error);
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`
  });

  t.after(async () => {
    await stopGateway(gateway);
    await upstream.close();
  });

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, sampleGrpcLogsPayload('grpc auth config dead')),
    (error) => {
      assert.equal(error.code, grpc.status.PERMISSION_DENIED);
      assert.match(error.details, /dead queue/i);
      return true;
    }
  );

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.retry, 0);
    assert.equal(debugStore.body.queueCounts.dead, 1);
    assert.equal(debugStore.body.deadQueue[0].failureType, 'auth_or_config_error');
    assert.equal(upstream.requests.length, 1);
  }, 3000, 100);
});

test('graceful shutdown drains retryQueue before process exits', async () => {
  let callCount = 0;
  const upstream = await startMockGrpcServer((_call, callback) => {
    callCount += 1;

    if (callCount === 1) {
      callback(createGrpcServiceError(grpc.status.UNAVAILABLE, 'temporarily unavailable'));
      return;
    }

    callback(null, {});
  });
  const gateway = await spawnGateway({
    SIGNOZ_OTLP_GRPC_TARGET: `http://127.0.0.1:${upstream.port}`,
    SHUTDOWN_DRAIN_TIMEOUT_MS: '3000'
  });

  const response = await jsonFetch(`http://127.0.0.1:${gateway.port}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(sampleGrpcLogsPayload('shutdown-drain'))
  });

  assert.equal(response.status, 202);

  const exitInfo = await stopGateway(gateway, 'SIGTERM');
  await upstream.close();

  assert.equal(exitInfo.code, 0, gateway.getLogs());
  assert.ok(callCount >= 2, `expected retry during shutdown drain, got ${callCount}`);
});
