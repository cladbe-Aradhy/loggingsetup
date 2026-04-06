"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storedPayloads = void 0;
exports.saveRawPayload = saveRawPayload;
exports.saveJsonPayload = saveJsonPayload;
exports.clearStore = clearStore;
exports.storedPayloads = [];
let nextId = 1;
function isTextContent(contentType) {
    return (contentType.includes('json') ||
        contentType.includes('text') ||
        contentType.includes('xml') ||
        contentType.includes('x-www-form-urlencoded'));
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
        bodyJson
    };
    nextId += 1;
    exports.storedPayloads.push(item);
    return item;
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
    return createStoredItem(type, transport, contentType, rawBody.byteLength, bodyText, bodyBase64, bodyJson);
}
function saveJsonPayload(type, transport, contentType, bodyJson) {
    const bodyText = JSON.stringify(bodyJson, null, 2);
    return createStoredItem(type, transport, contentType, Buffer.byteLength(bodyText, 'utf8'), bodyText, null, bodyJson);
}
function clearStore() {
    exports.storedPayloads.length = 0;
    nextId = 1;
}
