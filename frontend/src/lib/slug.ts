/**
 * Vietnamese-aware slugify: strips diacritics, lowercases, replaces
 * non-alphanumeric runs with a single `-`. Mirrors the backend's
 * `slugify` so operator-typed labels produce matching codes.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
