/**
 * Vietnamese-aware slugify: strips diacritics, lowercases, replaces
 * non-alphanumeric runs with a single `-`. Mirrors the backend's
 * `slugify` so operator-typed labels produce matching codes.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const LatLongRegex =
  /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)\s+[-+]?(180(\.0+)?|(1[0-7]\d|[1-9]?\d)(\.\d+)?)$/;

export const parseLatLong = (input: string) => {
  if (!LatLongRegex.test(input)) return { ok: false };
  return { ok: true, value: input.split(/\s+/).map(Number) };
};
