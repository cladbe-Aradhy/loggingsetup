'use strict';

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
