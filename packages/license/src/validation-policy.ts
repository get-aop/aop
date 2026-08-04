/** Re-check paid licenses with the hosted server at most once per day. */
export const LICENSE_VALIDATION_CACHE_MS = 24 * 60 * 60 * 1000;

/** Allow cached entitlement when the license server is unreachable (e.g. offline). */
export const LICENSE_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const parseValidatedAtMs = (validatedAtIso: string | null | undefined): number | null => {
  const trimmed = validatedAtIso?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
};

export const shouldRefreshLicenseValidation = (
  validatedAtIso: string | null | undefined,
  nowMs = Date.now(),
): boolean => {
  const validatedAtMs = parseValidatedAtMs(validatedAtIso);
  if (validatedAtMs === null) {
    return true;
  }
  return nowMs - validatedAtMs >= LICENSE_VALIDATION_CACHE_MS;
};

export const isWithinOfflineGrace = (
  validatedAtIso: string | null | undefined,
  nowMs = Date.now(),
): boolean => {
  const validatedAtMs = parseValidatedAtMs(validatedAtIso);
  if (validatedAtMs === null) {
    return false;
  }
  return nowMs - validatedAtMs < LICENSE_OFFLINE_GRACE_MS;
};
