-- 0002: Cloudflare Realtime meeting id per chat channel.
ALTER TABLE chat_channel ADD COLUMN realtime_meeting_id TEXT;
