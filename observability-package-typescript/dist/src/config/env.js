'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}
function parseNumber(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : defaultValue;
}
function parseCsv(value) {
    if (!value) {
        return [];
    }
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function parseResourceAttributes(value) {
    if (!value) {
        return {};
    }
    return String(value)
        .split(',')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .reduce((attributes, pair) => {
        const [rawKey, ...rest] = pair.split('=');
        const key = rawKey && rawKey.trim();
        if (!key) {
            return attributes;
        }
        attributes[key] = rest.join('=').trim();
        return attributes;
    }, {});
}
module.exports = {
    parseBoolean,
    parseCsv,
    parseNumber,
    parseResourceAttributes
};
