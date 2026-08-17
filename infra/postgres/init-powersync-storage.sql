-- Runs once, only against a FRESH postgres data volume (docker-entrypoint-initdb.d only
-- executes when the data directory is empty). An existing dev volume needs this run by hand
-- once: `docker exec -it werf-postgres psql -U werf -d werf -f /docker-entrypoint-initdb.d/init-powersync-storage.sql`
--
-- A separate DATABASE, not just a schema, for the PowerSync service's own bucket storage —
-- Postgres 14+ supports sharing a server between the replication source and storage (confirmed
-- against docs.powersync.com/configuration/powersync-service/self-hosted-instances), but no
-- schema-selection key is documented for the storage URI, so a second database on the same
-- server is the unambiguous choice rather than guessing at undocumented syntax.
CREATE DATABASE werf_powersync_storage OWNER werf;
