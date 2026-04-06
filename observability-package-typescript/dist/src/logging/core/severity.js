'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const FATAL_PATTERN = /\b(fatal|panic|critical|crit|crash(ed)?)\b/i;
const WARN_PATTERN = /\b(warn|warning|deprecated|retry|slow|timeout)\b/i;
const ERROR_PATTERN = /\b(err|error|exception|failed|failure|reject|rejection|refused|denied|unavailable|db down|connection issue|payment failed)\b/i;
const ERROR_CODE_PATTERN = /^E[A-Z0-9_]+$/;
function normalizeSeverity(level) {
    const value = String(level || '').toLowerCase();
    if (value === 'fatal' || value === 'critical' || value === 'crit') {
        return 'fatal';
    }
    if (value === 'error' || value === 'err') {
        return 'error';
    }
    if (value === 'warn' || value === 'warning') {
        return 'warn';
    }
    if (value === 'debug' || value === 'trace') {
        return 'debug';
    }
    return 'info';
}
function isErrorLikeObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (value instanceof Error) {
        return true;
    }
    if (value.fatal === true) {
        return true;
    }
    if (typeof value.level === 'string' && ['fatal', 'error'].includes(String(value.level).toLowerCase())) {
        return true;
    }
    if (typeof value.severity === 'string' && ['fatal', 'error'].includes(String(value.severity).toLowerCase())) {
        return true;
    }
    if (typeof value.err === 'object' || typeof value.error === 'object') {
        return true;
    }
    if (typeof value.stack === 'string') {
        return true;
    }
    if (typeof value.code === 'string' && ERROR_CODE_PATTERN.test(value.code)) {
        return true;
    }
    if (typeof value.errno === 'number') {
        return true;
    }
    if (typeof value.status === 'number' && value.status >= 500) {
        return true;
    }
    if (typeof value.statusCode === 'number' && value.statusCode >= 500) {
        return true;
    }
    if (typeof value.message === 'string') {
        return ERROR_PATTERN.test(value.message) || FATAL_PATTERN.test(value.message);
    }
    return false;
}
function inferSeverityFromText(text, fallbackLevel) {
    const input = String(text || '').trim();
    if (!input) {
        return normalizeSeverity(fallbackLevel);
    }
    if (FATAL_PATTERN.test(input)) {
        return 'fatal';
    }
    if (ERROR_PATTERN.test(input)) {
        return 'error';
    }
    if (WARN_PATTERN.test(input)) {
        return 'warn';
    }
    return normalizeSeverity(fallbackLevel);
}
function resolveSeverity(options) {
    const fallbackLevel = normalizeSeverity(options && options.fallbackLevel);
    const args = Array.isArray(options && options.args) ? options.args : [];
    const message = options && options.message;
    const fields = options && options.fields;
    const smartSeverityDetection = !(options && options.smartSeverityDetection === false);
    if (!smartSeverityDetection) {
        return fallbackLevel;
    }
    if (fields && fields.fatal === true) {
        return 'fatal';
    }
    if (isErrorLikeObject(fields && (fields.err || fields.error))) {
        return 'error';
    }
    if (fields && typeof fields.level === 'string') {
        const fieldLevel = normalizeSeverity(fields.level);
        if (fieldLevel !== 'info') {
            return fieldLevel;
        }
    }
    if (args.some((arg) => isErrorLikeObject(arg))) {
        const fatalArg = args.find((arg) => arg && arg.fatal === true);
        return fatalArg ? 'fatal' : 'error';
    }
    if (isErrorLikeObject(fields)) {
        return fields.fatal === true ? 'fatal' : 'error';
    }
    const inferredFromMessage = inferSeverityFromText(message, fallbackLevel);
    if (inferredFromMessage !== fallbackLevel || ['fatal', 'error', 'warn'].includes(inferredFromMessage)) {
        return inferredFromMessage;
    }
    return args.reduce((resolvedLevel, arg) => {
        if (typeof arg !== 'string') {
            return resolvedLevel;
        }
        const candidate = inferSeverityFromText(arg, resolvedLevel);
        if (candidate === 'fatal') {
            return 'fatal';
        }
        if (candidate === 'error' && resolvedLevel !== 'fatal') {
            return 'error';
        }
        if (candidate === 'warn' && !['fatal', 'error'].includes(resolvedLevel)) {
            return 'warn';
        }
        return resolvedLevel;
    }, fallbackLevel);
}
module.exports = {
    normalizeSeverity,
    resolveSeverity
};
