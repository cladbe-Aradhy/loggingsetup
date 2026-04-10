import { MAX_LIVE_QUEUE_SIZE } from '../config';
import { getLivePayloadCount } from '../storage/local-store';
import { isGatewayShuttingDown } from '../state/gateway-state';

export function canAcceptNewPayload() {
  return !isGatewayShuttingDown() && getLivePayloadCount() < MAX_LIVE_QUEUE_SIZE;
}
