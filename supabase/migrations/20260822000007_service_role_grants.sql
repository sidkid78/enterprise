-- Grants for the agent runtime.
--
-- service_role bypasses RLS but still needs table-level GRANTs, and Supabase's
-- default privileges did not cover tables created by these migrations — the
-- runtime failed with "permission denied for table agent_graph_executions"
-- until this was added.
--
-- This is the trusted server-side role: it is never exposed to a browser (see
-- src/lib/supabase/service.ts), so full DML is appropriate.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Cover tables added by future migrations too, so this class of failure cannot
-- recur.
alter default privileges in schema public
    grant all privileges on tables to service_role;
alter default privileges in schema public
    grant all privileges on sequences to service_role;

-- The append-only guarantee on the ledger does NOT depend on grants: the
-- enforce_immutable_ledger trigger rejects UPDATE and DELETE for every role,
-- service_role included. Verified by test 11.

-- The runtime needs the private helpers when it evaluates membership.
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
