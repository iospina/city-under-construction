// ---------------------------------------------------------------------------
// permitStatus.ts
// Pure function that determines whether a permit is active.
//
// Active permit rules (from Build Data Schema):
//   permitStatus === "Permit Issued"
//   AND (expiredDate is null OR expiredDate is in the future)
// ---------------------------------------------------------------------------

/**
 * Returns true when the permit should be considered "active".
 */
export function isPermitActive(
  permitStatus: string,
  expiredDate: string | null | undefined,
): boolean {
  if (permitStatus !== 'Permit Issued') {
    return false;
  }

  if (!expiredDate) {
    return true;
  }

  const expiry = new Date(expiredDate);
  // Guard against invalid date strings
  if (isNaN(expiry.getTime())) {
    return true; // treat unparseable expiry as "no expiry"
  }

  return expiry.getTime() > Date.now();
}
