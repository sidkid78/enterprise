-- Fixes a grant that made workspace_availability unusable by the only role
-- that calls it.
--
-- workspace_availability is SECURITY INVOKER, so every function it calls runs
-- as the CALLER, not as the definer. Migration ...19 granted
-- private.downtime_breach_types() to authenticated but left
-- private.queue_stall_threshold_seconds() granted to service_role alone, so the
-- dashboard failed outright with "permission denied for function
-- queue_stall_threshold_seconds".
--
-- It was not caught because the RPC was tested as `postgres`, which is a
-- superuser and bypasses every grant in the file. INVOKER functions have to be
-- exercised as the role that will actually run them — `set role authenticated`
-- — or the test proves only that the SQL is valid.

grant execute on function private.queue_stall_threshold_seconds() to authenticated;
