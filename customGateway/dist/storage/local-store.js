"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deadQueueOverflow = exports.deadQueue = exports.retryQueue = exports.freshQueue = void 0;
exports.saveRawPayload = saveRawPayload;
exports.saveJsonPayload = saveJsonPayload;
exports.noteUnattemptedPayload = noteUnattemptedPayload;
exports.markPayloadForRetry = markPayloadForRetry;
exports.markPayloadAsDead = markPayloadAsDead;
exports.markPayloadAsForwarded = markPayloadAsForwarded;
exports.trimDeadQueue = trimDeadQueue;
exports.clearStore = clearStore;
exports.getAllStoredPayloads = getAllStoredPayloads;
exports.getQueueCounts = getQueueCounts;
exports.getLivePayloadCount = getLivePayloadCount;
const node_crypto_1 = __importDefault(require("node:crypto"));
exports.freshQueue = [];
exports.retryQueue = [];
exports.deadQueue = [];
exports.deadQueueOverflow = {
    totalDropped: 0,
    lastDroppedAt: null,
    recentDrops: []
};
let nextId = 1;
function isTextContent(contentType) {
    return (contentType.includes('json') ||
        contentType.includes('text') ||
        contentType.includes('xml') ||
        contentType.includes('x-www-form-urlencoded'));
}
function getQueueByName(queueName) {
    switch (queueName) {
        case 'fresh':
            return exports.freshQueue;
        case 'retry':
            return exports.retryQueue;
        case 'dead':
            return exports.deadQueue;
    }
}
function removeFromQueue(queueName, id) {
    const queue = getQueueByName(queueName);
    const index = queue.findIndex((item) => item.id === id);
    if (index >= 0) {
        queue.splice(index, 1);
    }
}
function removeFromAllQueues(id) {
    removeFromQueue('fresh', id);
    removeFromQueue('retry', id);
    removeFromQueue('dead', id);
}
function findLivePayloadByFingerprint(fingerprint) {
    return [...exports.freshQueue, ...exports.retryQueue].find((item) => item.fingerprint === fingerprint);
}
function moveToQueue(item, queueName) {
    removeFromAllQueues(item.id);
    item.queueName = queueName;
    getQueueByName(queueName).push(item);
}
function recordAttemptMetadata(item) {
    item.attemptCount += 1;
    item.lastAttemptAt = new Date().toISOString();
}
function createStoredItem(fingerprint, type, transport, contentType, sizeBytes, bodyText, bodyBase64, bodyJson) {
    const existingItem = findLivePayloadByFingerprint(fingerprint);
    if (existingItem) {
        return {
            item: existingItem,
            isDuplicate: true
        };
    }
    const item = {
        id: nextId,
        fingerprint,
        type,
        transport,
        receivedAt: new Date().toISOString(),
        contentType,
        sizeBytes,
        bodyText,
        bodyBase64,
        bodyJson,
        queueName: 'fresh',
        state: 'queued',
        attemptCount: 0,
        lastAttemptAt: null,
        forwardedAt: null,
        nextRetryAt: null,
        lastError: null,
        failureType: null,
        lastGrpcCode: null,
        deadAt: null
    };
    nextId += 1;
    exports.freshQueue.push(item);
    return {
        item,
        isDuplicate: false
    };
}
function buildFingerprint(transport, contentType, bodyValue) {
    return node_crypto_1.default
        .createHash('sha256')
        .update(`${transport}:${contentType}:${bodyValue}`)
        .digest('hex');
}
function saveRawPayload(type, transport, contentType, rawBody) {
    const bodyText = isTextContent(contentType) ? rawBody.toString('utf8') : null;
    const bodyBase64 = bodyText === null ? rawBody.toString('base64') : null;
    let bodyJson = null;
    if (contentType.includes('json') && bodyText && bodyText.trim()) {
        try {
            bodyJson = JSON.parse(bodyText);
        }
        catch (_error) {
            bodyJson = null;
        }
    }
    const fingerprint = buildFingerprint(transport, contentType, bodyText ?? bodyBase64 ?? '');
    return createStoredItem(fingerprint, type, transport, contentType, rawBody.byteLength, bodyText, bodyBase64, bodyJson);
}
function saveJsonPayload(type, transport, contentType, bodyJson) {
    const bodyText = JSON.stringify(bodyJson, null, 2);
    const fingerprint = buildFingerprint(transport, contentType, bodyText);
    return createStoredItem(fingerprint, type, transport, contentType, Buffer.byteLength(bodyText, 'utf8'), bodyText, null, bodyJson);
}
/////////////////////////////////////////////////
function noteUnattemptedPayload(item, failureType, error) {
    item.state = item.queueName === 'retry' ? 'retry_scheduled' : 'queued';
    item.lastError = error;
    item.failureType = failureType;
}
function markPayloadForRetry(item, failureType, error, retryAfterMs, grpcCode = null) {
    recordAttemptMetadata(item);
    item.state = 'retry_scheduled';
    item.nextRetryAt = new Date(Date.now() + retryAfterMs).toISOString();
    item.lastError = error;
    item.failureType = failureType;
    item.lastGrpcCode = grpcCode;
    moveToQueue(item, 'retry');
}
function markPayloadAsDead(item, failureType, error, grpcCode = null) {
    recordAttemptMetadata(item);
    item.state = 'dead';
    item.nextRetryAt = null;
    item.lastError = error;
    item.failureType = failureType;
    item.lastGrpcCode = grpcCode;
    item.deadAt = new Date().toISOString();
    moveToQueue(item, 'dead');
}
function markPayloadAsForwarded(item) {
    recordAttemptMetadata(item);
    item.state = 'forwarded';
    item.forwardedAt = new Date().toISOString();
    item.nextRetryAt = null;
    item.lastError = null;
    item.failureType = null;
    item.lastGrpcCode = null;
    removeFromAllQueues(item.id);
}
function trimDeadQueue(maxDeadQueueSize) {
    while (exports.deadQueue.length > maxDeadQueueSize) {
        const droppedItem = exports.deadQueue.shift();
        if (!droppedItem) {
            return;
        }
        const droppedAt = new Date().toISOString();
        exports.deadQueueOverflow.totalDropped += 1;
        exports.deadQueueOverflow.lastDroppedAt = droppedAt;
        exports.deadQueueOverflow.recentDrops.push({
            id: droppedItem.id,
            fingerprint: droppedItem.fingerprint,
            type: droppedItem.type,
            transport: droppedItem.transport,
            contentType: droppedItem.contentType,
            failureType: droppedItem.failureType,
            deadAt: droppedItem.deadAt,
            droppedAt
        });
        while (exports.deadQueueOverflow.recentDrops.length > 20) {
            exports.deadQueueOverflow.recentDrops.shift();
        }
    }
}
function clearStore() {
    exports.freshQueue.length = 0;
    exports.retryQueue.length = 0;
    exports.deadQueue.length = 0;
    exports.deadQueueOverflow.totalDropped = 0;
    exports.deadQueueOverflow.lastDroppedAt = null;
    exports.deadQueueOverflow.recentDrops.length = 0;
    nextId = 1;
}
function getAllStoredPayloads() {
    return [...exports.freshQueue, ...exports.retryQueue, ...exports.deadQueue];
}
function getQueueCounts() {
    return {
        fresh: exports.freshQueue.length,
        retry: exports.retryQueue.length,
        dead: exports.deadQueue.length,
        live: exports.freshQueue.length + exports.retryQueue.length,
        deadDropped: exports.deadQueueOverflow.totalDropped
    };
}
function getLivePayloadCount() {
    return exports.freshQueue.length + exports.retryQueue.length;
}
