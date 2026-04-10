import type { Context } from 'hono';
import { getQueueCounts, saveRawPayload } from '../storage/local-store';
import { otlpLogsPayloadSchema } from '../validation/otlp-logs-schema';
import { tryForwardStoredPayload } from '../services/log-forwarder';
import { canAcceptNewPayload } from '../services/traffic';
import { isGatewayShuttingDown } from '../state/gateway-state';
import { buildFreshQueueMessage } from '../utils/forward-messages';
import { readBodyBuffer } from '../utils/http-utils';

export async function handleHttpLogs(c: Context) {
  if (isGatewayShuttingDown()) {
    return c.json(
      {
        ok: false,
        message: 'gateway is shutting down and not accepting new logs'
      },
      503
    );
  }

  if (!canAcceptNewPayload()) {
    return c.json(
      {
        ok: false,
        message: 'fresh in-memory queue is full',
        queueCounts: getQueueCounts()
      },
      503
    );
  }

  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const rawBody = await readBodyBuffer(c.req.raw);

  if (!contentType.toLowerCase().includes('json')) {
    return c.json(
      {
        ok: false,
        message: `HTTP logs must use JSON content-type (got ${contentType})`
      },
      422
    );
  }

  const bodyText = rawBody.toString('utf8');

  if (!bodyText.trim()) {
    return c.json(
      {
        ok: false,
        message: 'HTTP logs payload is empty'
      },
      400
    );
  }

  let bodyJson: any;

  try {
    bodyJson = JSON.parse(bodyText);
  } catch (_error) {
    return c.json(
      {
        ok: false,
        message: 'HTTP logs payload is not valid JSON'
      },
      400
    );
  }

  const validationResult = otlpLogsPayloadSchema.validate(bodyJson);

  if (validationResult.error) {
    return c.json(
      {
        ok: false,
        message: validationResult.error.details[0]?.message || 'HTTP logs payload is invalid'
      },
      422
    );
  }

  const stored = saveRawPayload('logs', 'http', contentType, rawBody);
  const forwardResult = await tryForwardStoredPayload(stored);

  if (forwardResult.forwarded) {
    return c.json({
      ok: true,
      message: 'logs payload forwarded to SigNoz',
      item: stored,
      queueCounts: getQueueCounts(),
      forward: forwardResult
    });
  }

  return c.json(
    {
      ok: true,
      message: buildFreshQueueMessage(stored, forwardResult),
      item: stored,
      queueCounts: getQueueCounts(),
      forward: forwardResult
    },
    202
  );
}
