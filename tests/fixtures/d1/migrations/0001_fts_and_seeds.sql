-- 0001: FTS5 full-text search (replacing Tantivy place search) + seed data.
-- Fixed UUIDs make re-application idempotent (INSERT OR IGNORE).

-- ── FTS5: place search (external-content virtual table) ────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS place_fts USING fts5(
  name,
  name_no_tones,
  province,
  district,
  ward,
  content='place',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS place_ai AFTER INSERT ON place BEGIN
  INSERT INTO place_fts(rowid, name, name_no_tones, province, district, ward)
  VALUES (new.rowid, new.name, new.name_no_tones, new.province, new.district, new.ward);
END;

CREATE TRIGGER IF NOT EXISTS place_ad AFTER DELETE ON place BEGIN
  INSERT INTO place_fts(place_fts, rowid, name, name_no_tones, province, district, ward)
  VALUES ('delete', old.rowid, old.name, old.name_no_tones, old.province, old.district, old.ward);
END;

CREATE TRIGGER IF NOT EXISTS place_au AFTER UPDATE ON place BEGIN
  INSERT INTO place_fts(place_fts, rowid, name, name_no_tones, province, district, ward)
  VALUES ('delete', old.rowid, old.name, old.name_no_tones, old.province, old.district, old.ward);
  INSERT INTO place_fts(rowid, name, name_no_tones, province, district, ward)
  VALUES (new.rowid, new.name, new.name_no_tones, new.province, new.district, new.ward);
END;

-- ── Roles ───────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('00000000-0000-4000-a000-000000000001', 'admin',    'Full access — system administrator'),
  ('00000000-0000-4000-a000-000000000002', 'employee', 'Operational staff — bookings, tickets, support chat/calls, promotions'),
  ('00000000-0000-4000-a000-000000000003', 'user',     'Standard customer');

-- ── Permissions ─────────────────────────────────────────────────────────
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('00000000-0000-4000-b000-000000000001', 'users:read',                 'Read user list and profiles'),
  ('00000000-0000-4000-b000-000000000002', 'users:write',                'Create/update users'),
  ('00000000-0000-4000-b000-000000000003', 'users:delete',               'Delete users'),
  ('00000000-0000-4000-b000-000000000004', 'posts:read',                 'Read posts'),
  ('00000000-0000-4000-b000-000000000005', 'posts:write',                'Create/update posts'),
  ('00000000-0000-4000-b000-000000000006', 'posts:delete',               'Delete posts'),
  ('00000000-0000-4000-b000-000000000007', 'admin:brands:read',          'Admin: list/view brands'),
  ('00000000-0000-4000-b000-000000000008', 'admin:brands:write',         'Admin: create/update/delete brands'),
  ('00000000-0000-4000-b000-000000000009', 'admin:routes:read',          'Admin: list/view routes'),
  ('00000000-0000-4000-b000-00000000000a', 'admin:routes:write',         'Admin: create/update/delete routes'),
  ('00000000-0000-4000-b000-00000000000b', 'admin:schedules:read',       'Admin: list/view schedules'),
  ('00000000-0000-4000-b000-00000000000c', 'admin:schedules:write',      'Admin: create/update/delete schedules'),
  ('00000000-0000-4000-b000-00000000000d', 'admin:addresses:read',       'Admin: list brand addresses'),
  ('00000000-0000-4000-b000-00000000000e', 'admin:addresses:write',      'Admin: create/update/delete brand addresses'),
  ('00000000-0000-4000-b000-00000000000f', 'admin:cron-jobs:read',       'Admin: view scheduled jobs and run history'),
  ('00000000-0000-4000-b000-00000000010', 'admin:cron-jobs:write',       'Admin: trigger/reschedule/enable+disable jobs'),
  ('00000000-0000-4000-b000-00000000011', 'admin:pickup_points:read',   'Admin: list/view pickup points'),
  ('00000000-0000-4000-b000-00000000012', 'admin:pickup_points:write',  'Admin: create/update/delete pickup points'),
  ('00000000-0000-4000-b000-00000000013', 'admin:bus_layouts:read',     'Admin: list bus layouts'),
  ('00000000-0000-4000-b000-00000000014', 'admin:bus_layouts:write',    'Admin: create/update/delete bus layouts'),
  ('00000000-0000-4000-b000-00000000015', 'admin:vehicle_types:read',   'Admin: list vehicle types'),
  ('00000000-0000-4000-b000-00000000016', 'admin:vehicle_types:write',  'Admin: create/update/delete vehicle types'),
  ('00000000-0000-4000-b000-00000000017', 'admin:reviews:moderate',     'Admin: moderate reviews'),
  ('00000000-0000-4000-b000-00000000018', 'admin:bookings:read',        'Admin: list/view bookings'),
  ('00000000-0000-4000-b000-00000000019', 'admin:bookings:write',       'Admin: update booking status'),
  ('00000000-0000-4000-b000-0000000001a', 'admin:payments:read',        'Admin: list/view payments'),
  ('00000000-0000-4000-b000-0000000001b', 'admin:payments:write',       'Admin: update payment status, mark COD collected'),
  ('00000000-0000-4000-b000-0000000001c', 'admin:stats:read',           'Admin: view booking statistics'),
  ('00000000-0000-4000-b000-0000000001d', 'admin:export',               'Admin: export bookings as CSV'),
  ('00000000-0000-4000-b000-0000000001e', 'admin:nullclaw:read',        'Admin: view NullClaw AI exchange audit log'),
  ('00000000-0000-4000-b000-0000000001f', 'admin:users:manage-roles',   'Admin: grant/revoke roles');

-- ── role_permissions: admin = all; employee = all except ADMIN_ONLY; user = USER_PERMS ──
-- admin grants
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-a000-000000000001', id FROM permissions;
-- employee grants
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-a000-000000000002', id FROM permissions
WHERE name NOT IN ('users:write','users:delete','admin:users:manage-roles','admin:cron-jobs:read','admin:cron-jobs:write','admin:nullclaw:read','admin:export');
-- user grants
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-a000-000000000003', id FROM permissions
WHERE name IN ('posts:read','posts:write','users:read');

-- ── Vehicle types ───────────────────────────────────────────────────────
INSERT OR IGNORE INTO vehicle_type (id, code, label, total_seats, sort_order, status) VALUES
  ('00000000-0000-4000-c000-000000000001', 'limousine',    'Limousine',         11, 1, 'active'),
  ('00000000-0000-4000-c000-000000000002', 'minivan',      'Minivan',           16, 2, 'active'),
  ('00000000-0000-4000-c000-000000000003', 'standard',     'Ghế ngồi',          29, 3, 'active'),
  ('00000000-0000-4000-c000-000000000004', 'semi_sleeper', 'Giường nằm đơn',    34, 4, 'active'),
  ('00000000-0000-4000-c000-000000000005', 'sleeper',      'Giường nằm',        40, 5, 'active');

-- ── Scheduled jobs catalog (container-driven cron) ──────────────────────
-- Frequent correctness jobs (holds.sweep ~60s, trips.warm ~6h) run on the
-- container's fixed cadences; these rows cover daily/periodic maintenance.
INSERT OR IGNORE INTO scheduled_job (id, job_type, enabled, interval_days, at_hour, at_minute, next_run_at) VALUES
  ('00000000-0000-4000-d000-000000000001', 'coupons.expire',   1, 1,  0, 10, NULL),
  ('00000000-0000-4000-d000-000000000002', 'fts.reindex',      1, 1,  3,  0, NULL),
  ('00000000-0000-4000-d000-000000000003', 'jobs.retention',   1, 1,  4,  0, NULL),
  ('00000000-0000-4000-d000-000000000004', 'trips.prune',      1, 1,  2, 30, NULL);
