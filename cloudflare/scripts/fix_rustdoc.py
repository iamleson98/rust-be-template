#!/usr/bin/env python3
"""Fix all rustdoc -D warnings findings in the backend workspace.

Each fix is (file, line_number, expected_old, new) — asserted to match
exactly once on that line, so a drifted source fails loudly instead of
silently corrupting a doc comment.
"""
import sys

FIXES = [
    # ── unresolved / private intra-doc links → plain code spans ──
    ("src/audio_call/hub.rs", 673, "[`pick_available_agent_id`]", "`pick_available_agent_id`"),
    ("src/auth/password.rs", 156, "(see [`workers`])", "(see `workers`)"),
    ("src/auth/password.rs", 177, "(see [`workers`])", "(see `workers`)"),
    ("src/cache/backend.rs", 64, "[`cache::backend`]", "`cache::backend`"),
    ("src/config/mod.rs", 3, "[`AppState`]", "`AppState`"),
    ("src/dto/job.rs", 1, "[`Model::status`]", "`Model::status`"),
    ("src/error.rs", 4, "[`AppError::status`]", "`AppError::status`"),
    ("src/jobs/mod.rs", 59, "[`JobService::trigger`]", "`JobService::trigger`"),
    ("src/jobs/mod.rs", 96, "[`JobPolicy`]", "`JobPolicy`"),
    ("src/middleware/auth_extractor.rs", 119, "[`SessionUser`]", "`SessionUser`"),
    ("src/middleware/auth_extractor.rs", 121, "[`SessionUser::is_staff`]", "`SessionUser::is_staff`"),
    ("src/middleware/resource_guard.rs", 24, "[`snapshot`]", "`snapshot`"),
    ("src/osm/schema.rs", 33, "[`crate::vn_text::normalize`]", "`crate::vn_text::normalize`"),
    ("src/osm/searcher.rs", 28, "[`AppState`](crate::auth::AppState)", "[`AppState`](crate::state::AppState)"),
    ("src/osm/searcher.rs", 172, "[`AppState`](crate::auth::AppState)", "[`AppState`](crate::state::AppState)"),
    ("src/osm/spatial.rs", 140, "[`lookup`]", "`lookup`"),
    ("src/service/job_service.rs", 14, "[`trigger`](Self::trigger)", "[`JobService::trigger`]"),
    ("src/worker/mod.rs", 7, "[`runner`]", "`runner`"),
    ("src/worker/db.rs", 108, "[`with_db`]", "`with_db`"),
    ("src/ws/hub.rs", 262, "[`try_acquire_global`]", "`try_acquire_global`"),
    ("src/ws/hub.rs", 262, "[`try_acquire_ip`]", "`try_acquire_ip`"),
    ("src/ws/hub.rs", 263, "[`unregister`]", "`unregister`"),
    ("src/ws/hub.rs", 537, "[`broadcast_to_staff`]", "`broadcast_to_staff`"),
    ("src/lib.rs", 69, "[`repair_seaql_migrations_applied_at`]", "`repair_seaql_migrations_applied_at`"),
    # ── redundant explicit link targets (short form already resolves) ──
    ("src/osm/searcher.rs", 7,
     "[`vn_text::normalize`](crate::osm::vn_text::normalize)",
     "[`vn_text::normalize`]"),
    ("src/service/place_service.rs", 8,
     "[`PlaceSearcher`](crate::osm::searcher::PlaceSearcher)",
     "[`PlaceSearcher`]"),
    # ── bare URLs → autolinks ──
    ("src/routes/webhooks/discord.rs", 22,
     "https://discord.com/developers/applications",
     "<https://discord.com/developers/applications>"),
    ("src/routes/webhooks/messenger.rs", 16,
     "https://developers.facebook.com/",
     "<https://developers.facebook.com/>"),
    ("src/routes/webhooks/zalo.rs", 18,
     "https://oa.zalo.me/",
     "<https://oa.zalo.me/>"),
    # ── unclosed HTML tag in doc prose ──
    ("src/service/booking_service.rs", 1306,
     "→ Vec<String>.",
     "→ `Vec<String>`."),
]

def main():
    failures = []
    by_file = {}
    for entry in FIXES:
        by_file.setdefault(entry[0], []).append(entry)

    for path, fixes in by_file.items():
        with open(path) as f:
            lines = f.readlines()
        for path_, lineno, old, new in fixes:
            idx = lineno - 1
            if idx >= len(lines):
                failures.append(f"{path}:{lineno}: line beyond EOF")
                continue
            if old not in lines[idx]:
                failures.append(f"{path}:{lineno}: expected {old!r} not found")
                continue
            if lines[idx].count(old) != 1:
                failures.append(f"{path}:{lineno}: {old!r} appears {lines[idx].count(old)}x")
                continue
            lines[idx] = lines[idx].replace(old, new)
        with open(path, "w") as f:
            f.writelines(lines)

    if failures:
        print("FAILED:")
        for f_ in failures:
            print("  " + f_)
        sys.exit(1)
    print(f"all {len(FIXES)} doc fixes applied cleanly")

if __name__ == "__main__":
    main()
