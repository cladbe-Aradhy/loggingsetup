#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SERVICE_DIR/.." && pwd)"
GATEWAY_DIR="$REPO_ROOT/gatewayService"
CLICKHOUSE_CONTAINER="signoz-clickhouse"
GATEWAY_HEALTH_URL="http://127.0.0.1:13133/"
GATEWAY_GRPC_ENDPOINT="http://127.0.0.1:14317"
DEFAULT_CONFIG="otel-collector-config.yaml"
LOW_NOISE_CONFIG="otel-collector-config.low-noise.yaml"

cleanup() {
  if [[ -n "${APP_PID:-}" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi

  GATEWAY_ENV_FILE=".env.local.example" \
  GATEWAY_COLLECTOR_CONFIG="$DEFAULT_CONFIG" \
  docker compose -f "$GATEWAY_DIR/docker-compose.yml" up -d --force-recreate >/dev/null

  if [[ -n "${APP_LOG:-}" && -f "${APP_LOG:-}" ]]; then
    rm -f "$APP_LOG"
  fi
}

trap cleanup EXIT

wait_for_gateway() {
  local started_at
  started_at="$(date +%s)"

  while true; do
    if curl -fsS "$GATEWAY_HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi

    if (( "$(date +%s)" - started_at > 60 )); then
      echo "gateway did not become ready in time" >&2
      return 1
    fi

    sleep 1
  done
}

wait_for_service() {
  local port="$1"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      return 0
    fi

    if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
      echo "mvc service exited early" >&2
      cat "$APP_LOG" >&2 || true
      return 1
    fi

    if (( "$(date +%s)" - started_at > 30 )); then
      echo "mvc service did not become ready in time" >&2
      cat "$APP_LOG" >&2 || true
      return 1
    fi

    sleep 1
  done
}

hit_json_route() {
  local method="$1"
  local url="$2"
  local expected_status="$3"
  local body="${4:-}"
  local response_file
  response_file="$(mktemp)"

  local status
  if [[ -n "$body" ]]; then
    status="$(curl -sS -o "$response_file" -w '%{http_code}' -X "$method" \
      -H 'content-type: application/json' \
      -d "$body" \
      "$url")"
  else
    status="$(curl -sS -o "$response_file" -w '%{http_code}' -X "$method" "$url")"
  fi

  if [[ "$status" != "$expected_status" ]]; then
    echo "unexpected status for $method $url: expected $expected_status got $status" >&2
    cat "$response_file" >&2 || true
    rm -f "$response_file"
    return 1
  fi

  rm -f "$response_file"
}

assert_service_log_contains() {
  local pattern="$1"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if grep -q "$pattern" "$APP_LOG"; then
      return 0
    fi

    if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
      echo "mvc service exited before expected log pattern appeared: $pattern" >&2
      cat "$APP_LOG" >&2 || true
      return 1
    fi

    if (( "$(date +%s)" - started_at > 20 )); then
      echo "timed out waiting for service log pattern: $pattern" >&2
      cat "$APP_LOG" >&2 || true
      return 1
    fi

    sleep 1
  done
}

query_clickhouse() {
  local query="$1"
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "$query"
}

wait_for_queries() {
  local mode_name="$1"
  local expect_success_log="$2"
  local expect_success_trace="$3"
  local logs_query="$4"
  local traces_query="$5"
  local started_at logs_json traces_json
  started_at="$(date +%s)"

  while true; do
    logs_json="$(query_clickhouse "$logs_query")"
    traces_json="$(query_clickhouse "$traces_query")"

    if node - <<'NODE' "$mode_name" "$expect_success_log" "$expect_success_trace" "$logs_json" "$traces_json"
const modeName = process.argv[2];
const expectSuccessLog = process.argv[3] === 'true';
const expectSuccessTrace = process.argv[4] === 'true';
const logs = JSON.parse(process.argv[5]);
const traces = JSON.parse(process.argv[6]);

function fail(message) {
  process.stderr.write(`${modeName}: ${message}\n`);
  process.exit(1);
}

if (!(Number(logs.grpc_logs) > 0)) fail('no gRPC logs yet');
if (!(Number(logs.mvc_error_logs) > 0)) fail('mvc error logs missing');
if (!(Number(logs.client_warning_logs) > 0)) fail('client warning logs missing');
if (!(Number(logs.dedupe_raw_logs) === 1)) fail('dedupe raw log not ready');
if (!(Number(logs.dedupe_summary_logs) === 1)) fail('dedupe summary log not ready');
if (!(Number(logs.manual_exception_logs) > 0)) fail('manual recorded exception log missing');
if (!(Number(logs.pino_stream_logs) > 0)) fail('pino stream adapter log missing');
if (!(Number(logs.pino_instrument_logs) > 0)) fail('pino instrumented log missing');
if (!(Number(logs.winston_transport_logs) > 0)) fail('winston transport log missing');
if (!(Number(logs.winston_instrument_logs) > 0)) fail('winston instrumented log missing');
if (!(Number(logs.package_express_error_logs) > 0)) fail('package express error log missing');
if (!(Number(traces.grpc_trace_ids) > 0)) fail('no gRPC traces yet');
if (!(Number(traces.warn_user_route_trace_ids) > 0)) fail('warn traces missing for /users');
if (!(Number(traces.warn_user_id_trace_ids) > 0)) fail('warn traces missing for /users/:id');
if (!(Number(traces.package_error_trace_ids) > 0)) fail('package express error trace missing');

if (expectSuccessLog) {
  if (!(Number(logs.success_health_logs) > 0)) fail('success /health log should exist');
} else if (!(Number(logs.success_health_logs) === 0)) {
  fail('success /health log should be filtered');
}

if (expectSuccessTrace) {
  if (!(Number(traces.success_health_trace_ids) > 0)) fail('success /health trace should exist');
} else if (!(Number(traces.success_health_trace_ids) === 0)) {
  fail('success /health trace should be filtered');
}
NODE
    then
      echo "$logs_json"
      echo "$traces_json"
      return 0
    fi

    if (( "$(date +%s)" - started_at > 45 )); then
      echo "timed out waiting for ClickHouse results in ${mode_name} mode" >&2
      echo "last logs: ${logs_json}" >&2
      echo "last traces: ${traces_json}" >&2
      return 1
    fi

    sleep 2
  done
}

run_mode() {
  local mode_name="$1"
  local config_file="$2"
  local expect_success_log="$3"
  local expect_success_trace="$4"
  local port="$5"
  local service_name="mvc-manual-integration-service-${mode_name}-$(date +%s)"

  APP_LOG="$(mktemp)"
  APP_PID=""

  echo "==> Restarting gateway in ${mode_name} mode"
  GATEWAY_ENV_FILE=".env.local.example" \
  GATEWAY_COLLECTOR_CONFIG="$config_file" \
  docker compose -f "$GATEWAY_DIR/docker-compose.yml" up -d --force-recreate >/dev/null

  wait_for_gateway

  echo "==> Starting MVC service for ${mode_name} mode"
  (
    cd "$SERVICE_DIR"
    PORT="$port" \
    NODE_ENV="test" \
    OTEL_SERVICE_NAME="$service_name" \
    SERVICE_VERSION="1.0.0-smoke" \
    OTEL_EXPORTER_OTLP_ENDPOINT="$GATEWAY_GRPC_ENDPOINT" \
    OTEL_EXPORTER_OTLP_PROTOCOL="grpc" \
    node dist/server.js
  ) >"$APP_LOG" 2>&1 &
  APP_PID="$!"

  wait_for_service "$port"

  echo "==> Hitting MVC routes for ${mode_name} mode"
  hit_json_route "GET" "http://127.0.0.1:${port}/health" "200"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/logger-tools" "200"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/span-metrics" "200"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/record-exception" "202"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/pino-stream" "200"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/pino-instrument" "200"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/winston-transport" "200"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/winston-instrument" "200"
  hit_json_route "GET" "http://127.0.0.1:${port}/package/express-error" "418"
  hit_json_route "POST" "http://127.0.0.1:${port}/users" "400" '{"name":"","email":""}'
  hit_json_route "GET" "http://127.0.0.1:${port}/users/missing-user" "404"
  hit_json_route "POST" "http://127.0.0.1:${port}/users" "201" '{"name":"Smoke Test User","email":"smoke-test@example.com"}'
  hit_json_route "GET" "http://127.0.0.1:${port}/dedupe/error-burst?count=5&waitMs=3200" "200"

  assert_service_log_contains 'mvc dedupe demo: DB failed (repeated 4 times, total 5)'

  kill "$APP_PID" >/dev/null 2>&1 || true
  wait "$APP_PID" >/dev/null 2>&1 || true
  APP_PID=""

  local logs_query traces_query query_output logs_json traces_json
  logs_query="SELECT countIf(body = 'request completed' AND attributes_string['http_route'] = '/health') AS success_health_logs, countIf(body = 'mvc request failed') AS mvc_error_logs, countIf(body = 'request completed with client warning') AS client_warning_logs, countIf(body = 'mvc dedupe demo: DB failed') AS dedupe_raw_logs, countIf(body = 'mvc dedupe demo: DB failed (repeated 4 times, total 5)') AS dedupe_summary_logs, countIf(body = 'mvc manual exception recorded') AS manual_exception_logs, countIf(body = 'mvc fake pino stream error') AS pino_stream_logs, countIf(body = 'mvc fake pino instrument error') AS pino_instrument_logs, countIf(body = 'mvc fake winston transport log') AS winston_transport_logs, countIf(body = 'mvc fake winston instrument log') AS winston_instrument_logs, countIf(body = 'express request failed') AS package_express_error_logs, countIf(resources_string['telemetry.ingest.protocol'] = 'grpc') AS grpc_logs FROM signoz_logs.distributed_logs_v2 WHERE resources_string['service.name'] = '${service_name}' AND timestamp >= toUInt64(toUnixTimestamp64Nano(now64(9) - INTERVAL 15 MINUTE)) FORMAT JSONEachRow"
  traces_query="SELECT countIf(attributes_string['http.route'] = '/health') AS success_health_trace_ids, countIf(attributes_string['http.route'] = '/users') AS warn_user_route_trace_ids, countIf(attributes_string['http.route'] = '/users/:id') AS warn_user_id_trace_ids, countIf(attributes_string['http.route'] = '/package/express-error') AS package_error_trace_ids, countIf(resources_string['telemetry.ingest.protocol'] = 'grpc') AS grpc_trace_ids FROM signoz_traces.distributed_signoz_index_v3 WHERE serviceName = '${service_name}' AND timestamp >= now() - INTERVAL 15 MINUTE FORMAT JSONEachRow"

  query_output="$(wait_for_queries "$mode_name" "$expect_success_log" "$expect_success_trace" "$logs_query" "$traces_query")"
  logs_json="$(printf '%s\n' "$query_output" | sed -n '1p')"
  traces_json="$(printf '%s\n' "$query_output" | sed -n '2p')"

  echo "==> ${mode_name} service.name: ${service_name}"
  echo "logs: ${logs_json}"
  echo "traces: ${traces_json}"

  rm -f "$APP_LOG"
  APP_LOG=""
}

cd "$SERVICE_DIR"
npm run build >/dev/null

run_mode "default" "$DEFAULT_CONFIG" "true" "true" "3083"
run_mode "low-noise" "$LOW_NOISE_CONFIG" "false" "false" "3084"

echo "MVC service gateway smoke test passed for default and low-noise modes"
