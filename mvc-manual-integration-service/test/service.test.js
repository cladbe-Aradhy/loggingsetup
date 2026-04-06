'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const serviceDir = path.join(__dirname, '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

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

    server.on('error', reject);
  });
}

async function waitForServer(port, childProcess) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    if (childProcess.exitCode !== null) {
      throw new Error(`service exited early with code ${childProcess.exitCode}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);

      if (response.ok) {
        return;
      }
    } catch (_error) {
      // Retry until the service is reachable.
    }

    await sleep(150);
  }

  throw new Error('service did not become ready in time');
}

async function requestJson(port, route, options) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return { response, body, contentType };
}

function assertRequestId(response) {
  const requestId = response.headers.get('x-request-id');

  assert.equal(typeof requestId, 'string');
  assert.ok(requestId.length >= 16);
}

function assertJsonResponse(response, contentType) {
  assert.match(contentType, /application\/json/);
  assertRequestId(response);
}

function collectOutput(childProcess) {
  let output = '';

  function append(chunk) {
    output += chunk.toString();
  }

  childProcess.stdout.on('data', append);
  childProcess.stderr.on('data', append);

  return () => output;
}

async function stopService(childProcess) {
  if (childProcess.exitCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      childProcess.kill('SIGKILL');
    }, 5000);

    childProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    childProcess.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    childProcess.kill('SIGTERM');
  });
}

test('mvc manual integration service end-to-end coverage', { timeout: 45000 }, async (t) => {
  const port = await getAvailablePort();
  const childProcess = spawn('node', ['dist/server.js'], {
    cwd: serviceDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      OTEL_SERVICE_NAME: 'mvc-manual-integration-service-test',
      SERVICE_VERSION: '1.0.0-test',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:65535',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const getOutput = collectOutput(childProcess);
  let createdUserId = null;
  let createdOrderId = null;

  try {
    await waitForServer(port, childProcess);

    await t.test('GET /health', async () => {
      const { response, body, contentType } = await requestJson(port, '/health');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        service: 'mvc-manual-integration-service'
      });
    });

    await t.test('GET /coverage', async () => {
      const { response, body, contentType } = await requestJson(port, '/coverage');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(Array.isArray(body.routes), true);
      assert.equal(body.routes.length, 18);
      assert.equal(body.routes.includes('GET /dedupe/error-burst'), true);
      assert.equal(body.routes.includes('GET /package/logger-tools'), true);
      assert.equal(body.routes.includes('GET /package/express-error'), true);
      assert.equal(body.routes.includes('PATCH /orders/:id/pay'), true);
    });

    await t.test('GET /package/logger-tools uses base and child loggers', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/logger-tools');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        usedExports: ['getLogger', 'createChildLogger']
      });
    });

    await t.test('GET /package/span-metrics uses spans and metric helpers', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/span-metrics');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        callbackResult: 42,
        manualSpanEnded: true,
        usedExports: ['startSpan', 'incrementCounter', 'recordHistogram', 'setGauge']
      });
    });

    await t.test('GET /package/record-exception records an exception without failing the request', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/record-exception');

      assert.equal(response.status, 202);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        code: 'PACKAGE_RECORDED_EXCEPTION',
        usedExports: ['recordException']
      });
    });

    await t.test('GET /package/pino-stream uses the pino stream adapter export', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/pino-stream');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        forwarded: true,
        usedExports: ['adapters.pino.createPinoStreamAdapter']
      });
    });

    await t.test('GET /package/pino-instrument uses the pino instrumentation export', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/pino-instrument');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        originalLogCalls: 1,
        sameLogger: true,
        usedExports: ['adapters.pino.instrumentPinoLogger']
      });
    });

    await t.test('GET /package/winston-transport uses the winston transport export', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/winston-transport');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        forwarded: true,
        usedExports: ['adapters.winston.createWinstonTransport']
      });
    });

    await t.test('GET /package/winston-instrument uses the winston instrumentation export', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/winston-instrument');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        addedTransportCount: 1,
        reusedTransport: true,
        usedExports: ['adapters.winston.instrumentWinstonLogger']
      });
    });

    await t.test('GET /package/express-error uses the package error middleware export', async () => {
      const { response, body, contentType } = await requestJson(port, '/package/express-error');

      assert.equal(response.status, 418);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, false);
      assert.equal(body.message, 'Package express error middleware demo');
      assert.equal(typeof body.requestId, 'string');
      assert.ok(body.requestId.length >= 16);
    });

    await t.test('GET /dedupe/error-burst emits dedupe demo metadata', async () => {
      const { response, body, contentType } = await requestJson(
        port,
        '/dedupe/error-burst?count=5&waitMs=3200'
      );

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: true,
        emitted_count: 5,
        wait_ms: 3200,
        dedupe_window_ms: 3000,
        expected_raw_logs: 1,
        expected_summary_logs: 1
      });
    });

    await t.test('GET /users returns seeded users', async () => {
      const { response, body, contentType } = await requestJson(port, '/users');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(body.users.length, 2);
      assert.equal(body.users[0].id, 'user-1');
      assert.equal(body.users[1].id, 'user-2');
    });

    await t.test('GET /users/:id returns a seeded user', async () => {
      const { response, body, contentType } = await requestJson(port, '/users/user-1');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(body.user.id, 'user-1');
      assert.equal(body.user.email, 'aarav@example.com');
    });

    await t.test('GET /users/:id returns 404 for missing user', async () => {
      const { response, body, contentType } = await requestJson(port, '/users/missing-user');

      assert.equal(response.status, 404);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    });

    await t.test('POST /users validates required fields', async () => {
      const { response, body, contentType } = await requestJson(port, '/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '', email: '' })
      });

      assert.equal(response.status, 400);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'MISSING_USER_FIELDS',
        message: 'name and email are required'
      });
    });

    await t.test('POST /users rejects duplicate email', async () => {
      const { response, body, contentType } = await requestJson(port, '/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Aarav Sharma Again',
          email: 'AARAV@example.com'
        })
      });

      assert.equal(response.status, 409);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'USER_EMAIL_CONFLICT',
        message: 'Email already exists'
      });
    });

    await t.test('POST /users creates a new user', async () => {
      const { response, body, contentType } = await requestJson(port, '/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Ishaan Verma',
          email: '  ishaan@example.com  '
        })
      });

      assert.equal(response.status, 201);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.match(body.user.id, /^[0-9a-f-]{36}$/i);
      assert.equal(body.user.name, 'Ishaan Verma');
      assert.equal(body.user.email, 'ishaan@example.com');
      assert.equal(body.user.role, 'member');
      createdUserId = body.user.id;
    });

    await t.test('GET /users/:id returns the created user', async () => {
      assert.ok(createdUserId);

      const { response, body, contentType } = await requestJson(port, `/users/${createdUserId}`);

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(body.user.id, createdUserId);
      assert.equal(body.user.email, 'ishaan@example.com');
    });

    await t.test('GET /orders returns seeded orders', async () => {
      const { response, body, contentType } = await requestJson(port, '/orders');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(body.orders.length, 2);
      assert.equal(body.orders[0].id, 'order-1');
      assert.equal(body.orders[1].status, 'pending');
    });

    await t.test('GET /orders/:id returns a seeded order', async () => {
      const { response, body, contentType } = await requestJson(port, '/orders/order-2');

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(body.order.id, 'order-2');
      assert.equal(body.order.status, 'pending');
    });

    await t.test('GET /orders/:id returns 404 for missing order', async () => {
      const { response, body, contentType } = await requestJson(port, '/orders/missing-order');

      assert.equal(response.status, 404);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found'
      });
    });

    await t.test('POST /orders validates required fields', async () => {
      const { response, body, contentType } = await requestJson(port, '/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-1',
          item: 'Headphones'
        })
      });

      assert.equal(response.status, 400);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'MISSING_ORDER_FIELDS',
        message: 'userId, item, and amount are required'
      });
    });

    await t.test('POST /orders validates positive amount', async () => {
      const { response, body, contentType } = await requestJson(port, '/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-1',
          item: 'Headphones',
          amount: 0
        })
      });

      assert.equal(response.status, 400);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'INVALID_ORDER_AMOUNT',
        message: 'Amount must be greater than zero'
      });
    });

    await t.test('POST /orders validates user existence', async () => {
      const { response, body, contentType } = await requestJson(port, '/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'missing-user',
          item: 'Headphones',
          amount: 4500
        })
      });

      assert.equal(response.status, 404);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    });

    await t.test('POST /orders creates a new order', async () => {
      assert.ok(createdUserId);

      const { response, body, contentType } = await requestJson(port, '/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: createdUserId,
          item: ' Mechanical Keyboard ',
          amount: 7999
        })
      });

      assert.equal(response.status, 201);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.match(body.order.id, /^[0-9a-f-]{36}$/i);
      assert.equal(body.order.userId, createdUserId);
      assert.equal(body.order.item, 'Mechanical Keyboard');
      assert.equal(body.order.amount, 7999);
      assert.equal(body.order.status, 'pending');
      createdOrderId = body.order.id;
    });

    await t.test('GET /orders/:id returns the created order', async () => {
      assert.ok(createdOrderId);

      const { response, body, contentType } = await requestJson(port, `/orders/${createdOrderId}`);

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(body.order.id, createdOrderId);
      assert.equal(body.order.status, 'pending');
    });

    await t.test('PATCH /orders/:id/pay marks an order as paid', async () => {
      assert.ok(createdOrderId);

      const { response, body, contentType } = await requestJson(
        port,
        `/orders/${createdOrderId}/pay`,
        { method: 'PATCH' }
      );

      assert.equal(response.status, 200);
      assertJsonResponse(response, contentType);
      assert.equal(body.ok, true);
      assert.equal(body.order.id, createdOrderId);
      assert.equal(body.order.status, 'paid');
    });

    await t.test('PATCH /orders/:id/pay returns 404 for missing order', async () => {
      const { response, body, contentType } = await requestJson(port, '/orders/missing-order/pay', {
        method: 'PATCH'
      });

      assert.equal(response.status, 404);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found'
      });
    });

    await t.test('unknown routes return JSON 404 response', async () => {
      const { response, body, contentType } = await requestJson(port, '/missing');

      assert.equal(response.status, 404);
      assertJsonResponse(response, contentType);
      assert.deepEqual(body, {
        ok: false,
        message: 'Route not found: GET /missing'
      });
    });

    await sleep(400);

    await t.test('service output includes startup and error logs', async () => {
      const output = getOutput();
      const rawMatches = output.match(/"message":"mvc dedupe demo: DB failed"/g) || [];
      const summaryMatches =
        output.match(
          /"message":"mvc dedupe demo: DB failed \(repeated 4 times, total 5\)"/g
        ) || [];

      assert.match(output, /observability initialized/);
      assert.match(output, /mvc request failed/);
      assert.match(output, /mvc package base logger route/);
      assert.match(output, /mvc package child logger route/);
      assert.match(output, /mvc package span metrics route/);
      assert.match(output, /mvc manual exception recorded/);
      assert.match(output, /mvc fake pino stream error/);
      assert.match(output, /mvc fake pino instrument error/);
      assert.match(output, /mvc fake winston transport log/);
      assert.match(output, /mvc fake winston instrument log/);
      assert.match(output, /express request failed/);
      assert.match(output, /mvc-manual-integration-service listening on/);
      assert.equal(rawMatches.length, 1);
      assert.equal(summaryMatches.length, 1);
    });
  } finally {
    await stopService(childProcess);
  }
});
