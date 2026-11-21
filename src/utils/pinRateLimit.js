const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

const attemptsByProfile = new Map();

function getRecentAttempts(profileId, now) {
  const list = attemptsByProfile.get(profileId) || [];
  const valid = list.filter((ts) => now - ts < WINDOW_MS);
  if (valid.length === 0) {
    attemptsByProfile.delete(profileId);
  } else {
    attemptsByProfile.set(profileId, valid);
  }
  return valid;
}

function isPinBlocked(profileId, now = Date.now()) {
  return getRecentAttempts(profileId, now).length >= MAX_ATTEMPTS;
}

function recordPinFailure(profileId, now = Date.now()) {
  const recent = getRecentAttempts(profileId, now);
  recent.push(now);
  attemptsByProfile.set(profileId, recent);
  return recent.length;
}

function clearPinFailures(profileId) {
  attemptsByProfile.delete(profileId);
}

module.exports = {
  isPinBlocked,
  recordPinFailure,
  clearPinFailures,
};
