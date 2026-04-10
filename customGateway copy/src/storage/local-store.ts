export type QueueName = 'fresh' | 'dead';

export type StoredPayload = {
  id: number;
  type: string; //'logs' 
  receivedAt: string;
  contentType: string; //'application/json' or 'application/grpc+proto' etc.
  transport: string; //'http' or 'grpc'
  sizeBytes: number;
  bodyText: string | null; //
  bodyBase64: string | null;
  bodyJson: unknown;
  queueName: QueueName;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastGrpcCode: number | null;
  deadAt: string | null;
};

export const freshQueue: StoredPayload[] = [];
export const deadQueue: StoredPayload[] = [];

let nextId = 1;

function isTextContent(contentType: string) {
  return (
    contentType.includes('json') ||
    contentType.includes('text') ||
    contentType.includes('xml') ||
    contentType.includes('x-www-form-urlencoded')
  );
}

function getQueueByName(queueName: QueueName) {
  return queueName === 'fresh' ? freshQueue : deadQueue;
}

function removeFromQueue(queueName: QueueName, id: number) {
  const queue = getQueueByName(queueName);
  const index = queue.findIndex((item) => item.id === id);

  if (index >= 0) {
    queue.splice(index, 1);
  }
}

function removeFromAllQueues(id: number) {
  removeFromQueue('fresh', id);
  removeFromQueue('dead', id);
}

function moveToQueue(item: StoredPayload, queueName: QueueName) {
  removeFromAllQueues(item.id);
  item.queueName = queueName;
  getQueueByName(queueName).push(item);
}

function recordAttemptMetadata(item: StoredPayload) {
  item.attemptCount += 1;
  item.lastAttemptAt = new Date().toISOString();
}

function createStoredItem(
  type: string,
  transport: string,
  contentType: string,
  sizeBytes: number,
  bodyText: string | null,
  bodyBase64: string | null,
  bodyJson: unknown
) {
  const item: StoredPayload = {
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
  freshQueue.push(item);
  return item;
}
//for http
export function saveRawPayload(
  type: string,
  transport: string,
  contentType: string,
  rawBody: Buffer
) {
  const bodyText = isTextContent(contentType) ? rawBody.toString('utf8') : null;
  const bodyBase64 = bodyText === null ? rawBody.toString('base64') : null;
  let bodyJson: unknown = null;

  if (contentType.includes('json') && bodyText && bodyText.trim()) {
    try {
      bodyJson = JSON.parse(bodyText);
    } catch (_error) {
      bodyJson = null;
    }
  }

  return createStoredItem(
    type,
    transport,
    contentType,
    rawBody.byteLength,
    bodyText,
    bodyBase64,
    bodyJson
  );
}
//for grpc
export function saveJsonPayload(
  type: string,
  transport: string,
  contentType: string,
  bodyJson: unknown
) {
  //we store the bodyjson as text 
  const bodyText = JSON.stringify(bodyJson, null, 2);

  return createStoredItem(
    type,
    transport,
    contentType,
    Buffer.byteLength(bodyText, 'utf8'),
    bodyText,
    null,
    bodyJson
  );
}


// note in the item why payload not forworded and resinon
export function notePendingPayload(
  item: StoredPayload,
  error: string | null,
  grpcCode: number | null = null
) {
  item.lastError = error;
  item.lastGrpcCode = grpcCode;
}


// when forwarding attempt failed, update the item with error and grpc code, if attempts exceed maxAttempts then move to dead queue otherwise keep in fresh queue for retry, also record the attempt metadata like count and timestamp
export function markPayloadAttemptFailed(
  item: StoredPayload,
  error: string | null,
  grpcCode: number | null = null,
  maxAttempts = 3
) {
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
export function markPayloadAsForwarded(item: StoredPayload) {
  recordAttemptMetadata(item);
  item.lastError = null;
  item.lastGrpcCode = null;
  item.deadAt = null;
  removeFromAllQueues(item.id);
}

export function trimDeadQueue(maxDeadQueueSize: number) {
  while (deadQueue.length > maxDeadQueueSize) {
    deadQueue.shift();
  }
}

export function clearStore() {
  freshQueue.length = 0;
  deadQueue.length = 0;
  nextId = 1;
}

export function getAllStoredPayloads() {
  return [...freshQueue, ...deadQueue];
}

export function getQueueCounts() {
  return {
    fresh: freshQueue.length,
    dead: deadQueue.length,
    live: freshQueue.length
  };
}

export function getLivePayloadCount() {
  return freshQueue.length;
}
