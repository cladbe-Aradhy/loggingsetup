const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
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
          ]
        },
        scopeLogs: [
          {
            scope: {
              name: 'test-scope',
              version: '1.0.0'
            },
            logRecords: [
              {
                timeUnixNano: String(Date.now() * 1_000_000),
                severityNumber: 9,
                severityText: 'INFO',
                body: {
                  stringValue: message
                },
                attributes: []
              }
            ]
          }
        ]
      }
    ]
  };
}

function withoutServiceName(payload) {
  return {
    ...payload,
    resourceLogs: payload.resourceLogs.map((resourceLog) => ({
      ...resourceLog,
      resource: {
        ...resourceLog.resource,
        attributes: resourceLog.resource.attributes.filter((attribute) => {
          return attribute.key !== 'service.name';
        })
      }
    }))
  };
}

function withoutLogRecordBody(payload) {
  return {
    ...payload,
    resourceLogs: payload.resourceLogs.map((resourceLog) => ({
      ...resourceLog,
      scopeLogs: resourceLog.scopeLogs.map((scopeLog) => ({
        ...scopeLog,
        logRecords: scopeLog.logRecords.map(({ body, ...logRecord }) => logRecord)
      }))
    }))
  };
}

function withNumericLogRecordAttribute(payload) {
  return {
    ...payload,
    resourceLogs: payload.resourceLogs.map((resourceLog) => ({
      ...resourceLog,
      scopeLogs: resourceLog.scopeLogs.map((scopeLog) => ({
        ...scopeLog,
        logRecords: scopeLog.logRecords.map((logRecord) => ({
          ...logRecord,
          attributes: [
            ...(logRecord.attributes || []),
            {
              key: 'port',
              value: {
                intValue: '3097'
              }
            }
          ]
        }))
      }))
    }))
  };
}

function getFirstLogBodyString(requestPayload) {
  return requestPayload.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]?.body?.stringValue;
}

function createGrpcServiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.metadata = new grpc.Metadata();
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
  assert.equal(debugStore.body.queueCounts.dead, 0);
  assert.equal(upstream.requests.length, 1);
  assert.equal(getFirstLogBodyString(upstream.requests[0]), 'http success');
});

test('HTTP failure stays in fresh queue and later succeeds on another try', async (t) => {
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
    body: JSON.stringify(sampleGrpcLogsPayload('http retry then success'))
  });

  assert.equal(response.status, 202);
  assert.match(response.body.message, /fresh queue/i);
  assert.equal(response.body.item.attemptCount, 1);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(upstream.requests.length, 2);
  }, 5000, 100);
});

test('HTTP payload goes to dead queue after three failed tries', async (t) => {
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
    body: JSON.stringify(sampleGrpcLogsPayload('http dead after three'))
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.item.attemptCount, 1);

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.dead, 1);
    assert.equal(debugStore.body.deadQueue[0].attemptCount, 3);
    assert.equal(debugStore.body.deadQueue[0].lastGrpcCode, grpc.status.INVALID_ARGUMENT);
    assert.equal(upstream.requests.length, 3);
  }, 5000, 100);
});

test('HTTP invalid JSON is rejected before it reaches upstream', async (t) => {
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
    body: '{"broken":'
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);

  const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(debugStore.body.queueCounts.fresh, 0);
  assert.equal(debugStore.body.queueCounts.dead, 0);
  assert.equal(upstream.requests.length, 0);
});

test('HTTP payload without service.name is rejected before it reaches upstream', async (t) => {
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
    body: JSON.stringify(withoutServiceName(sampleGrpcLogsPayload('missing service')))
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /service.name|custom/i);

  const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(debugStore.body.queueCounts.fresh, 0);
  assert.equal(debugStore.body.queueCounts.dead, 0);
  assert.equal(upstream.requests.length, 0);
});

test('HTTP payload without logRecord.body is rejected before it reaches upstream', async (t) => {
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
    body: JSON.stringify(withoutLogRecordBody(sampleGrpcLogsPayload('missing body')))
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /body/i);

  const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(debugStore.body.queueCounts.fresh, 0);
  assert.equal(debugStore.body.queueCounts.dead, 0);
  assert.equal(upstream.requests.length, 0);
});

test('gRPC success path forwards immediately and leaves queues empty', async (t) => {
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

  await sendGrpcExport(gateway.grpcPort, sampleGrpcLogsPayload('grpc success'));

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(upstream.requests.length, 1);
  }, 3000, 100);
});

test('gRPC payload with numeric log attribute forwards successfully', async (t) => {
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

  await sendGrpcExport(
    gateway.grpcPort,
    withNumericLogRecordAttribute(sampleGrpcLogsPayload('grpc numeric attribute'))
  );

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(upstream.requests.length, 1);
    assert.equal(getFirstLogBodyString(upstream.requests[0]), 'grpc numeric attribute');
  }, 3000, 100);
});

test('gRPC failure returns UNAVAILABLE and later succeeds from fresh queue', async (t) => {
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

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, sampleGrpcLogsPayload('grpc retry then success')),
    (error) => {
      assert.equal(error.code, grpc.status.UNAVAILABLE);
      assert.match(error.details, /fresh queue/i);
      return true;
    }
  );

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.dead, 0);
    assert.equal(upstream.requests.length, 2);
  }, 4000, 100);
});

test('gRPC payload goes to dead queue after three failed tries', async (t) => {
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

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, sampleGrpcLogsPayload('grpc dead after three')),
    (error) => {
      assert.equal(error.code, grpc.status.UNAVAILABLE);
      assert.match(error.details, /fresh queue/i);
      return true;
    }
  );

  await waitFor(async () => {
    const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
    assert.equal(debugStore.body.queueCounts.fresh, 0);
    assert.equal(debugStore.body.queueCounts.dead, 1);
    assert.equal(debugStore.body.deadQueue[0].attemptCount, 3);
    assert.equal(debugStore.body.deadQueue[0].lastGrpcCode, grpc.status.INVALID_ARGUMENT);
    assert.equal(upstream.requests.length, 3);
  }, 5000, 100);
});

test('gRPC payload without service.name is rejected before it reaches upstream', async (t) => {
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

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, withoutServiceName(sampleGrpcLogsPayload('grpc missing service'))),
    (error) => {
      assert.equal(error.code, grpc.status.INVALID_ARGUMENT);
      assert.match(error.details, /service.name|custom/i);
      return true;
    }
  );

  const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(debugStore.body.queueCounts.fresh, 0);
  assert.equal(debugStore.body.queueCounts.dead, 0);
  assert.equal(upstream.requests.length, 0);
});

test('gRPC payload without logRecord.body is rejected before it reaches upstream', async (t) => {
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

  await assert.rejects(
    sendGrpcExport(gateway.grpcPort, withoutLogRecordBody(sampleGrpcLogsPayload('grpc missing body'))),
    (error) => {
      assert.equal(error.code, grpc.status.INVALID_ARGUMENT);
      assert.match(error.details, /body/i);
      return true;
    }
  );

  const debugStore = await jsonFetch(`http://127.0.0.1:${gateway.port}/debug/store`);
  assert.equal(debugStore.body.queueCounts.fresh, 0);
  assert.equal(debugStore.body.queueCounts.dead, 0);
  assert.equal(upstream.requests.length, 0);
});

test('graceful shutdown drains fresh queue before process exits', async () => {
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
  assert.ok(callCount >= 2, `expected another try during shutdown drain, got ${callCount}`);
});
