'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
function getLevelFromStatus(status) {
    if (status >= 500) {
        return 'error';
    }
    if (status >= 400) {
        return 'warn';
    }
    return null;
}
module.exports = {
    getLevelFromStatus
};
