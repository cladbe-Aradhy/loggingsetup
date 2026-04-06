'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const gatewayDir = path.join(repoRoot, 'gatewayService');
const demoDir = path.join(repoRoot, 'demo-real-service');
const dockerBin = process.env.DOCKER_BIN || 'docker';

const gatewayHealthUrl = 'http://127.0.0.1:13133/';
const gatewayGrpcEndpoint = 'http://127.0.0.1:14317';
const clickhouseContainer = 'signoz-clickhouse';
const gatewayLocalEnv = {
  GATEWAY_OTLP_HTTP_ENDPOINT: '0.0.0.0:4318',
  GATEWAY_OTLP_GRPC_ENDPOINT: '0.0.0.0:4317',
  GATEWAY_HEALTH_ENDPOINT: '0.0.0.0:13133',
  GATEWAY_INTERNAL_METRICS_ENDPOINT: '0.0.0.0:8888',
  GATEWAY_FRONTEND_CORS_ALLOWED_ORIGIN: 'http://localhost:3000',
  GATEWAY_FRONTEND_CORS_ALLOWED_ORIGIN_2: 'http://localhost:3001',
  GATEWAY_FRONTEND_CORS_ALLOWED_ORIGIN_3: 'http://localhost:5173',
  GATEWAY_FRONTEND_CORS_ALLOWED_ORIGIN_4: 'http://localhost:4173',
  GATEWAY_FRONTEND_CORS_MAX_AGE: '7200',
  GATEWAY_HOST_OTLP_HTTP_PORT: '14318',
  GATEWAY_HOST_OTLP_GRPC_PORT: '14317',
  GATEWAY_HOST_HEALTH_PORT: '13133',
  GATEWAY_HOST_METRICS_PORT: '18888',
  GATEWAY_EXPORT_OTLP_GRPC_ENDPOINT: 'host.docker.internal:4317',
  GATEWAY_EXPORT_OTLP_INSECURE: 'true',
  GATEWAY_SERVICE_NAMESPACE: 'my-org',
  GATEWAY_NAME: 'central-otel-gateway',
  GATEWAY_MEMORY_LIMIT_MIB: '512',
  GATEWAY_MEMORY_SPIKE_LIMIT_MIB: '128',
  GATEWAY_OTLP_GRPC_MAX_CONCURRENT_STREAMS: '128',
  GATEWAY_OTLP_GRPC_MAX_RECV_MSG_SIZE_MIB: '16',
  GATEWAY_OTLP_GRPC_MIN_TIME_BETWEEN_PINGS: '30s',
  GATEWAY_OTLP_GRPC_MAX_CONNECTION_AGE: '300s',
  GATEWAY_OTLP_GRPC_MAX_CONNECTION_AGE_GRACE: '30s',
  GATEWAY_OTLP_GRPC_MAX_CONNECTION_IDLE: '60s',
  GATEWAY_OTLP_GRPC_KEEPALIVE_TIME: '120s',
  GATEWAY_OTLP_GRPC_KEEPALIVE_TIMEOUT: '20s',
  GATEWAY_OTLP_HTTP_MAX_REQUEST_BODY_SIZE: '10485760',
  GATEWAY_OTLP_HTTP_READ_TIMEOUT: '15s',
  GATEWAY_OTLP_HTTP_READ_HEADER_TIMEOUT: '5s',
  GATEWAY_OTLP_HTTP_WRITE_TIMEOUT: '15s',
  GATEWAY_OTLP_HTTP_IDLE_TIMEOUT: '30s',
  GATEWAY_BATCH_TIMEOUT: '5s',
  GATEWAY_BATCH_SEND_SIZE: '1024',
  GATEWAY_BATCH_MAX_SIZE: '2048',
  GATEWAY_EXPORT_TIMEOUT: '30s',
  GATEWAY_EXPORT_QUEUE_NUM_CONSUMERS: '4',
  GATEWAY_EXPORT_QUEUE_SIZE: '10000',
  GATEWAY_EXPORT_RETRY_INITIAL_INTERVAL: '1s',
  GATEWAY_EXPORT_RETRY_MAX_INTERVAL: '30s',
  GATEWAY_EXPORT_RETRY_MAX_ELAPSED_TIME: '300s',
  GATEWAY_LOG_LEVEL: 'info'
};

const modes = [
  {
    name: 'default',
    config: 'otel-collector-config.yaml',
    expectInfoLog: true,
    expectSuccessTrace: true
  },
  {
    name: 'low-noise',
    config: 'otel-collector-config.low-noise.yaml',
    expectInfoLog: false,
    expectSuccessTrace: false
  }
];

async function main() {
  for (const mode of modes) {
    await verifyMode(mode);
  }

  process.stdout.write('gRPC smoke test passed for default and low-noise gateway modes\n');
}

async function verifyMode(mode) {
  await restartGateway(mode.config);
  await waitForHttpOk(gatewayHealthUrl, 30000);

  const serviceName = 'demo-real-service-' + mode.name + '-grpc-smoke-' + Date.now();
  const port = mode.name === 'default' ? 3061 : 3062;
  const app = await startDemoService({
    serviceName,
    port
  });

  try {
    await hitRoute(port, '/info-only', 200);
    await hitRoute(port, '/warn', 429);
    await hitRoute(port, '/boom', 500);
  } finally {
    await stopProcess(app.child);
  }

  await delay(6000);

  const result = await waitForQueries(serviceName, mode, 30000);

  assert.equal(result.logs.grpc_logs > 0, true, mode.name + ' mode did not store any gRPC-ingested logs');
  assert.equal(result.logs.warn_logs > 0, true, mode.name + ' mode did not store warn logs');
  assert.equal(result.logs.error_logs > 0, true, mode.name + ' mode did not store error logs');
  assert.equal(result.traces.grpc_trace_ids > 0, true, mode.name + ' mode did not store any gRPC-ingested traces');
  assert.equal(result.traces.warn_trace_ids > 0, true, mode.name + ' mode did not store warn traces');
  assert.equal(result.traces.error_trace_ids > 0, true, mode.name + ' mode did not store error traces');

  if (mode.expectInfoLog) {
    assert.equal(result.logs.info_route_logs > 0, true, 'default mode should keep info logs');
  } else {
    assert.equal(result.logs.info_route_logs, 0, 'low-noise mode should drop info logs');
  }

  if (mode.expectSuccessTrace) {
    assert.equal(result.traces.success_trace_ids > 0, true, 'default mode should keep success traces');
  } else {
    assert.equal(result.traces.success_trace_ids, 0, 'low-noise mode should drop success traces');
  }

  process.stdout.write(
    '[' + mode.name + '] logs=' + JSON.stringify(result.logs) +
    ' traces=' + JSON.stringify(result.traces) + '\n'
  );
}

async function restartGateway(configFile) {
  await run(dockerBin, ['compose', 'up', '-d', '--force-recreate'], {
    cwd: gatewayDir,
    env: {
      ...process.env,
      ...gatewayLocalEnv,
      GATEWAY_ENV_FILE: '.env.local.example',
      GATEWAY_COLLECTOR_CONFIG: configFile
    }
  });
}

async function startDemoService(options) {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: demoDir,
    env: {
      ...process.env,
      PORT: String(options.port),
      OTEL_SERVICE_NAME: options.serviceName,
      OTEL_EXPORTER_OTLP_ENDPOINT: gatewayGrpcEndpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let combinedOutput = '';

  function onData(chunk) {
    combinedOutput += chunk.toString();
  }

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  await waitForCondition(() => {
    if (combinedOutput.includes('"message":"demo real service listening"')) {
      return true;
    }

    if (child.exitCode !== null) {
      throw new Error('demo service exited early:\n' + combinedOutput);
    }

    return false;
  }, 15000, 250, 'demo service did not become ready');

  return {
    child,
    getOutput() {
      return combinedOutput;
    }
  };
}

async function hitRoute(port, pathname, expectedStatus) {
  const response = await fetch('http://127.0.0.1:' + port + pathname);
  const body = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error('Unexpected status for ' + pathname + ': expected ' + expectedStatus + ', got ' + response.status + '\n' + body);
  }
}

async function waitForQueries(serviceName, mode, timeoutMs) {
  let latest = null;

  await waitForCondition(async () => {
    latest = {
      logs: await queryLogs(serviceName),
      traces: await queryTraces(serviceName)
    };

    const baseSatisfied =
      latest.logs.grpc_logs > 0 &&
      latest.logs.warn_logs > 0 &&
      latest.logs.error_logs > 0 &&
      latest.traces.grpc_trace_ids > 0 &&
      latest.traces.warn_trace_ids > 0 &&
      latest.traces.error_trace_ids > 0;

    if (!baseSatisfied) {
      return false;
    }

    if (mode.expectInfoLog && latest.logs.info_route_logs <= 0) {
      return false;
    }

    if (!mode.expectInfoLog && latest.logs.info_route_logs !== 0) {
      return false;
    }

    if (mode.expectSuccessTrace && latest.traces.success_trace_ids <= 0) {
      return false;
    }

    if (!mode.expectSuccessTrace && latest.traces.success_trace_ids !== 0) {
      return false;
    }

    return true;
  }, timeoutMs, 1500, 'timed out waiting for telemetry in ' + mode.name + ' mode');

  return latest;
}

async function queryLogs(serviceName) {
  const query = [
    'SELECT',
    "countIf(body = 'mode-check info-only route') AS info_route_logs,",
    "countIf(body = 'warning: retrying payment sync') AS warn_logs,",
    "countIf(body = 'express request failed') AS error_logs,",
    "countIf(resources_string['telemetry.ingest.protocol'] = 'grpc') AS grpc_logs",
    'FROM signoz_logs.distributed_logs_v2',
    "WHERE resources_string['service.name'] = '" + serviceName + "'",
    "AND timestamp >= toUInt64(toUnixTimestamp64Nano(now64(9) - INTERVAL 15 MINUTE))",
    'FORMAT JSONEachRow'
  ].join(' ');

  return queryJsonRow(query);
}

async function queryTraces(serviceName) {
  const query = [
    'SELECT',
    "countIf(attributes_string['http.route'] = '/info-only') AS success_trace_ids,",
    "countIf(attributes_string['http.route'] = '/warn') AS warn_trace_ids,",
    "countIf(attributes_string['http.route'] = '/boom') AS error_trace_ids,",
    "countIf(resources_string['telemetry.ingest.protocol'] = 'grpc') AS grpc_trace_ids",
    'FROM signoz_traces.distributed_signoz_index_v3',
    "WHERE serviceName = '" + serviceName + "'",
    "AND timestamp >= now() - INTERVAL 15 MINUTE",
    'FORMAT JSONEachRow'
  ].join(' ');

  return queryJsonRow(query);
}

async function queryJsonRow(query): Promise<Record<string, any>> {
  const result = await run(dockerBin, [
    'exec',
    clickhouseContainer,
    'clickhouse-client',
    '--query',
    query
  ]);

  const text = result.stdout.trim();
  if (!text) {
    return {};
  }

  const row = JSON.parse(text);

  return Object.keys(row).reduce<Record<string, any>>((normalized, key) => {
    const value = row[key];

    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
      normalized[key] = Number(value);
      return normalized;
    }

    normalized[key] = value;
    return normalized;
  }, {});
}

async function waitForHttpOk(url, timeoutMs) {
  await waitForCondition(async () => {
    try {
      const response = await fetch(url);
      return response.ok;
    } catch (error) {
      return false;
    }
  }, timeoutMs, 500, 'gateway health endpoint did not become ready');
}

async function waitForCondition(check, timeoutMs, intervalMs, errorMessage) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) {
      return;
    }

    await delay(intervalMs);
  }

  throw new Error(errorMessage);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 5000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function run(command, args, options?): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options && options.cwd,
      env: options && options.env ? options.env : process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(command + ' ' + args.join(' ') + ' failed with code ' + code + '\n' + stdout + '\n' + stderr));
    });
  });
}

main().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exit(1);
});
