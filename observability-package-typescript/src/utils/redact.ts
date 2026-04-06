'use strict';

function isPlainObject(value: unknown) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function redactValue(value: any, redactKeysSet: Set<string>, seen: WeakSet<object>) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactKeysSet, seen));
  }

  if (value instanceof Error) {
    const output: Record<string, any> = {
      name: value.name,
      message: value.message,
      stack: value.stack
    };

    if (value.code !== undefined) {
      output.code = value.code;
    }

    if (value.status !== undefined) {
      output.status = value.status;
    }

    if (value.statusCode !== undefined) {
      output.statusCode = value.statusCode;
    }

    Object.keys(value).forEach((key) => {
      if (key === 'name' || key === 'message' || key === 'stack') {
        return;
      }

      if (redactKeysSet.has(key.toLowerCase())) {
        output[key] = '[REDACTED]';
        return;
      }

      output[key] = redactValue(value[key], redactKeysSet, seen);
    });

    if (value.cause !== undefined && output.cause === undefined) {
      output.cause = redactValue(value.cause, redactKeysSet, seen);
    }

    return output;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output: Record<string, any> = {};

  Object.keys(value).forEach((key) => {
    if (redactKeysSet.has(key.toLowerCase())) {
      output[key] = '[REDACTED]';
      return;
    }

    output[key] = redactValue(value[key], redactKeysSet, seen);
  });

  return output;
}

function redactObject(value: any, redactKeys: any) {
  const redactKeysSet: Set<string> = new Set((redactKeys || []).map((key: any) => String(key).toLowerCase()));
  return redactValue(value, redactKeysSet, new WeakSet());
}

module.exports = {
  redactObject
};
