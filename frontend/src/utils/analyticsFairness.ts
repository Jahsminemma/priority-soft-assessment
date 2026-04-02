/**
 * Gini coefficient for nonnegative values: 0 = perfectly equal distribution, 1 = maximally unequal.
 */
export function giniCoefficient(values: number[]): number | null {
  const n = values.length;
  if (n === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    weighted += (i + 1) * sorted[i]!;
  }
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

/** 100 = perfectly equal premium share across roster; lower = more skewed. */
export function premiumFairnessScore(counts: number[]): number | null {
  const g = giniCoefficient(counts);
  if (g == null) return null;
  return Math.round(100 * (1 - g));
}
