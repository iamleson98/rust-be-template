-- 0007: the Rust catalogue gained `admin:campaigns:manage` with the discount
-- campaigns (m20261011_000020) — held by the admin role only. The D1 seed had
-- stopped at the original 31 permissions.
INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('00000000-0000-4000-b000-000000000020', 'admin:campaigns:manage',
   'Admin: create/edit discount campaigns, review and settle coupon payouts');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-a000-000000000001', id FROM permissions WHERE name = 'admin:campaigns:manage';
