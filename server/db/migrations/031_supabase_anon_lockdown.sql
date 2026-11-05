-- Production security remediation for the external Supabase target.
--
-- Verified read-only findings this migration acts on:
--   * The application backend connects as the table-owning `postgres` role,
--     which has BYPASSRLS, so Row-Level-Security policies do not constrain it.
--   * The app authenticates with its own session tables over direct SQL; it
--     does NOT use Supabase Auth or the PostgREST HTTP Data API.
--   * `anon` and `authenticated` — the only roles PostgREST switches to — held
--     full DML plus TRUNCATE, TRIGGER and REFERENCES on every public table.
--
-- The effective, non-breaking control is therefore to remove the Data-API
-- attack surface entirely rather than add auth.uid() policies the owner would
-- simply bypass. RLS stays enabled (deny-by-default) as defense in depth via
-- the existing `ensure_rls` event trigger. We deliberately do NOT run
-- FORCE ROW LEVEL SECURITY: forcing it would subject the owning `postgres`
-- role to the empty policy set and hide every row from the application itself.
--
-- The block is guarded on role existence so it is a no-op on vanilla
-- PostgreSQL (local dev, CI, disposable test schemas) where `anon` and
-- `authenticated` are not defined, and takes effect only on Supabase.
DO $$
DECLARE
  sch text := current_schema();
  r   text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA %I FROM %I', sch, r);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', sch, r);
    EXECUTE format('REVOKE USAGE, CREATE ON SCHEMA %I FROM %I', sch, r);
    -- Prevent tables/sequences created later by the owner role from being
    -- re-granted to the API roles by Supabase's default privileges.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON TABLES    FROM %I', sch, r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', sch, r);
    END IF;
  END LOOP;
END $$;
