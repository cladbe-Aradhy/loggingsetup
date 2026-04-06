export const storedPayloads: Array<{
  id: number;
  type: string;
  transport: string;
  receivedAt: string;
  contentType: string;
  sizeBytes: number;
  bodyText: string | null;
  bodyBase64: string | null;
  bodyJson: unknown;
}> = [];

let nextId = 1;

function isTextContent(contentType: string) {
  return (
    contentType.includes('json') ||
    contentType.includes('text') ||
    contentType.includes('xml') ||
    contentType.includes('x-www-form-urlencoded')
  );
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
  storedPayloads.push(item);
  return item;
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

export function saveJsonPayload(
  type: string,
  transport: string,
  contentType: string,
  bodyJson: unknown
) {
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

export function clearStore() {
  storedPayloads.length = 0;
  nextId = 1;
}
