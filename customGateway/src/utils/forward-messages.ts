import { MAX_FORWARD_ATTEMPTS } from '../constants';
import type { StoredPayload } from '../storage/local-store';
import type { ForwardResult } from '../types/gateway-types';

export function buildFreshQueueMessage(
  item: StoredPayload,
  forwardResult: ForwardResult
) {
  const reason = forwardResult.reason || forwardResult.error || 'forward failed';
  return `payload kept in fresh queue (${reason}); attempts ${item.attemptCount}/${MAX_FORWARD_ATTEMPTS}`;
}
