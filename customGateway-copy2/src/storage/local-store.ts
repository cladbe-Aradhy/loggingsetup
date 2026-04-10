import crypto from 'node:crypto';

export type QueueName = 'fresh' | 'retry' | 'dead';

export type FailureType =
  | 'forwarding_disabled'
  | 'bad_request'
  | 'invalid_payload'
  | 'invalid_schema'
  | 'unsupported_media_type'
  | 'unprocessable_entity'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'upstream_5xx'
  | 'upstream_unavailable'
  | 'auth_or_config_error'
  | 'unknown';

export type StoredPayload = {
  id: number;
  fingerprint: string;
  type: string;
  transport: string;
  receivedAt: string;
  contentType: string;
  sizeBytes: number;
  bodyText: string | null;
  bodyBase64: string | null;
  bodyJson: unknown;
  queueName: QueueName;
  state: 'queued' | 'retry_scheduled' | 'forwarded' | 'dead';
  attemptCount: number;
  lastAttemptAt: string | null;
  forwardedAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  failureType: FailureType | null;
  lastGrpcCode: number | null;
  deadAt: string | null;
};

export type DeadQueueDropSummary = {
  id: number;
  fingerprint: string;
  type: string;
  transport: string;
  contentType: string;
  failureType: FailureType | null;
  deadAt: string | null;
  droppedAt: string;
};

export type DeadQueueOverflowStats = {
  totalDropped: number;
  lastDroppedAt: string | null;
  recentDrops: DeadQueueDropSummary[];
};

export const freshQueue: StoredPayload[] = [];
export const retryQueue: StoredPayload[] = [];
export const deadQueue: StoredPayload[] = [];
export const deadQueueOverflow: DeadQueueOverflowStats = {
  totalDropped: 0,
  lastDroppedAt: null,
  recentDrops: []
};

let nextId = 1;

type SavePayloadResult = {
  item: StoredPayload;
  isDuplicate: boolean;
};

function isTextContent(contentType: string) {
  return (
    contentType.includes('json') ||
    contentType.includes('text') ||
    contentType.includes('xml') ||
    contentType.includes('x-www-form-urlencoded')
  );
}

function getQueueByName(queueName: QueueName) {
  switch (queueName) {
    case 'fresh':
      return freshQueue;
    case 'retry':
      return retryQueue;
    case 'dead':
      return deadQueue;
  }
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
  removeFromQueue('retry', id);
  removeFromQueue('dead', id);
}

function findLivePayloadByFingerprint(fingerprint: string) {
  return [...freshQueue, ...retryQueue].find((item) => item.fingerprint === fingerprint);
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
  fingerprint: string,
  type: string,
  transport: string,
  contentType: string,
  sizeBytes: number,
  bodyText: string | null,
  bodyBase64: string | null,
  bodyJson: unknown
): SavePayloadResult {
  const existingItem = findLivePayloadByFingerprint(fingerprint);

  if (existingItem) {
    return {
      item: existingItem,
      isDuplicate: true
    };
  }

  const item: StoredPayload = {
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
  freshQueue.push(item);
  return {
    item,
    isDuplicate: false
  };
}

function buildFingerprint(transport: string, contentType: string, bodyValue: string) {
  return crypto
    .createHash('sha256')
    .update(`${transport}:${contentType}:${bodyValue}`)
    .digest('hex');
}

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

  const fingerprint = buildFingerprint(
    transport,
    contentType,
    bodyText ?? bodyBase64 ?? ''
  );

  return createStoredItem(
    fingerprint,
    type,
    transport,
    contentType,
    rawBody.byteLength,
    bodyText,
    bodyBase64,
    bodyJson
  );
}

export function saveJsonPayload(
  type: string,
  transport: string,
  contentType: string,
  bodyJson: unknown
) {
  const bodyText = JSON.stringify(bodyJson, null, 2);
  const fingerprint = buildFingerprint(transport, contentType, bodyText);

  return createStoredItem(
    fingerprint,
    type,
    transport,
    contentType,
    Buffer.byteLength(bodyText, 'utf8'),
    bodyText,
    null,
    bodyJson
  );
}


/////////////////////////////////////////////////

export function noteUnattemptedPayload(
  item: StoredPayload,
  failureType: FailureType,
  error: string | null
) {
  item.state = item.queueName === 'retry' ? 'retry_scheduled' : 'queued';
  item.lastError = error;
  item.failureType = failureType;
}

export function markPayloadForRetry(
  item: StoredPayload,
  failureType: FailureType,
  error: string | null,
  retryAfterMs: number,
  grpcCode: number | null = null
) {
  recordAttemptMetadata(item);
  item.state = 'retry_scheduled';
  item.nextRetryAt = new Date(Date.now() + retryAfterMs).toISOString();
  item.lastError = error;
  item.failureType = failureType;
  item.lastGrpcCode = grpcCode;
  moveToQueue(item, 'retry');
}

export function markPayloadAsDead(
  item: StoredPayload,
  failureType: FailureType,
  error: string | null,
  grpcCode: number | null = null
) {
  recordAttemptMetadata(item);
  item.state = 'dead';
  item.nextRetryAt = null;
  item.lastError = error;
  item.failureType = failureType;
  item.lastGrpcCode = grpcCode;
  item.deadAt = new Date().toISOString();
  moveToQueue(item, 'dead');
}

export function markPayloadAsForwarded(item: StoredPayload) {
  recordAttemptMetadata(item);
  item.state = 'forwarded';
  item.forwardedAt = new Date().toISOString();
  item.nextRetryAt = null;
  item.lastError = null;
  item.failureType = null;
  item.lastGrpcCode = null;
  removeFromAllQueues(item.id);
}

export function trimDeadQueue(maxDeadQueueSize: number) {
  while (deadQueue.length > maxDeadQueueSize) {
    const droppedItem = deadQueue.shift();

    if (!droppedItem) {
      return;
    }

    const droppedAt = new Date().toISOString();
    deadQueueOverflow.totalDropped += 1;
    deadQueueOverflow.lastDroppedAt = droppedAt;
    deadQueueOverflow.recentDrops.push({
      id: droppedItem.id,
      fingerprint: droppedItem.fingerprint,
      type: droppedItem.type,
      transport: droppedItem.transport,
      contentType: droppedItem.contentType,
      failureType: droppedItem.failureType,
      deadAt: droppedItem.deadAt,
      droppedAt
    });

    while (deadQueueOverflow.recentDrops.length > 20) {
      deadQueueOverflow.recentDrops.shift();
    }
  }
}

export function clearStore() {
  freshQueue.length = 0;
  retryQueue.length = 0;
  deadQueue.length = 0;
  deadQueueOverflow.totalDropped = 0;
  deadQueueOverflow.lastDroppedAt = null;
  deadQueueOverflow.recentDrops.length = 0;
  nextId = 1;
}

export function getAllStoredPayloads() {
  return [...freshQueue, ...retryQueue, ...deadQueue];
}

export function getQueueCounts() {
  return {
    fresh: freshQueue.length,
    retry: retryQueue.length,
    dead: deadQueue.length,
    live: freshQueue.length + retryQueue.length,
    deadDropped: deadQueueOverflow.totalDropped
  };
}

export function getLivePayloadCount() {
  return freshQueue.length + retryQueue.length;
}
