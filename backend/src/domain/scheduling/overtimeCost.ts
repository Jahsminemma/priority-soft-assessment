/** Weekly straight-time cap before OT (US-style 40h), in minutes. */
export const WEEKLY_STRAIGHT_CAP_MIN = 40 * 60;

export const OT_MULTIPLIER = 1.5;

/** Demo default when neither staff nor location sets a rate. */
export const DEFAULT_HOURLY_RATE_USD = 20;

export function resolveHourlyRateUsd(
  staffRate: number | null | undefined,
  locationDefault: number | null | undefined,
): number {
  if (staffRate != null && Number.isFinite(staffRate) && staffRate > 0) return staffRate;
  if (locationDefault != null && Number.isFinite(locationDefault) && locationDefault > 0) return locationDefault;
  return DEFAULT_HOURLY_RATE_USD;
}

export type FifoInterval = {
  id: string;
  /** Epoch ms for ordering within the week. */
  startMs: number;
  durationMin: number;
};

export type FifoSplit = { straightMin: number; otMin: number };

/**
 * FIFO by shift start: first scheduled minutes in the week count toward straight time;
 * remainder is OT. Ties broken by `id` for stability.
 */
export function fifoStraightOtPerInterval(
  intervals: FifoInterval[],
  capMin: number = WEEKLY_STRAIGHT_CAP_MIN,
): Map<string, FifoSplit> {
  const sorted = [...intervals].sort((a, b) => {
    const t = a.startMs - b.startMs;
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
  let cum = 0;
  const map = new Map<string, FifoSplit>();
  for (const iv of sorted) {
    const dur = iv.durationMin;
    const straightPart = Math.min(dur, Math.max(0, capMin - cum));
    const otPart = dur - straightPart;
    cum += dur;
    map.set(iv.id, { straightMin: straightPart, otMin: otPart });
  }
  return map;
}

export function laborUsdFromSplit(straightMin: number, otMin: number, hourlyRateUsd: number): number {
  const straight = (straightMin / 60) * hourlyRateUsd;
  const ot = (otMin / 60) * hourlyRateUsd * OT_MULTIPLIER;
  return straight + ot;
}

export function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}
