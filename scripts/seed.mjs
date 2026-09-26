#!/usr/bin/env node
// Loads supabase/seed.sql: Copper Kettle Hospitality, a fictional Wellington
// group with two sites, ten active staff, a published roster week ahead, a
// worked week of timesheets behind, and a leave book. Every row has a derived
// id and inserts with ON CONFLICT DO NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from settings)     as settings,
           (select count(*) from locations)    as locations,
           (select count(*) from areas)        as areas,
           (select count(*) from staff)        as staff,
           (select count(*) from availability) as availability,
           (select count(*) from leave)        as leave,
           (select count(*) from shifts)       as shifts,
           (select count(*) from timesheets)   as timesheets,
           (select count(*) from file_notes)   as file_notes
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const db = await getDb();
  try {
    const counts = await seed(db);
    console.log('seeded:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  } finally {
    await db.close();
  }
}
