/** NFD does not decompose đ/Đ, so they are replaced explicitly. */
const stripTones = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");

/** Diacritic-insensitive form for matching: "Hà Nội" → "ha noi". */
export const noTones = (s: string) => stripTones(s).toLowerCase().trim();

/** Code/URL-safe slug, mirroring the backend: "Giường nằm" → "giuong-nam". */
export const slugify = (s: string) =>
  stripTones(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Vietnamese mobile number → E.164 (`0901…` / `84901…` → `+84901…`). */
export function normalizePhone(phone: string) {
  const p = phone.replace(/\s/g, "");
  if (p.startsWith("0")) return `+84${p.slice(1)}`;
  if (p.startsWith("84")) return `+${p}`;
  return p;
}

/** The number as Vietnamese forms take it (`+84901…` / `84901…` → `0901…`). */
export function localPhone(phone: string) {
  const p = phone.replace(/\s/g, "");
  if (p.startsWith("+84")) return `0${p.slice(3)}`;
  if (p.startsWith("84") && p.length > 10) return `0${p.slice(2)}`;
  return p;
}

const words = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean);

/**
 * A person's monogram for an avatar: the first letters of their last two
 * names, as Vietnamese given names come last ("Nguyễn Văn An" → "VA").
 */
export function personInitials(name: string | null | undefined, fallback = "?"): string {
  const parts = words(name);
  return (
    parts
      .slice(-2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || fallback
  );
}

/** A brand's monogram for its tile: the first letters of its first two words ("Phương Trang" → "PT"). */
export function brandInitials(name: string): string {
  const parts = words(name);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.trim().slice(0, 2)).toUpperCase();
}
