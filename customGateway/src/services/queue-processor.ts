import * as grpc from '@grpc/grpc-js';
import { MAX_FORWARD_ATTEMPTS } from '../constants';
import { ENABLE_SIGNOZ_FORWARD, MAX_DEAD_QUEUE_SIZE } from '../config';
import {
  freshQueue,
  markPayloadAttemptFailed,
  trimDeadQueue
} from '../storage/local-store';
import { tryForwardStoredPayload } from './log-forwarder';

let isQueueScanRunning = false;

export async function processStoredPayloadQueue() {
  if (!ENABLE_SIGNOZ_FORWARD || isQueueScanRunning) {
    return;
  }

  isQueueScanRunning = true;

  try {
    for (const item of [...freshQueue]) {
      try {
        await tryForwardStoredPayload(item);
      } catch (error) {
        markPayloadAttemptFailed(
          item,
          error instanceof Error ? error.message : String(error),
          grpc.status.INTERNAL,
          MAX_FORWARD_ATTEMPTS
        );
      }
    }

    trimDeadQueue(MAX_DEAD_QUEUE_SIZE);
  } finally {
    isQueueScanRunning = false;
  }
}
