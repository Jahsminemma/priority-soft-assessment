/** Minimum length for manager emergency override (documented reason). */
export const EMERGENCY_OVERRIDE_MIN_LEN = 10;

export function isValidEmergencyOverrideReason(reason: string | undefined): boolean {
  return (reason?.trim().length ?? 0) >= EMERGENCY_OVERRIDE_MIN_LEN;
}
