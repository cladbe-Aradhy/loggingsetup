'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fixturePath = path.join(__dirname, 'fixtures', 'log-dedupe-runner.js');
function runScenario(name) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fixturePath, name], {
            cwd: path.join(__dirname, '..'),
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
            if (code !== 0) {
                reject(new Error('scenario failed: ' + name + '\n' + stdout + '\n' + stderr));
                return;
            }
            const lines = (stdout + '\n' + stderr)
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('{') && line.endsWith('}'))
                .map((line) => JSON.parse(line));
            resolve(lines);
        });
    });
}
test('repeated error logs produce one raw log and one dedupe summary', async () => {
    const entries = await runScenario('repeat-error');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].message, 'DB failed');
    assert.equal(entries[1].message, 'DB failed (repeated 1 time, total 2)');
    assert.equal(entries[1].dedupe_summary, true);
    assert.equal(entries[1].dedupe_repeat_count, 1);
    assert.equal(entries[1].dedupe_total_count, 2);
    assert.equal(entries[1].dedupe_original_message, 'DB failed');
});
test('info logs are not deduped by default', async () => {
    const entries = await runScenario('repeat-info');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].dedupe_summary, undefined);
    assert.equal(entries[1].dedupe_summary, undefined);
});
test('different routes do not dedupe together', async () => {
    const entries = await runScenario('different-routes');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].http_route, '/orders');
    assert.equal(entries[1].http_route, '/payments');
});
test('logger output preserves serialized error code and status metadata', async () => {
    const entries = await runScenario('error-metadata');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].authorization, 'Bearer secret-token');
    assert.equal(entries[0].error.message, 'request failed');
    assert.equal(entries[0].error.code, 'ORDER_LOOKUP_FAILED');
    assert.equal(entries[0].error.status, 500);
    assert.equal(entries[0].error.statusCode, 502);
    assert.equal(entries[0].error.cause.message, 'database timed out');
    assert.equal(entries[0].error.cause.code, 'DB_TIMEOUT');
    assert.equal(entries[0].error.cause.status, 504);
});
