"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deadQueue = exports.freshQueue = void 0;
exports.saveRawPayload = saveRawPayload;
exports.saveJsonPayload = saveJsonPayload;
exports.notePendingPayload = notePendingPayload;
exports.markPayloadAttemptFailed = markPayloadAttemptFailed;
exports.markPayloadAsForwarded = markPayloadAsForwarded;
exports.trimDeadQueue = trimDeadQueue;
exports.clearStore = clearStore;
exports.getAllStoredPayloads = getAllStoredPayloads;
exports.getQueueCounts = getQueueCounts;
exports.getLivePayloadCount = getLivePayloadCount;
exports.freshQueue = [];
exports.deadQueue = [];
let nextId = 1;
function isTextContent(contentType) {
    return (contentType.includes('json') ||
        contentType.includes('text') ||
        contentType.includes('xml') ||
        contentType.includes('x-www-form-urlencoded'));
}
function getQueueByName(queueName) {
    return queueName === 'fresh' ? exports.freshQueue : exports.deadQueue;
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
    removeFromQueue('dead', id);
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
function createStoredItem(type, transport, contentType, sizeBytes, bodyText, bodyBase64, bodyJson) {
    const item = {
        id: nextId,
        type,
        transport,
        receivedAt: new Date().toISOString(),
        contentType,
        sizeBytes,
        bodyText,
        bodyBase64,
        bodyJson,
        queueName: 'fresh',
        attemptCount: 0,
        lastAttemptAt: null,
        lastError: null,
        lastGrpcCode: null,
        deadAt: null
    };
    nextId += 1;
    exports.freshQueue.push(item);
    return item;
}
//for http
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
    return createStoredItem(type, transport, contentType, rawBody.byteLength, bodyText, bodyBase64, bodyJson);
}
//for grpc
function saveJsonPayload(type, transport, contentType, bodyJson) {
    //we store the bodyjson as text 
    const bodyText = JSON.stringify(bodyJson, null, 2);
    return createStoredItem(type, transport, contentType, Buffer.byteLength(bodyText, 'utf8'), bodyText, null, bodyJson);
}
// note in the item why payload not forworded and resinon
function notePendingPayload(item, error, grpcCode = null) {
    item.lastError = error;
    item.lastGrpcCode = grpcCode;
}
// when forwarding attempt failed, update the item with error and grpc code, if attempts exceed maxAttempts then move to dead queue otherwise keep in fresh queue for retry, also record the attempt metadata like count and timestamp
function markPayloadAttemptFailed(item, error, grpcCode = null, maxAttempts = 3) {
    recordAttemptMetadata(item);
    item.lastError = error;
    item.lastGrpcCode = grpcCode;
    if (item.attemptCount >= maxAttempts) {
        item.deadAt = new Date().toISOString();
        moveToQueue(item, 'dead');
        return;
    }
    moveToQueue(item, 'fresh');
}
// use for remove item from queue when forwording attempt success, also clear the error and grpc code 
function markPayloadAsForwarded(item) {
    recordAttemptMetadata(item);
    item.lastError = null;
    item.lastGrpcCode = null;
    item.deadAt = null;
    removeFromAllQueues(item.id);
}
function trimDeadQueue(maxDeadQueueSize) {
    while (exports.deadQueue.length > maxDeadQueueSize) {
        exports.deadQueue.shift();
    }
}
function clearStore() {
    exports.freshQueue.length = 0;
    exports.deadQueue.length = 0;
    nextId = 1;
}
function getAllStoredPayloads() {
    return [...exports.freshQueue, ...exports.deadQueue];
}
function getQueueCounts() {
    return {
        fresh: exports.freshQueue.length,
        dead: exports.deadQueue.length,
        live: exports.freshQueue.length
    };
}
function getLivePayloadCount() {
    return exports.freshQueue.length;
}
