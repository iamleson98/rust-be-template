-- 0008: customers could read the user directory. The Rust seed granted
-- `users:read` to the `user` role, so GET /api/users listed every account's
-- name, email and role to any signed-in customer. Staff keep it.
DELETE FROM role_permissions
WHERE role_id = '00000000-0000-4000-a000-000000000003'
  AND permission_id IN (SELECT id FROM permissions WHERE name = 'users:read');
