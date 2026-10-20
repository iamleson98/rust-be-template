import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";

// Produced by a reference Argon2 implementation (argon2-cffi) with the Rust
// backend's `Argon2::default()` parameters, so this proves imported users can
// still sign in.
const RUST_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$/vkPL4HQlKXIVmXe8+HXpA$0DlHKUpIPwRsS9KU97iVcp1HQgwIf6/7uaeCLKu+0CE";
const PASSWORD = "S3cret-pässword";

describe("password hashing", () => {
  it("verifies a legacy Rust Argon2id hash and rejects a wrong password", async () => {
    expect(await verifyPassword(PASSWORD, RUST_HASH)).toBe(true);
    expect(await verifyPassword("wrong", RUST_HASH)).toBe(false);
  });

  it("flags legacy hashes for rehash but not current PBKDF2 hashes", async () => {
    expect(needsRehash(RUST_HASH)).toBe(true);
    const fresh = await hashPassword(PASSWORD);
    expect(needsRehash(fresh)).toBe(false);
    expect(await verifyPassword(PASSWORD, fresh)).toBe(true);
  });

  it("refuses Argon2 parameters that would exhaust the CPU budget", async () => {
    const huge = RUST_HASH.replace("m=19456", "m=4194304");
    expect(await verifyPassword(PASSWORD, huge)).toBe(false);
  });

  it("rejects malformed or unknown hashes", async () => {
    expect(await verifyPassword(PASSWORD, null)).toBe(false);
    expect(await verifyPassword(PASSWORD, "$argon2id$garbage")).toBe(false);
    expect(await verifyPassword(PASSWORD, "plaintext")).toBe(false);
  });
});
