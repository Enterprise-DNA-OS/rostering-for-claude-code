-- rostering-for-claude-code: core schema.
-- A shift business's operating record the way Deputy sells it: the sites and
-- their areas, the staff with their pay rates and their paper (right-to-work
-- expiry, duty manager certificate), who can work when, the roster from draft
-- to published, the timesheets from clock-in to approval, and the leave book.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
-- Money is in cents, NZD: the hourly rate is here to cost a roster before it
-- is published, not to run payroll. Payroll stays in the payroll system;
-- `export` hands it the approved hours.
--
-- Deliberately NOT here: pay runs, PAYE, leave balance accruals, award pay
-- interpretation. Those belong to payroll and to the accountant. What IS here
-- is the record payroll is built from: who was rostered, who actually worked,
-- what breaks they took, and what leave was approved.
--
-- The sharp edges are deliberate:
--   * nobody is rostered past the expiry of their recorded right to work:
--     employing a person not entitled to work is an offence (Immigration Act
--     2009 s 350), and there is no force flag
--   * nobody is rostered over their own approved leave (Holidays Act 2003)
--   * nobody holds two overlapping shifts, and nobody starts a new shift
--     inside the rest window after the last one (Hospitality Industry
--     (General) Award 2020 cl 15 in AU; fatigue duty under the Health and
--     Safety at Work Act 2015 in NZ)
--   * a licensed site does not trade a day without a certified duty manager
--     on the roster (Sale and Supply of Alcohol Act 2012 ss 212-214): the
--     compliance sweep names every uncovered day
--   * a timesheet is not approved while it is still open, and a short meal
--     break is loud (Employment Relations Act 2000 Part 6D)
--   * no deleting records: shifts cancel with a reason, staff become former,
--     timesheets and the leave book stay (Employment Relations Act 2000
--     s 130: the wages and time record is kept six years)

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- The meal breaks the Employment Relations Act 2000 Part 6D (s 69ZD) requires
-- for a work period, in minutes. Over 4 hours and up to 8 earns one 30-minute
-- meal break; each further period restarts the clock, so a 13-hour double
-- earns two. The 10-minute rest breaks the Act also requires are paid and are
-- not deducted time, so they are not checked against the unpaid break field.
create or replace function required_meal_minutes(span_hours numeric) returns int
language plpgsql immutable as $$
declare
  meals int := 0;
  h numeric := coalesce(span_hours, 0);
begin
  while h > 4 loop
    meals := meals + 1;
    h := h - 8;
  end loop;
  return meals * 30;
end
$$;

-- Settings ------------------------------------------------------------------------
-- The handful of numbers the rules and views read: the rest window between
-- shifts, the weekly hours ceiling, the roster notice window, and how long a
-- timesheet or leave request may sit before it is loud. Change them with
-- `settings set`.

create table if not exists settings (
  key         text primary key,
  value       text not null,
  note        text,
  updated_at  timestamptz not null default now()
);

-- Locations ------------------------------------------------------------------------
-- The sites. `licensed` marks a site that sells alcohol: the duty manager
-- check reads it (Sale and Supply of Alcohol Act 2012).

create table if not exists locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text,
  licensed      boolean not null default false,
  status        text not null default 'active',   -- active | closed
  external_ref  text unique,                      -- the Deputy location id, for import
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists locations_name_lower_idx on locations (lower(name));

-- Areas ---------------------------------------------------------------------------
-- Sections inside a site: Kitchen, Front of House, Bar, Counter. A shift
-- belongs to one, so the roster reads the way the building is actually run.

create table if not exists areas (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references locations(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now()
);
create unique index if not exists areas_loc_name_idx on areas (location_id, lower(name));

-- Staff ---------------------------------------------------------------------------
-- Everyone on the roster. The right-to-work expiry lives here because
-- rostering a person past their visa is the breach that closes a kitchen
-- (Immigration Act 2009 s 350): the assignment gate reads it. The duty
-- manager certificate lives here because a licensed site cannot trade
-- without one on shift (Sale and Supply of Alcohol Act 2012). The hourly
-- rate is for costing rosters, never for paying anyone.

create table if not exists staff (
  id                             uuid primary key default gen_random_uuid(),
  name                           text not null,
  role                           text not null default 'front_of_house',  -- chef | front_of_house | barista | bartender | kitchen_hand | supervisor | manager
  employment                     text not null default 'casual',          -- permanent | part_time | casual
  hourly_rate_cents              bigint,
  phone                          text,
  email                          text,
  visa_expires_on                date,          -- null = no expiry on record (citizen or resident); the rostering gate reads this
  duty_manager_cert_no           text,          -- General Manager's Certificate number, licensed sites
  duty_manager_cert_expires_on   date,          -- the duty cover check reads this
  status                         text not null default 'active',          -- active | former
  note                           text,
  external_ref                   text unique,   -- the Deputy employee id, for import
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);
create unique index if not exists staff_name_lower_idx on staff (lower(name));

-- Availability ---------------------------------------------------------------------------
-- The standing weekly windows each person can work. The roster builder reads
-- this before it drafts; the assignment warning reads it after.

create table if not exists availability (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff(id) on delete cascade,
  weekday      int not null,                     -- 0 = Sunday ... 6 = Saturday
  starts_at    time not null,
  ends_at      time not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists availability_staff_idx on availability (staff_id);

-- Leave ---------------------------------------------------------------------------
-- Requests and approvals. Balances and pay stay in payroll; what lives here
-- is the record the roster must respect (Holidays Act 2003) and the leave
-- book the Act requires be kept (s 81).

create table if not exists leave (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,                     -- LV-101
  staff_id      uuid not null references staff(id) on delete cascade,
  type          text not null default 'annual',  -- annual | sick | bereavement | alternative | unpaid
  starts_on     date not null,
  ends_on       date not null,
  status        text not null default 'requested',  -- requested | approved | declined
  requested_on  date not null default current_date,
  decided_on    date,
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists leave_staff_idx on leave (staff_id);

-- Shifts ---------------------------------------------------------------------------
-- The roster. A shift with no staff is an open shift looking for cover. A
-- shift whose end time is at or before its start time finishes the next day:
-- hospitality closes after midnight. Draft shifts are the working copy;
-- `publish` turns a week real. Cancelled shifts keep their reason.

create table if not exists shifts (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,                     -- SH-1001
  location_id   uuid not null references locations(id),
  area_id       uuid references areas(id),
  staff_id      uuid references staff(id),       -- null = open shift
  on_date       date not null,
  starts_at     time not null,
  ends_at       time not null,
  break_minutes int not null default 0,          -- planned unpaid meal break
  role_needed   text,                            -- what an open shift is looking for
  status        text not null default 'draft',   -- draft | published | cancelled
  cancel_reason text,
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists shifts_date_idx on shifts (on_date);
create index if not exists shifts_staff_idx on shifts (staff_id);
create index if not exists shifts_location_idx on shifts (location_id);

-- Timesheets ---------------------------------------------------------------------------
-- What actually happened, from clock-in to approval. This is the wages and
-- time record the Employment Relations Act 2000 s 130 requires, so nothing
-- here is deleted and approval never invents hours: it confirms them.
-- clock_out closes the record and submits it; `approve` is the payroll gate.

create table if not exists timesheets (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,                    -- TS-2001
  staff_id       uuid not null references staff(id),
  shift_id       uuid references shifts(id),     -- null = unrostered work, still real
  location_id    uuid references locations(id),
  on_date        date not null,
  clock_in_at    timestamptz not null,
  clock_out_at   timestamptz,
  break_minutes  int not null default 0,         -- unpaid meal break actually taken
  status         text not null default 'open',   -- open | submitted | approved
  approved_on    date,
  note           text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists timesheets_staff_idx on timesheets (staff_id);
create index if not exists timesheets_date_idx on timesheets (on_date);

-- File notes ---------------------------------------------------------------------------
-- The conversation record: the swap that was agreed, the warning about
-- lateness, the reason a request was declined. In a personal grievance, the
-- record.

create table if not exists file_notes (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid references staff(id) on delete cascade,
  noted_on     date not null default current_date,
  note         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists file_notes_staff_idx on file_notes (staff_id);

-- updated_at triggers ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['settings','locations','staff','leave','shifts','timesheets']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =====================================================================================
-- Views: the questions an owner or rostering manager asks every week, as SQL
-- anyone can read.
-- =====================================================================================

-- One settings read, typed.
create or replace view v_settings as
select
  coalesce((select value::numeric from settings where key = 'rest_between_shifts_hours'), 10) as rest_between_shifts_hours,
  coalesce((select value::numeric from settings where key = 'max_week_hours'), 50) as max_week_hours,
  coalesce((select value::int from settings where key = 'roster_notice_days'), 7) as roster_notice_days,
  coalesce((select value::int from settings where key = 'timesheet_stale_days'), 3) as timesheet_stale_days,
  coalesce((select value::int from settings where key = 'leave_stale_days'), 5) as leave_stale_days;

-- Staff with the paper state loud and the load visible.
create or replace view v_staff as
select
  s.id as staff_id,
  s.name,
  s.role,
  s.employment,
  s.hourly_rate_cents,
  s.phone,
  s.email,
  s.visa_expires_on,
  case
    when s.visa_expires_on is null then ''
    when s.visa_expires_on < current_date then 'EXPIRED'
    when s.visa_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as work_rights,
  s.duty_manager_cert_no,
  s.duty_manager_cert_expires_on,
  case
    when s.duty_manager_cert_no is null then ''
    when s.duty_manager_cert_expires_on is null then 'NO EXPIRY'
    when s.duty_manager_cert_expires_on < current_date then 'EXPIRED'
    when s.duty_manager_cert_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as duty_cert,
  s.status,
  (select count(*) from shifts sh where sh.staff_id = s.id and sh.status = 'published' and sh.on_date >= current_date and sh.on_date < current_date + 7) as shifts_next_7,
  (select count(*) from timesheets t where t.staff_id = s.id and t.status = 'open') as open_timesheets,
  (select count(*) from timesheets t where t.staff_id = s.id and t.status = 'submitted') as awaiting_approval,
  (select count(*) from leave lv where lv.staff_id = s.id and lv.status = 'requested') as leave_pending
from staff s;

-- The roster with everything worked out: real timestamps (overnight shifts
-- end the next day), paid minutes, what the shift costs at the person's rate,
-- and the state on one line.
create or replace view v_shifts as
select
  sh.id as shift_id,
  sh.ref,
  sh.on_date,
  l.name as site,
  l.licensed,
  l.id as location_id,
  a.name as area,
  st.name as staff,
  st.id as staff_id,
  st.role as staff_role,
  sh.role_needed,
  sh.starts_at,
  sh.ends_at,
  sh.break_minutes,
  t.s_ts as starts_ts,
  t.e_ts as ends_ts,
  (round(extract(epoch from (t.e_ts - t.s_ts)) / 60)::int - sh.break_minutes) as paid_minutes,
  case when st.hourly_rate_cents is not null then
    round((round(extract(epoch from (t.e_ts - t.s_ts)) / 60)::int - sh.break_minutes) * st.hourly_rate_cents / 60.0)::bigint
  end as cost_cents,
  sh.status,
  sh.cancel_reason,
  sh.note,
  case
    when sh.status = 'cancelled' then 'cancelled'
    when sh.status = 'published' and st.visa_expires_on is not null and st.visa_expires_on < sh.on_date then 'NO WORK RIGHTS'
    when sh.status = 'draft' and sh.on_date <= current_date + (select roster_notice_days from v_settings) then 'DRAFT LATE'
    when sh.status = 'draft' then 'draft'
    when sh.staff_id is null and sh.on_date < current_date then 'unfilled past'
    when sh.staff_id is null then 'OPEN'
    when t.e_ts < now() then 'worked'
    else 'published'
  end as state
from shifts sh
join locations l on l.id = sh.location_id
left join areas a on a.id = sh.area_id
left join staff st on st.id = sh.staff_id
cross join lateral (
  select (sh.on_date + sh.starts_at)::timestamp as s_ts,
         (sh.on_date + sh.ends_at + case when sh.ends_at <= sh.starts_at then interval '1 day' else interval '0 hours' end)::timestamp as e_ts
) t;

-- Timesheets with the hours worked out and the story on one line. A record
-- still open from a past day is loud; so is a meal break shorter than the
-- Employment Relations Act requires for the span worked.
create or replace view v_timesheets as
select
  ts.id as timesheet_id,
  ts.ref,
  st.name as staff,
  st.id as staff_id,
  l.name as site,
  ts.on_date,
  ts.clock_in_at,
  ts.clock_out_at,
  ts.break_minutes,
  ts.status,
  ts.approved_on,
  ts.note,
  vs.ref as shift_ref,
  ts.shift_id,
  case when ts.clock_out_at is not null then
    round(extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 60)::int - ts.break_minutes
  end as worked_minutes,
  case when ts.clock_out_at is not null then
    required_meal_minutes(extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 3600.0)
  end as required_break_minutes,
  case when ts.clock_out_at is not null
    then ts.break_minutes < required_meal_minutes(extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 3600.0)
    else false
  end as break_short,
  case when ts.clock_out_at is not null and vs.paid_minutes is not null then
    (round(extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 60)::int - ts.break_minutes) - vs.paid_minutes
  end as variance_minutes,
  case when ts.clock_out_at is not null and st.hourly_rate_cents is not null then
    round((round(extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 60)::int - ts.break_minutes) * st.hourly_rate_cents / 60.0)::bigint
  end as cost_cents,
  (current_date - ts.on_date) as days_old,
  case
    when ts.status = 'open' and ts.on_date < current_date then 'NOT CLOCKED OUT'
    when ts.status = 'open' then 'open'
    when ts.status = 'submitted' and ts.clock_out_at is not null
         and ts.break_minutes < required_meal_minutes(extract(epoch from (ts.clock_out_at - ts.clock_in_at)) / 3600.0) then 'BREAK SHORT'
    when ts.status = 'submitted' and (current_date - ts.on_date) > (select timesheet_stale_days from v_settings) then 'AWAITING ' || (current_date - ts.on_date) || 'd'
    when ts.status = 'submitted' then 'submitted'
    else 'approved'
  end as state
from timesheets ts
join staff st on st.id = ts.staff_id
left join locations l on l.id = ts.location_id
left join v_shifts vs on vs.shift_id = ts.shift_id;

-- The leave book, with any published shifts sitting on top of approved leave
-- counted, because that clash is a rostering mistake with a legal edge.
create or replace view v_leave as
select
  lv.id as leave_id,
  lv.ref,
  st.name as staff,
  st.id as staff_id,
  lv.type,
  lv.starts_on,
  lv.ends_on,
  (lv.ends_on - lv.starts_on + 1) as days,
  lv.status,
  lv.requested_on,
  (current_date - lv.requested_on) as waiting_days,
  lv.decided_on,
  lv.note,
  (select count(*) from shifts sh where sh.staff_id = lv.staff_id and sh.status = 'published'
     and sh.on_date between lv.starts_on and lv.ends_on) as rostered_clashes,
  case
    when lv.status = 'requested' and (current_date - lv.requested_on) > (select leave_stale_days from v_settings) then 'PENDING ' || (current_date - lv.requested_on) || 'd'
    when lv.status = 'requested' then 'requested'
    when lv.status = 'approved' and exists (select 1 from shifts sh where sh.staff_id = lv.staff_id and sh.status = 'published'
      and sh.on_date between lv.starts_on and lv.ends_on and sh.on_date >= current_date) then 'ROSTERED OVER'
    else lv.status
  end as state
from leave lv
join staff st on st.id = lv.staff_id;

-- Open shifts still looking for cover.
create or replace view v_open_shifts as
select * from v_shifts
where status = 'published' and staff_id is null and on_date >= current_date;

-- Every future trading day at a licensed site, and whether a certified duty
-- manager is on the roster that day (Sale and Supply of Alcohol Act 2012
-- ss 212-214). `covered = false` is a day the site cannot lawfully sell.
create or replace view v_duty_days as
select
  l.id as location_id,
  l.name as site,
  sh.on_date,
  count(*) as shifts,
  count(*) filter (where st.duty_manager_cert_expires_on is not null and st.duty_manager_cert_expires_on >= sh.on_date) as certified_on,
  bool_or(st.duty_manager_cert_expires_on is not null and st.duty_manager_cert_expires_on >= sh.on_date) as covered
from shifts sh
join locations l on l.id = sh.location_id
left join staff st on st.id = sh.staff_id
where l.licensed and sh.status = 'published' and sh.on_date >= current_date
group by l.id, l.name, sh.on_date;

-- Consecutive shifts for the same person closer together than the rest
-- window. Closing at eleven and opening at seven is how kitchens burn people.
create or replace view v_rest_clashes as
select
  s1.staff_id,
  s1.staff,
  s1.ref as first_ref,
  s1.on_date as first_date,
  s1.ends_ts as first_ends,
  s2.ref as then_ref,
  s2.on_date as then_date,
  s2.starts_ts as then_starts,
  round(extract(epoch from (s2.starts_ts - s1.ends_ts)) / 3600.0, 1) as gap_hours
from v_shifts s1
join v_shifts s2 on s2.staff_id = s1.staff_id and s2.shift_id <> s1.shift_id
  and s2.starts_ts >= s1.ends_ts
  and s2.starts_ts < s1.ends_ts + make_interval(hours => (select rest_between_shifts_hours from v_settings)::int)
where s1.staff_id is not null
  and s1.status in ('published', 'draft') and s2.status in ('published', 'draft')
  and s1.on_date >= current_date - 28;

-- Rostered and worked hours by person for any week: the CLI filters this by
-- date range. Week maths lives in one place.
create or replace view v_hours as
select
  st.id as staff_id,
  st.name,
  st.role,
  st.hourly_rate_cents,
  sh.on_date,
  sh.status,
  vs.paid_minutes,
  vs.cost_cents
from staff st
join shifts sh on sh.staff_id = st.id and sh.status in ('published', 'draft')
join v_shifts vs on vs.shift_id = sh.id;

-- Everything that wants a decision, one union, worst first. A person on the
-- published roster past their right-to-work expiry outranks everything: that
-- one is an offence, not an inconvenience.
create or replace view v_attention as
-- Published shifts held past a right-to-work expiry.
select 1 as rank, 'work_rights' as reason, st.name as label, '' as who,
       count(*) || ' published shift(s)' as place,
       (current_date - st.visa_expires_on)::int as days,
       'right to work on record expired ' || to_char(st.visa_expires_on, 'YYYY-MM-DD') ||
       ' and they still hold published shifts: employing a person not entitled to work is an offence (Immigration Act 2009 s 350). Confirm their new visa and record it (`staff visa`), or take them off the roster today' as detail
from shifts sh
join staff st on st.id = sh.staff_id
where sh.status = 'published' and sh.on_date >= current_date
  and st.visa_expires_on is not null and st.visa_expires_on < sh.on_date
group by st.name, st.visa_expires_on
union all
-- A licensed site trading a day with no certified duty manager rostered.
select 2, 'duty_uncovered', d.site, '', to_char(d.on_date, 'Dy YYYY-MM-DD'),
       (d.on_date - current_date)::int,
       d.shifts || ' shift(s) published and nobody rostered holds a current General Manager''s Certificate: a licensed premises must have a certified manager on duty whenever alcohol is sold (Sale and Supply of Alcohol Act 2012 ss 212-214). Put a certified manager on that day or the bar does not trade'
from v_duty_days d
where not d.covered
union all
-- A timesheet still open from a past day.
select 3, 'not_clocked_out', t.ref, t.staff, t.site,
       t.days_old::int,
       t.staff || ' clocked in ' || to_char(t.clock_in_at, 'YYYY-MM-DD HH24:MI') || ' and never clocked out: the wages and time record must show the hours actually worked (Employment Relations Act 2000 s 130). Fix it now while somebody remembers (`clock out ' || t.staff || ' --at=`)'
from v_timesheets t
where t.state = 'NOT CLOCKED OUT'
union all
-- Approved leave with published shifts rostered on top.
select 4, 'leave_clash', lv.ref, lv.staff, lv.type || ' ' || to_char(lv.starts_on, 'YYYY-MM-DD') || ' to ' || to_char(lv.ends_on, 'YYYY-MM-DD'),
       (lv.starts_on - current_date)::int,
       lv.staff || ' has ' || lv.rostered_clashes || ' published shift(s) rostered over approved ' || lv.type || ' leave (Holidays Act 2003): reassign or open those shifts before the week starts'
from v_leave lv
where lv.state = 'ROSTERED OVER'
union all
-- Two shifts closer together than the rest window.
select 5, 'rest_breach', rc.staff, rc.first_ref || ' then ' || rc.then_ref, to_char(rc.then_date, 'Dy YYYY-MM-DD'),
       (rc.then_date - current_date)::int,
       rc.staff || ' finishes ' || to_char(rc.first_ends, 'HH24:MI') || ' and starts again ' || to_char(rc.then_starts, 'HH24:MI') || ' (' || rc.gap_hours || 'h gap, window is ' || (select rest_between_shifts_hours from v_settings) || 'h): a close-then-open is how people get hurt (Health and Safety at Work Act 2015; Hospitality Award cl 15 in AU). Move one of the shifts'
from v_rest_clashes rc
where rc.then_date >= current_date
union all
-- A submitted timesheet whose meal break is shorter than the Act requires.
select 6, 'break_short', t.ref, t.staff, to_char(t.on_date, 'Dy YYYY-MM-DD'),
       t.days_old::int,
       t.staff || ' worked ' || round(extract(epoch from (t.clock_out_at - t.clock_in_at)) / 3600.0, 1) || 'h with ' || t.break_minutes || ' break minutes recorded; the span requires ' || t.required_break_minutes || ' (Employment Relations Act 2000 Part 6D). If a break was taken, record it before approving; if it was not, fix the practice this week'
from v_timesheets t
where t.status = 'submitted' and t.break_short
union all
-- Published shifts inside the next week still looking for a person.
select 7, 'open_shift', o.ref, coalesce(o.role_needed, 'any role'), o.site || case when o.area is not null then ' / ' || o.area else '' end || ' ' || to_char(o.on_date, 'Dy YYYY-MM-DD'),
       (o.on_date - current_date)::int,
       'open shift ' || to_char(o.starts_ts, 'HH24:MI') || ' to ' || to_char(o.ends_ts, 'HH24:MI') || ' with nobody assigned, ' || (o.on_date - current_date) || ' day(s) out: offer it before it becomes a no-show (`/draft-open-shift-callout`)'
from v_open_shifts o
where o.on_date < current_date + 7
union all
-- The roster inside the notice window is still draft.
select 8, 'draft_late', 'roster', '', count(*) || ' draft shift(s)',
       min(sh.on_date - current_date)::int,
       count(*) || ' shift(s) inside the ' || (select roster_notice_days from v_settings) || '-day notice window are still draft, the earliest ' || min(sh.on_date - current_date) || ' day(s) away: staff plan their lives around the roster (ERA 2000 ss 67C-67G; Hospitality Award cl 15 wants 7 days in AU). Finish it and `publish`'
from shifts sh
where sh.status = 'draft' and sh.on_date >= current_date
  and sh.on_date <= current_date + (select roster_notice_days from v_settings)
having count(*) > 0
union all
-- Submitted timesheets sitting past the stale line.
select 9, 'timesheet_stale', t.staff, '', count(*) || ' timesheet(s)',
       max(t.days_old)::int,
       count(*) || ' submitted timesheet(s) awaiting approval, oldest ' || max(t.days_old) || ' days: approval is the payroll gate, and late approval is late pay. Run `/approve`'
from v_timesheets t
where t.status = 'submitted' and t.days_old > (select timesheet_stale_days from v_settings)
group by t.staff
union all
-- A leave request nobody has answered.
select 10, 'leave_pending', lv.ref, lv.staff, lv.type || ' ' || to_char(lv.starts_on, 'YYYY-MM-DD'),
       lv.waiting_days::int,
       lv.staff || ' asked for ' || lv.days || ' day(s) of ' || lv.type || ' leave ' || lv.waiting_days || ' days ago and nobody has answered: decide it (`leave approve ' || lv.ref || '` or `leave decline`)'
from v_leave lv
where lv.status = 'requested' and lv.waiting_days > (select leave_stale_days from v_settings)
union all
-- Somebody rostered over the weekly hours ceiling.
select 11, 'over_hours', h.name, '', 'week of ' || to_char(min(h.on_date), 'YYYY-MM-DD'),
       null::int,
       h.name || ' is rostered ' || round(sum(h.paid_minutes) / 60.0, 1) || 'h in one week, over the ' || (select max_week_hours from v_settings) || 'h ceiling (agreed maximum; ERA 2000 s 11B makes 40 the default unless agreed): spread the load before it becomes the norm'
from v_hours h
where h.on_date >= current_date - 7
group by h.name, date_trunc('week', h.on_date)
having sum(h.paid_minutes) / 60.0 > (select max_week_hours from v_settings)
union all
-- A right to work expiring inside 30 days.
select 12, 'visa_expiring', s.name, '', s.role,
       (s.visa_expires_on - current_date)::int,
       'right to work on record expires ' || to_char(s.visa_expires_on, 'YYYY-MM-DD') || ' (' || (s.visa_expires_on - current_date) || ' days): ask for the new visa now, the rostering gate will refuse shifts past that date (Immigration Act 2009 s 350)'
from v_staff s
where s.status = 'active' and s.work_rights = 'expiring'
union all
-- A duty manager certificate expiring inside 30 days.
select 13, 'cert_expiring', s.name, '', s.role,
       (s.duty_manager_cert_expires_on - current_date)::int,
       'General Manager''s Certificate expires ' || to_char(s.duty_manager_cert_expires_on, 'YYYY-MM-DD') || ' (' || (s.duty_manager_cert_expires_on - current_date) || ' days): renewal takes weeks at the District Licensing Committee, start it now (Sale and Supply of Alcohol Act 2012)'
from v_staff s
where s.status = 'active' and s.duty_cert = 'expiring';
