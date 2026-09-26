-- Demo data for rostering-for-claude-code.
-- Copper Kettle Hospitality, a fictional Wellington group with two sites: the
-- Copper Kettle Eatery (licensed, with a bar) and the Copper Kettle Espresso
-- (a cafe). Ten active staff, one former, a published week of roster ahead,
-- a worked week of timesheets behind, and a leave book.
--
-- Deliberately messy, so the attention list has something to say:
--   Lucas Meyer's recorded right to work expired 12 days ago and he still
--     holds two published bar shifts (keyed into the old system, which never
--     looked)
--   next Saturday the licensed Eatery trades with nobody rostered who holds a
--     current duty manager certificate
--   Emma Walsh clocked in yesterday morning and never clocked out
--   Grace Okafor has approved annual leave with a published shift rostered on
--     top of it
--   Ben Tuilagi closes the kitchen at 23:00 and opens it again at 07:00, an
--     8-hour gap against a 10-hour window
--   Sofia Marino's 9-hour timesheet has no meal break recorded
--   two published shifts are still looking for a person
--   two shifts inside the 7-day notice window are still draft
--   Emma's and Oliver's submitted timesheets have sat past the approval line
--   Jack Harmon's leave request has waited 8 days for an answer
--   Noah Griffin is rostered 52 hours next week against a 50-hour ceiling,
--     and his duty manager certificate expires in 21 days
--   Priya Nair's right to work expires in 25 days
--
-- Dates are relative to current_date; the roster week ahead is anchored to
-- next Monday so the demo is coherent whatever day you run it. Ids are
-- derived from names with seed_uuid, and every insert is ON CONFLICT DO
-- NOTHING, so running it twice changes nothing.
--
-- Staff, sites, rates and events are DEMO VALUES for a fictional business.
-- No real person or business is depicted.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Next Monday: the first day of the published roster week ahead.
create or replace function seed_next_monday() returns date language sql stable as $$
  select (date_trunc('week', current_date))::date + 7
$$;

-- Settings ------------------------------------------------------------------------

insert into settings (key, value, note) values
  ('rest_between_shifts_hours', '10', 'minimum gap between one shift ending and the next starting (HSWA 2015 fatigue duty; Hospitality Award cl 15 in AU)'),
  ('max_week_hours', '50', 'weekly rostered-hours ceiling (agreed maximum; ERA 2000 s 11B makes 40 the default unless agreed)'),
  ('roster_notice_days', '7', 'days ahead the roster should be published (Hospitality Award cl 15 in AU; ERA 2000 ss 67C-67G)'),
  ('timesheet_stale_days', '3', 'days a submitted timesheet may wait before approval is loud'),
  ('leave_stale_days', '5', 'days a leave request may wait before the silence is loud')
on conflict do nothing;

-- Locations ------------------------------------------------------------------------

insert into locations (id, name, address, licensed, status) values
  (seed_uuid('loc:eatery'),   'Copper Kettle Eatery',   '14 Customhouse Quay, Wellington', true,  'active'),
  (seed_uuid('loc:espresso'), 'Copper Kettle Espresso', '2 Woodward Street, Wellington',   false, 'active')
on conflict do nothing;

insert into areas (id, location_id, name) values
  (seed_uuid('area:eatery-kitchen'), seed_uuid('loc:eatery'),   'Kitchen'),
  (seed_uuid('area:eatery-foh'),     seed_uuid('loc:eatery'),   'Front of House'),
  (seed_uuid('area:eatery-bar'),     seed_uuid('loc:eatery'),   'Bar'),
  (seed_uuid('area:esp-counter'),    seed_uuid('loc:espresso'), 'Counter'),
  (seed_uuid('area:esp-kitchen'),    seed_uuid('loc:espresso'), 'Kitchen')
on conflict do nothing;

-- Staff ---------------------------------------------------------------------------
-- Lucas Meyer's right to work expired 12 days ago and he is still on the
-- published roster: that is the breach the attention list exists to shout
-- about. Priya Nair's expires in 25 days. Noah Griffin's duty manager
-- certificate expires in 21 days; Mia Fletcher's is current for most of a
-- year. Rates are for costing rosters, not for paying anyone.

insert into staff (id, name, role, employment, hourly_rate_cents, phone, email, visa_expires_on, duty_manager_cert_no, duty_manager_cert_expires_on, status) values
  (seed_uuid('staff:fletcher'), 'Mia Fletcher',  'manager',        'permanent', 3400, '021 555 0501', 'mia@copperkettle.example.nz',    null,               'DM-88214', current_date + 200, 'active'),
  (seed_uuid('staff:griffin'),  'Noah Griffin',  'supervisor',     'permanent', 2900, '021 555 0502', 'noah@copperkettle.example.nz',   null,               'DM-91733', current_date + 21,  'active'),
  (seed_uuid('staff:marino'),   'Sofia Marino',  'chef',           'permanent', 3300, '021 555 0503', 'sofia@copperkettle.example.nz',  null,               null,       null,               'active'),
  (seed_uuid('staff:tuilagi'),  'Ben Tuilagi',   'chef',           'permanent', 3000, '021 555 0504', 'ben@copperkettle.example.nz',    null,               null,       null,               'active'),
  (seed_uuid('staff:meyer'),    'Lucas Meyer',   'bartender',      'casual',    2600, '021 555 0505', 'lucas@copperkettle.example.nz',  current_date - 12,  null,       null,               'active'),
  (seed_uuid('staff:walsh'),    'Emma Walsh',    'barista',        'part_time', 2450, '021 555 0506', 'emma@copperkettle.example.nz',   null,               null,       null,               'active'),
  (seed_uuid('staff:harmon'),   'Jack Harmon',   'front_of_house', 'casual',    2380, '021 555 0507', 'jack@copperkettle.example.nz',   null,               null,       null,               'active'),
  (seed_uuid('staff:okafor'),   'Grace Okafor',  'front_of_house', 'part_time', 2500, '021 555 0508', 'grace@copperkettle.example.nz',  null,               null,       null,               'active'),
  (seed_uuid('staff:nair'),     'Priya Nair',    'front_of_house', 'part_time', 2500, '021 555 0509', 'priya@copperkettle.example.nz',  current_date + 25,  null,       null,               'active'),
  (seed_uuid('staff:chen'),     'Oliver Chen',   'kitchen_hand',   'casual',    2330, '021 555 0510', 'oliver@copperkettle.example.nz', null,               null,       null,               'active'),
  (seed_uuid('staff:price'),    'Dan Price',     'front_of_house', 'casual',    2380, '021 555 0511', 'dan.price@example.nz',           null,               null,       null,               'former')
on conflict do nothing;

-- Availability ---------------------------------------------------------------------------
-- Standing weekly windows. Jack is weekends only; Emma is early weekday
-- mornings; Grace and Oliver hold the middle of the week.

insert into availability (id, staff_id, weekday, starts_at, ends_at, note) values
  (seed_uuid('av:harmon-sat'), seed_uuid('staff:harmon'), 6, '09:00', '23:00', 'weekends only, studying'),
  (seed_uuid('av:harmon-sun'), seed_uuid('staff:harmon'), 0, '09:00', '18:00', null),
  (seed_uuid('av:walsh-mon'),  seed_uuid('staff:walsh'),  1, '06:30', '14:30', null),
  (seed_uuid('av:walsh-wed'),  seed_uuid('staff:walsh'),  3, '06:30', '14:30', null),
  (seed_uuid('av:walsh-fri'),  seed_uuid('staff:walsh'),  5, '06:30', '14:30', null),
  (seed_uuid('av:okafor-tue'), seed_uuid('staff:okafor'), 2, '08:00', '16:30', null),
  (seed_uuid('av:okafor-thu'), seed_uuid('staff:okafor'), 4, '08:00', '16:30', null),
  (seed_uuid('av:chen-mon'),   seed_uuid('staff:chen'),   1, '10:00', '20:00', null)
on conflict do nothing;

-- Leave ---------------------------------------------------------------------------
-- Grace's annual leave is approved for the first three days of next week, and
-- a published shift is still rostered on top of the Tuesday. Jack asked for
-- leave 8 days ago and nobody has answered. Sofia's sick leave is history on
-- the record.

insert into leave (id, ref, staff_id, type, starts_on, ends_on, status, requested_on, decided_on, note) values
  (seed_uuid('lv:101'), 'LV-101', seed_uuid('staff:okafor'), 'annual', seed_next_monday(),     seed_next_monday() + 2, 'approved',  current_date - 15, current_date - 12, 'Family in Auckland'),
  (seed_uuid('lv:102'), 'LV-102', seed_uuid('staff:harmon'), 'annual', current_date + 20,      current_date + 24,      'requested', current_date - 8,  null,              'Exam week'),
  (seed_uuid('lv:103'), 'LV-103', seed_uuid('staff:marino'), 'sick',   current_date - 10,      current_date - 9,       'approved',  current_date - 10, current_date - 10, null)
on conflict do nothing;

-- Shifts: the worked week behind ---------------------------------------------------
-- Published shifts whose timesheets exist below.

insert into shifts (id, ref, location_id, area_id, staff_id, on_date, starts_at, ends_at, break_minutes, role_needed, status, cancel_reason, note) values
  (seed_uuid('sh:1001'), 'SH-1001', seed_uuid('loc:espresso'), seed_uuid('area:esp-counter'),    seed_uuid('staff:walsh'),   current_date - 6, '07:00', '14:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1002'), 'SH-1002', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-kitchen'), seed_uuid('staff:marino'),  current_date - 6, '10:00', '19:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1003'), 'SH-1003', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-kitchen'), seed_uuid('staff:tuilagi'), current_date - 5, '10:00', '19:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1004'), 'SH-1004', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-kitchen'), seed_uuid('staff:chen'),    current_date - 5, '11:00', '19:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1005'), 'SH-1005', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),     seed_uuid('staff:nair'),    current_date - 2, '10:00', '16:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1006'), 'SH-1006', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-kitchen'), seed_uuid('staff:marino'),  current_date - 2, '09:30', '19:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1007'), 'SH-1007', seed_uuid('loc:espresso'), seed_uuid('area:esp-counter'),    seed_uuid('staff:walsh'),   current_date - 1, '07:00', '14:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1070'), 'SH-1070', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),     seed_uuid('staff:harmon'),  current_date - 3, '17:00', '23:00', 30, null, 'cancelled', 'Burst pipe closed the dining room', null)
on conflict do nothing;

-- Shifts: the published week ahead -------------------------------------------------
-- Anchored to next Monday. Mia covers the licensed Eatery Monday to Friday;
-- Saturday trades with no certified duty manager rostered. Noah is rostered
-- 52 hours. Ben closes Wednesday and opens Thursday. Lucas holds Friday and
-- Saturday bar shifts past his right-to-work expiry; Saturday's bar shift
-- runs past midnight. Two shifts are still open.

insert into shifts (id, ref, location_id, area_id, staff_id, on_date, starts_at, ends_at, break_minutes, role_needed, status, cancel_reason, note) values
  -- Mia, Monday to Friday, duty cover on the licensed site
  (seed_uuid('sh:1010'), 'SH-1010', seed_uuid('loc:eatery'), seed_uuid('area:eatery-foh'), seed_uuid('staff:fletcher'), seed_next_monday(),     '08:00', '16:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1011'), 'SH-1011', seed_uuid('loc:eatery'), seed_uuid('area:eatery-foh'), seed_uuid('staff:fletcher'), seed_next_monday() + 1, '08:00', '16:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1012'), 'SH-1012', seed_uuid('loc:eatery'), seed_uuid('area:eatery-foh'), seed_uuid('staff:fletcher'), seed_next_monday() + 2, '08:00', '16:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1013'), 'SH-1013', seed_uuid('loc:eatery'), seed_uuid('area:eatery-foh'), seed_uuid('staff:fletcher'), seed_next_monday() + 3, '08:00', '16:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1014'), 'SH-1014', seed_uuid('loc:eatery'), seed_uuid('area:eatery-foh'), seed_uuid('staff:fletcher'), seed_next_monday() + 4, '08:00', '16:00', 30, null, 'published', null, null),
  -- Noah: five 10-hour days plus a Saturday morning at the cafe, 52 hours all up
  (seed_uuid('sh:1020'), 'SH-1020', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),  seed_uuid('staff:griffin'), seed_next_monday(),     '09:00', '19:30', 30, null, 'published', null, null),
  (seed_uuid('sh:1021'), 'SH-1021', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),  seed_uuid('staff:griffin'), seed_next_monday() + 1, '09:00', '19:30', 30, null, 'published', null, null),
  (seed_uuid('sh:1022'), 'SH-1022', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),  seed_uuid('staff:griffin'), seed_next_monday() + 2, '09:00', '19:30', 30, null, 'published', null, null),
  (seed_uuid('sh:1023'), 'SH-1023', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),  seed_uuid('staff:griffin'), seed_next_monday() + 3, '09:00', '19:30', 30, null, 'published', null, null),
  (seed_uuid('sh:1024'), 'SH-1024', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),  seed_uuid('staff:griffin'), seed_next_monday() + 4, '09:00', '19:30', 30, null, 'published', null, null),
  (seed_uuid('sh:1025'), 'SH-1025', seed_uuid('loc:espresso'), seed_uuid('area:esp-counter'), seed_uuid('staff:griffin'), seed_next_monday() + 5, '09:00', '11:00', 0,  null, 'published', null, null),
  -- Grace: rostered over her approved leave on the Tuesday
  (seed_uuid('sh:1030'), 'SH-1030', seed_uuid('loc:eatery'), seed_uuid('area:eatery-foh'), seed_uuid('staff:okafor'), seed_next_monday() + 1, '10:00', '16:00', 30, null, 'published', null, null),
  -- Ben: closes Wednesday 23:00, opens Thursday 07:00, then works Saturday
  (seed_uuid('sh:1031'), 'SH-1031', seed_uuid('loc:eatery'), seed_uuid('area:eatery-kitchen'), seed_uuid('staff:tuilagi'), seed_next_monday() + 2, '15:00', '23:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1032'), 'SH-1032', seed_uuid('loc:eatery'), seed_uuid('area:eatery-kitchen'), seed_uuid('staff:tuilagi'), seed_next_monday() + 3, '07:00', '15:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1042'), 'SH-1042', seed_uuid('loc:eatery'), seed_uuid('area:eatery-kitchen'), seed_uuid('staff:tuilagi'), seed_next_monday() + 5, '15:00', '23:00', 30, null, 'published', null, null),
  -- Sofia: Monday and Tuesday kitchen
  (seed_uuid('sh:1033'), 'SH-1033', seed_uuid('loc:eatery'), seed_uuid('area:eatery-kitchen'), seed_uuid('staff:marino'), seed_next_monday(),     '10:00', '19:00', 30, null, 'published', null, null),
  (seed_uuid('sh:1034'), 'SH-1034', seed_uuid('loc:eatery'), seed_uuid('area:eatery-kitchen'), seed_uuid('staff:marino'), seed_next_monday() + 1, '10:00', '19:00', 30, null, 'published', null, null),
  -- Lucas: Friday and Saturday bar, both past his recorded right to work; Saturday runs past midnight
  (seed_uuid('sh:1040'), 'SH-1040', seed_uuid('loc:eatery'), seed_uuid('area:eatery-bar'), seed_uuid('staff:meyer'), seed_next_monday() + 4, '17:00', '23:30', 30, null, 'published', null, null),
  (seed_uuid('sh:1041'), 'SH-1041', seed_uuid('loc:eatery'), seed_uuid('area:eatery-bar'), seed_uuid('staff:meyer'), seed_next_monday() + 5, '17:00', '00:30', 30, null, 'published', null, null),
  -- Saturday front of house: Priya. Nobody on Saturday holds a duty manager certificate.
  (seed_uuid('sh:1043'), 'SH-1043', seed_uuid('loc:eatery'), seed_uuid('area:eatery-foh'), seed_uuid('staff:nair'), seed_next_monday() + 5, '17:00', '23:00', 30, null, 'published', null, null),
  -- Open shifts still looking for a person
  (seed_uuid('sh:1050'), 'SH-1050', seed_uuid('loc:espresso'), seed_uuid('area:esp-counter'),    null, seed_next_monday() + 3, '07:00', '14:00', 30, 'barista',      'published', null, null),
  (seed_uuid('sh:1051'), 'SH-1051', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-kitchen'), null, seed_next_monday() + 5, '11:00', '19:00', 30, 'kitchen_hand', 'published', null, null)
on conflict do nothing;

-- Shifts: drafts inside the notice window ------------------------------------------
-- Two shifts a few days out are still draft: staff cannot plan around a
-- roster that is not published.

insert into shifts (id, ref, location_id, area_id, staff_id, on_date, starts_at, ends_at, break_minutes, role_needed, status, cancel_reason, note) values
  (seed_uuid('sh:1060'), 'SH-1060', seed_uuid('loc:espresso'), seed_uuid('area:esp-counter'), seed_uuid('staff:walsh'), current_date + 2, '07:00', '14:00', 30, null, 'draft', null, null),
  (seed_uuid('sh:1061'), 'SH-1061', seed_uuid('loc:eatery'),   seed_uuid('area:eatery-foh'),  seed_uuid('staff:nair'),  current_date + 3, '10:00', '16:00', 30, null, 'draft', null, null)
on conflict do nothing;

-- Timesheets ---------------------------------------------------------------------------
-- The worked week. Emma's and Oliver's submitted sheets have sat past the
-- approval line. Sofia's 9-hour Tuesday has no meal break recorded. Priya
-- worked half an hour past her rostered finish. Emma clocked in yesterday
-- and never clocked out.

insert into timesheets (id, ref, staff_id, shift_id, location_id, on_date, clock_in_at, clock_out_at, break_minutes, status, approved_on, note) values
  (seed_uuid('ts:2001'), 'TS-2001', seed_uuid('staff:walsh'),   seed_uuid('sh:1001'), seed_uuid('loc:espresso'), current_date - 6, (current_date - 6) + time '07:02', (current_date - 6) + time '14:04', 30, 'submitted', null, null),
  (seed_uuid('ts:2002'), 'TS-2002', seed_uuid('staff:marino'),  seed_uuid('sh:1002'), seed_uuid('loc:eatery'),   current_date - 6, (current_date - 6) + time '10:04', (current_date - 6) + time '19:10', 30, 'approved',  current_date - 5, null),
  (seed_uuid('ts:2003'), 'TS-2003', seed_uuid('staff:tuilagi'), seed_uuid('sh:1003'), seed_uuid('loc:eatery'),   current_date - 5, (current_date - 5) + time '09:58', (current_date - 5) + time '19:02', 30, 'approved',  current_date - 4, null),
  (seed_uuid('ts:2004'), 'TS-2004', seed_uuid('staff:chen'),    seed_uuid('sh:1004'), seed_uuid('loc:eatery'),   current_date - 5, (current_date - 5) + time '11:00', (current_date - 5) + time '19:06', 30, 'submitted', null, null),
  (seed_uuid('ts:2005'), 'TS-2005', seed_uuid('staff:nair'),    seed_uuid('sh:1005'), seed_uuid('loc:eatery'),   current_date - 2, (current_date - 2) + time '10:00', (current_date - 2) + time '16:30', 30, 'submitted', null, 'Stayed for the function pack-down'),
  (seed_uuid('ts:2006'), 'TS-2006', seed_uuid('staff:marino'),  seed_uuid('sh:1006'), seed_uuid('loc:eatery'),   current_date - 2, (current_date - 2) + time '09:28', (current_date - 2) + time '18:42', 0,  'submitted', null, null),
  (seed_uuid('ts:2007'), 'TS-2007', seed_uuid('staff:walsh'),   seed_uuid('sh:1007'), seed_uuid('loc:espresso'), current_date - 1, (current_date - 1) + time '07:02', null,                              0,  'open',      null, null)
on conflict do nothing;

-- File notes ---------------------------------------------------------------------------

insert into file_notes (id, staff_id, noted_on, note) values
  (seed_uuid('fn:1'), seed_uuid('staff:meyer'),  current_date - 4, 'Asked Lucas for his new visa. He says the application is with Immigration NZ; nothing on record yet. No shifts past the expiry until the grant letter arrives.'),
  (seed_uuid('fn:2'), seed_uuid('staff:harmon'), current_date - 8, 'Jack asked for exam week off (LV-102). Waiting on the cover plan before answering.'),
  (seed_uuid('fn:3'), seed_uuid('staff:okafor'), current_date - 12,'Approved Grace''s Auckland trip. Reminder: her Tuesday shift still needs reassigning.')
on conflict do nothing;
