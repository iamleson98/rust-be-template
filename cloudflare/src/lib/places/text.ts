/**
 * Text folding shared by the shard BUILDER (CI) and the shard SEARCH (Worker).
 * One implementation on both sides: an index built with one normaliser and
 * queried with another silently returns nothing.
 */
import { stripTones } from "@/lib/format";

/** Lower-case, diacritic-free, single-spaced ("Hà  Nội" → "ha noi"). */
export function fold(s: string): string {
  return stripTones(s).replace(/\s+/g, " ");
}

/** Alphanumeric tokens of the folded text. */
export function tokenize(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Folded text with every non-alphanumeric removed ("Hà Nội" → "hanoi"). */
export function compact(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, "");
}

/** Vietnamese administrative abbreviations people type ("P. Bến Nghé"). */
export function expandAbbreviations(q: string): string {
  return q
    .replace(/\bP\.\s*/gi, "Phường ")
    .replace(/\bQ\.\s*/gi, "Quận ")
    .replace(/\bTP\.\s*/gi, "Thành phố ")
    .replace(/\bTX\.\s*/gi, "Thị xã ")
    .replace(/\bTT\.\s*/gi, "Thị trấn ")
    .replace(/\bX\.\s*/gi, "Xã ")
    .replace(/\bĐ\.\s*/gi, "Đường ")
    .replace(/\bD\.\s*/gi, "Đường ")
    .replace(/\bSt\.\s*/gi, "Đường ");
}
