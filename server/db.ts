import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    `postgres://${process.env.POSTGRES_USER ?? 'darts'}:${process.env.POSTGRES_PASSWORD ?? 'darts'}@${
      process.env.POSTGRES_HOST ?? 'localhost'
    }:${process.env.POSTGRES_PORT ?? 5432}/${process.env.POSTGRES_DB ?? 'darts'}`,
  max: 8,
});

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  pool.query<T>(sql, params);

export async function initDb() {
  await query(`
    create table if not exists users (
      id serial primary key,
      email text not null unique,
      password_hash text not null,
      display_name text not null,
      avatar text not null default '🎯',
      token_version integer not null default 0,
      settings jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists players (
      id serial primary key,
      owner_id integer references users(id) on delete set null,
      name text not null,
      avatar text not null default '🎯',
      is_guest boolean not null default false,
      created_at timestamptz not null default now()
    );
    create unique index if not exists players_owner_unique on players(owner_id) where owner_id is not null;

    create table if not exists matches (
      id serial primary key,
      created_by integer references users(id) on delete set null,
      name text not null default '',
      start_score integer not null,
      double_in boolean not null default false,
      double_out boolean not null default true,
      best_of integer not null default 3,
      mode text not null default 'manual',
      status text not null default 'active',
      winner_player_id integer,
      created_at timestamptz not null default now(),
      finished_at timestamptz,
      share_code text
    );
    alter table matches add column if not exists share_code text;
    create unique index if not exists matches_share_code on matches(share_code) where share_code is not null;

    create table if not exists match_players (
      id serial primary key,
      match_id integer not null references matches(id) on delete cascade,
      player_id integer not null references players(id) on delete cascade,
      position integer not null
    );
    create index if not exists match_players_match on match_players(match_id);

    create table if not exists visits (
      id serial primary key,
      match_id integer not null references matches(id) on delete cascade,
      match_player_id integer not null references match_players(id) on delete cascade,
      leg_index integer not null default 1,
      visit_index integer not null default 0,
      score integer not null default 0,
      remaining_after integer not null default 0,
      bust boolean not null default false,
      checkout boolean not null default false,
      ended_early boolean not null default false,
      source text not null default 'manual',
      created_at timestamptz not null default now()
    );
    create index if not exists visits_match on visits(match_id);

    create table if not exists darts (
      id serial primary key,
      visit_id integer not null references visits(id) on delete cascade,
      match_id integer not null references matches(id) on delete cascade,
      match_player_id integer not null references match_players(id) on delete cascade,
      ring text not null,
      number integer not null,
      points integer not null,
      source text not null default 'manual',
      confidence real,
      created_at timestamptz not null default now()
    );
    create index if not exists darts_match on darts(match_id);
    create index if not exists darts_visit on darts(visit_id);

    create table if not exists legs (
      id serial primary key,
      match_id integer not null references matches(id) on delete cascade,
      leg_index integer not null,
      winner_match_player_id integer not null references match_players(id) on delete cascade,
      darts_thrown integer not null default 0,
      finished_at timestamptz not null default now()
    );
    create index if not exists legs_match on legs(match_id);

    create table if not exists match_devices (
      id serial primary key,
      match_id integer not null references matches(id) on delete cascade,
      device_id text not null,
      role text not null default 'dashboard',
      name text not null default '',
      status jsonb not null default '{}'::jsonb,
      last_seen timestamptz not null default now(),
      unique (match_id, device_id)
    );
    alter table match_devices add column if not exists status jsonb not null default '{}'::jsonb;

    create table if not exists password_reset_tokens (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      token_hash text not null,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    );
    create index if not exists reset_tokens_hash on password_reset_tokens(token_hash);

    create table if not exists dart_candidates (
      id serial primary key,
      match_id integer not null references matches(id) on delete cascade,
      device_id text not null default '',
      ring text not null,
      number integer not null,
      confidence real not null default 0,
      status text not null default 'pending',
      created_at timestamptz not null default now()
    );
    create index if not exists candidates_match on dart_candidates(match_id, status);

    create table if not exists ai_runs (
      id serial primary key,
      user_id integer,
      kind text not null,
      ok boolean not null,
      ms integer not null default 0,
      error text,
      created_at timestamptz not null default now()
    );
  `);

  // Bestehende Matches ohne Zuschauer-Code nachrüsten
  await query(
    `update matches set share_code = upper(substr(md5(random()::text || id::text), 1, 6))
      where share_code is null`,
  );
}

export async function logAiRun(userId: number | null, kind: string, ok: boolean, ms: number, error?: string) {
  await query('insert into ai_runs (user_id, kind, ok, ms, error) values ($1,$2,$3,$4,$5)', [
    userId,
    kind,
    ok,
    ms,
    error ? error.slice(0, 500) : null,
  ]);
}
