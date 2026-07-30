#!/usr/bin/env node
/**
 * Refreshes content/fallback.json from the live database.
 *
 *   node tools/snapshot.mjs
 *
 * The fallback file is what visitors see if Supabase is unreachable (for
 * example if a free-tier project has been paused). It only needs to be
 * refreshed after meaningful content edits — commit the result.
 *
 * Reads only, and only with the publishable key, so no secrets are involved.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'content/fallback.json');

/* Single source of truth for the project URL and key: js/config.js. */
const config = readFileSync(join(ROOT, 'js/config.js'), 'utf8');
const pick = key => {
  const match = config.match(new RegExp(`${key}:\\s*'([^']+)'`));
  if (!match) throw new Error(`Could not read ${key} from js/config.js`);
  return match[1];
};
const BASE = pick('SUPABASE_URL');
const KEY = pick('SUPABASE_KEY');

async function get(path) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const [sections, staff] = await Promise.all([
  get(
    'sections?select=id,kind,eyebrow,title,nav_label,description,is_builtin,' +
      'blocks(label,body_html,position)&order=position.asc'
  ),
  get('staff?select=name,role,email,photo_url&order=position.asc'),
]);

if (!sections.length) {
  throw new Error('Refusing to write an empty snapshot — the query returned no sections.');
}

for (const section of sections) {
  section.blocks = (section.blocks || []).sort(
    (a, b) => (a.position || 0) - (b.position || 0)
  );
}

writeFileSync(OUT, `${JSON.stringify({ sections, staff }, null, 2)}\n`);
console.log(
  `Wrote content/fallback.json — ${sections.length} sections, ` +
    `${sections.reduce((n, s) => n + s.blocks.length, 0)} blocks, ${staff.length} staff.`
);
