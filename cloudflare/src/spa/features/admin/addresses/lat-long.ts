/** "10.77 106.70" — a latitude and longitude separated by whitespace. */
export const LatLongRegex =
  /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)\s+[-+]?(180(\.0+)?|(1[0-7]\d|[1-9]?\d)(\.\d+)?)$/

export const parseLatLong = (input: string) =>
  LatLongRegex.test(input)
    ? { ok: true as const, value: input.split(/\s+/).map(Number) }
    : { ok: false as const }
