let shuttingDown = false;

export function isGatewayShuttingDown() {
  return shuttingDown;
}

export function markGatewayShuttingDown() {
  shuttingDown = true;
}
