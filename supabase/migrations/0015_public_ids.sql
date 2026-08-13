-- 0015_public_ids.sql
--
-- Short public identifiers for the three URL-addressable entities:
-- candidates, clients, requisitions.
--
-- Why: user-facing URLs currently carry raw UUIDs. Internal `uuid` primary
-- keys stay (CLAUDE.md conventions) and the human REQ-/CAN- references stay
-- (AC-RQ-07 asserts their format); `public_id` is the new opaque, short,
-- URL-friendly handle (12-char base62, e.g. 'lSbqRVXPbTmC') that single-
-- resource endpoints accept interchangeably with the UUID.
--
-- The column is DB-owned: `default generate_public_id()` on insert, and the
-- API repositories never write it — the default is the single source of the
-- value, so it can never be skipped or spoofed.
--
-- Forward-only; never edited after commit.

-- ---------------------------------------------------------------------------
-- Generator: `length` random base62 characters from gen_random_bytes
-- (pgcrypto, enabled in 0001). Each output character maps one random byte
-- through `% 62`. That modulo is very slightly biased toward the first
-- 8 alphabet characters (256 = 4*62 + 8, so those appear with probability
-- 5/256 instead of 4/256) — irrelevant for uniqueness/entropy at 12 chars
-- (62^12 ≈ 3.2e21 keyspace, ~71 bits) and accepted for simplicity over
-- rejection sampling.
-- ---------------------------------------------------------------------------

-- search_path is pinned because pgcrypto lives in `public` on a plain
-- cluster but in `extensions` on hosted Supabase; missing schemas in a
-- search_path are ignored, so both resolve. Pinning also keeps the function
-- immune to caller search_path games (defence in depth).
create or replace function generate_public_id(length int default 12)
returns text
language plpgsql
volatile
set search_path to public, extensions
as $$
declare
  alphabet constant text :=
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  bytes  bytea;
  result text := '';
  i      int;
begin
  if length is null or length < 1 then
    raise exception 'generate_public_id: length must be >= 1, got %', length;
  end if;
  bytes := gen_random_bytes(length);
  for i in 0 .. length - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 62) + 1, 1);
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Columns: add nullable, backfill, then tighten. The backfill UPDATE runs
-- with trg_set_updated_at disabled — assigning a public_id is not a business
-- change and must not bump updated_at. (No other trigger can fire: the
-- candidates cv_search trigger is scoped to name/title columns and the
-- status/stage event triggers have WHEN clauses on those columns.)
-- ---------------------------------------------------------------------------

alter table candidates   add column if not exists public_id text;
alter table clients      add column if not exists public_id text;
alter table requisitions add column if not exists public_id text;

alter table candidates   disable trigger trg_set_updated_at;
alter table clients      disable trigger trg_set_updated_at;
alter table requisitions disable trigger trg_set_updated_at;

-- Backfill with a retry loop: generate, null out any duplicates (keeping one
-- row per colliding value), repeat until every row has a distinct public_id.
-- A collision is astronomically unlikely at 62^12, but the loop makes the
-- migration robust rather than probabilistic, and it terminates immediately
-- in the normal case.
do $$
declare
  tbl      text;
  has_null boolean;
begin
  foreach tbl in array array['candidates', 'clients', 'requisitions'] loop
    loop
      execute format(
        'update %I set public_id = generate_public_id() where public_id is null',
        tbl
      );
      execute format(
        'update %1$I t set public_id = null
         where t.public_id is not null
           and exists (
             select 1 from %1$I other
             where other.public_id = t.public_id and other.id < t.id
           )',
        tbl
      );
      execute format(
        'select exists (select 1 from %I where public_id is null)',
        tbl
      ) into has_null;
      exit when not has_null;
    end loop;
  end loop;
end;
$$;

alter table candidates   enable trigger trg_set_updated_at;
alter table clients      enable trigger trg_set_updated_at;
alter table requisitions enable trigger trg_set_updated_at;

-- Tighten: DB-owned default, not null, unique (the unique constraint's
-- backing index also serves the public_id lookups).
alter table candidates   alter column public_id set default generate_public_id();
alter table clients      alter column public_id set default generate_public_id();
alter table requisitions alter column public_id set default generate_public_id();

alter table candidates   alter column public_id set not null;
alter table clients      alter column public_id set not null;
alter table requisitions alter column public_id set not null;

alter table candidates   add constraint candidates_public_id_key   unique (public_id);
alter table clients      add constraint clients_public_id_key      unique (public_id);
alter table requisitions add constraint requisitions_public_id_key unique (public_id);
