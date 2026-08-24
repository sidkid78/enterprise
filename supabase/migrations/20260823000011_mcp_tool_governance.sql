-- Pillar 1, tool half: makes the MCP registry executable rather than decorative.
--
-- The registry tables have existed since migration ...02 but nothing read them.
-- These columns are what turn a listed tool into one the runtime is willing to
-- call. RLS policies on both tables already exist and are unchanged.

-- Fail safe. A newly discovered tool requires a human before it can run, and an
-- operator opts it out deliberately. The opposite default would mean that
-- pointing the platform at a new MCP server silently grants agents everything
-- that server exposes.
alter table public.mcp_tools
    add column if not exists requires_approval boolean not null default true;

-- Informational, and the basis on which an operator decides the above. A tool
-- that only reads is the safe candidate for unattended execution; one that
-- writes, spends, or sends should keep its gate.
alter table public.mcp_tools
    add column if not exists is_read_only boolean not null default false;

-- Set when the tool list was last synced from the server, so a stale registry
-- is visible rather than assumed current.
alter table public.mcp_tools
    add column if not exists last_synced_at timestamptz;

comment on column public.mcp_tools.requires_approval is
    'When true the agent escalates to a HITL gate instead of invoking the tool.';

-- The Interactions API''s native remote-MCP tool type supports Streamable HTTP
-- only (not SSE), and does not support Gemini 3 models at all — which is this
-- platform''s entire cascade. So the runtime proxies MCP itself: it lists tools
-- from the registry as ordinary function declarations, and calls the server
-- over Streamable HTTP when the model asks for one.
--
-- That is also the better arrangement for this product. Native remote MCP would
-- have the model provider call the tool directly, which would put every
-- invocation outside our HITL gate, our guardrail events, and our audit ledger.
-- Proxying keeps each call mediated and recorded.
alter table public.mcp_servers
    alter column transport_type set default 'http_stream';

comment on column public.mcp_servers.transport_type is
    'Only http_stream is executable. sse and stdio may be registered but the runtime refuses to call them.';

create index if not exists idx_mcp_tools_workspace_enabled
    on public.mcp_tools(workspace_id, is_enabled);

-- ============================================================================
-- CREDENTIAL EXPOSURE
-- ============================================================================
-- mcp_servers.encrypted_auth_metadata holds the bearer tokens the runtime sends
-- to each MCP server. It was covered by a table-wide GRANT SELECT to
-- authenticated, so any workspace member — an analyst, not just an
-- administrator — could read every registered server's credentials straight off
-- the Data API. RLS cannot help here: it filters rows, not columns.
--
-- Column-level grants are the fix. Re-granting per column omits that one, which
-- makes it unreadable through PostgREST for every client role. The runtime
-- reads it with the service role, which is unaffected.
revoke all on public.mcp_servers from authenticated;
revoke all on public.mcp_tools from authenticated;

grant select (id, workspace_id, server_name, transport_type, endpoint_url,
              is_active, created_at, updated_at)
    on public.mcp_servers to authenticated;

-- Writes still need the credential column: an administrator registering a
-- server has to be able to supply its token. They may write it and never read
-- it back.
grant insert (id, workspace_id, server_name, transport_type, endpoint_url,
              encrypted_auth_metadata, is_active)
    on public.mcp_servers to authenticated;
grant update (server_name, transport_type, endpoint_url,
              encrypted_auth_metadata, is_active)
    on public.mcp_servers to authenticated;
grant delete on public.mcp_servers to authenticated;

-- The tool registry carries no secrets, but the client only ever needs to read
-- it and flip the two governance switches.
grant select on public.mcp_tools to authenticated;
grant update (is_enabled, requires_approval, is_read_only) on public.mcp_tools
    to authenticated;
