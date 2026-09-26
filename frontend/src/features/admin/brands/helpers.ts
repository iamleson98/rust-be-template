/**
 * Pure helper functions for the AdminBrandManagement module.
 *
 * Only the brand-form's slugify survives the tree-table redesign —
 * the display helpers (daysLabel, route labels, sorting) moved to
 * `brand-tree-helpers.ts`. Kept as pure functions so they can be unit
 * tested in isolation.
 */

/** Vietnamese-friendly slugify: strips tones, lowercases, joins words with `-`. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
