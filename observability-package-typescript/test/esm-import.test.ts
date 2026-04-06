'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const importEsm = new Function('specifier', 'return import(specifier);');

test('package root ESM entry exposes expected named exports', async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '..', '..', 'index.mjs')
  ).href;
  const esmModule = await importEsm(moduleUrl);

  assert.equal(typeof esmModule.initObservability, 'function');
  assert.equal(typeof esmModule.shutdownObservability, 'function');
  assert.equal(typeof esmModule.getLogger, 'function');
  assert.equal(typeof esmModule.startSpan, 'function');
  assert.equal(typeof esmModule.express.requestContextMiddleware, 'function');
  assert.equal(typeof esmModule.adapters.pino.createPinoStreamAdapter, 'function');
  assert.equal(typeof esmModule.default.initObservability, 'function');
  assert.equal(esmModule.default.getLogger, esmModule.getLogger);
});
