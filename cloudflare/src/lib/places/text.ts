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

/**
 * Words that prefix thousands of names without identifying any ("Đường X",
 * "Phường X", "Thôn 3", "Xã Y"). They are never used to locate a record — a
 * shard keyed on "duong" would hold every street in the country — but still
 * count when scoring a record that was found another way.
 */
export const NON_KEY_WORDS = new Set([
  "duong",
  "pho",
  "ngo",
  "hem",
  "phuong",
  "xa",
  "quan",
  "huyen",
  "thi",
  "tran",
  "thanh",
  "tinh",
  "tp",
  "tx",
  "tt",
  "thon",
  "ap",
  "xom",
  "khu",
  "kp",
  "to",
  // Type words of businesses and institutions ("Trường X", "Nhà thờ Y",
  // "Công ty Z", "Bệnh viện W"): the same reason, one shard per word otherwise.
  "so",
  "truong",
  "nha",
  "cong",
  "cho",
  "chua",
  "benh",
  "vien",
  "cua",
  "hang",
  "khach",
  "dai",
  "hoc",
  "ngan",
]);

/**
 * The words a record is found by: its name tokens minus [NON_KEY_WORDS]
 * (kept when nothing else is left, so "Phường 1" stays findable).
 */
export function keyWords(name: string): string[] {
  const tokens = tokenize(name);
  const keep = tokens.filter((t) => !NON_KEY_WORDS.has(t));
  return keep.length > 0 ? keep : tokens;
}
