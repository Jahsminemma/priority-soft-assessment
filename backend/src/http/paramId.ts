/** Express `req.params` values may be typed as `string | string[]` in strict setups. */
export function singleParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : value[0];
}
