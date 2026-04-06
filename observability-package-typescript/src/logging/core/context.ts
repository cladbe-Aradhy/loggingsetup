'use strict';

const { trace, context } = require('@opentelemetry/api');

function getTraceContext(activeContext) {
  const ctx = activeContext || context.active();
  const span = trace.getSpan(ctx);

  if (!span) {
    return {
      trace_id: undefined,
      span_id: undefined,
      trace_flags: undefined
    };
  }

  const spanContext = span.spanContext();

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags
  };
}

module.exports = {
  getTraceContext
};
