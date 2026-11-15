-- 0006: place search no longer lives in D1 (it ships as static shards built
-- weekly by CI), so the nightly FTS rebuild job has nothing to do.
DELETE FROM scheduled_job WHERE job_type = 'fts.reindex';
