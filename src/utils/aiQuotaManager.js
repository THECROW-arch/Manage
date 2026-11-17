export const FREE_AI_COMMAND_LIMIT = 5;
export const FREE_AI_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours in milliseconds

function getStorageKey(userId) {
  return `managed_ai_quota_${String(userId || 'anon').trim()}`;
}

/**
 * Reads and prunes timestamps older than 48 hours for the specified user with safe storage error catching.
 * @param {string} userId
 * @param {number} [nowMs]
 * @returns {number[]} Valid timestamps within the active 48-hour window
 */
export function getActiveAIUsageTimestamps(userId, nowMs = Date.now()) {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const storage = window.localStorage;
    if (!storage) return [];
    const key = getStorageKey(userId);
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = nowMs - FREE_AI_WINDOW_MS;
    const valid = parsed
      .map((ts) => Number(ts))
      .filter((ts) => Number.isFinite(ts) && ts > cutoff && ts <= nowMs + 60000)
      .sort((a, b) => a - b);

    if (valid.length !== parsed.length) {
      storage.setItem(key, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * Returns the current quota status for a user.
 * @param {string} userId
 * @param {boolean} hasProAccess
 * @param {number} [nowMs]
 */
export function getAIQuotaStatus(userId, hasProAccess, nowMs = Date.now()) {
  if (hasProAccess) {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      resetInHours: 0
    };
  }

  const active = getActiveAIUsageTimestamps(userId, nowMs);
  const used = active.length;
  const remaining = Math.max(0, FREE_AI_COMMAND_LIMIT - used);
  const oldestTs = active[0] || nowMs;
  const msUntilNextSlot = Math.max(0, oldestTs + FREE_AI_WINDOW_MS - nowMs);
  const resetInHours = Math.max(1, Math.ceil(msUntilNextSlot / (60 * 60 * 1000)));

  return {
    allowed: remaining > 0,
    remaining,
    limit: FREE_AI_COMMAND_LIMIT,
    resetInHours
  };
}

/**
 * Atomically checks and reserves a single AI command slot for a Free-tier user.
 * Refuses reservation if 5 commands are already recorded within the 48-hour window.
 * @param {string} userId
 * @param {boolean} hasProAccess
 * @param {number} [nowMs]
 */
export function tryConsumeAICommandQuota(userId, hasProAccess, nowMs = Date.now()) {
  if (hasProAccess || !userId) {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      resetInHours: 0
    };
  }

  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {
        allowed: true,
        remaining: FREE_AI_COMMAND_LIMIT - 1,
        limit: FREE_AI_COMMAND_LIMIT,
        resetInHours: 48
      };
    }

    const storage = window.localStorage;
    const key = getStorageKey(userId);
    const active = getActiveAIUsageTimestamps(userId, nowMs);

    if (active.length >= FREE_AI_COMMAND_LIMIT) {
      const oldestTs = active[0] || nowMs;
      const msUntilNextSlot = Math.max(0, oldestTs + FREE_AI_WINDOW_MS - nowMs);
      return {
        allowed: false,
        remaining: 0,
        limit: FREE_AI_COMMAND_LIMIT,
        resetInHours: Math.max(1, Math.ceil(msUntilNextSlot / (60 * 60 * 1000)))
      };
    }

    const updated = [...active, nowMs];
    storage.setItem(key, JSON.stringify(updated));

    const remaining = Math.max(0, FREE_AI_COMMAND_LIMIT - updated.length);
    const oldestTs = updated[0] || nowMs;
    const msUntilNextSlot = Math.max(0, oldestTs + FREE_AI_WINDOW_MS - nowMs);

    return {
      allowed: true,
      remaining,
      limit: FREE_AI_COMMAND_LIMIT,
      resetInHours: Math.max(1, Math.ceil(msUntilNextSlot / (60 * 60 * 1000)))
    };
  } catch {
    return getAIQuotaStatus(userId, false, nowMs);
  }
}

export const recordAICommandUsage = tryConsumeAICommandQuota;