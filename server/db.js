const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const isLocal =
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },

  // Keep the pool small on Termux/Android.
  max: Number(process.env.DB_POOL_MAX || 2),

  // Do not deliberately destroy idle Neon connections.
  idleTimeoutMillis: 0,

  connectionTimeoutMillis: 15000,

  // Help keep long-lived TLS connections alive.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,

  statement_timeout: 30000,
  idle_in_transaction_session_timeout: 30000
});

// IMPORTANT:
// pg emits idle-client errors on the Pool.
// Without this listener, Node can terminate the entire application.
pool.on('error', (err) => {
  console.error(
    '[PostgreSQL pool] Idle client error:',
    err.code || err.message
  );
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await query('ALTER TABLE profile ADD COLUMN IF NOT EXISTS image_public_id text');
  await query('ALTER TABLE works ADD COLUMN IF NOT EXISTS image_public_id text');
  await query(`
    CREATE TABLE IF NOT EXISTS profile (
      id integer PRIMARY KEY,
      name text NOT NULL,
      title text NOT NULL,
      bio text NOT NULL,
      location text,
      image_url text,
      updated_at timestamptz DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS works (
      id serial PRIMARY KEY,
      slug text UNIQUE NOT NULL,
      title text NOT NULL,
      category text,
      summary text NOT NULL,
      description text NOT NULL,
      tech text[] DEFAULT '{}',
      live_url text,
      repo_url text,
      image_url text,
      featured boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);

  const profile = await query(
    'SELECT id FROM profile WHERE id=1'
  );

  if (!profile.rowCount) {
    await query(
      `
      INSERT INTO profile
      (id,name,title,bio,location)
      VALUES (1,$1,$2,$3,$4)
      `,
      [
        'Codex Inc',
        'Software Developer & Digital Product Builder',
        'I build practical digital products, web platforms, backend systems and security-focused solutions for individuals, startups, small companies and organizations. I work remotely and turn ideas into maintainable software with a strong focus on usability, reliability and clean engineering.',
        'Minna, Nigeria'
      ]
    );
  }

  const count = await query(
    'SELECT count(*)::int AS n FROM works'
  );

  if (count.rows[0].n === 0) {
    const rows = [
      [
        'codex-dataplug',
        'Codex Dataplug',
        'Digital Commerce',
        'A VTU and digital-services platform built around data services, vendors, referrals and customer-focused digital transactions.',
        ['Web Development', 'Digital Product Development'],
        'https://sabuss.com/codexdataplug5',
        null,
        true
      ],
      [
        'password-protection-api',
        'Password Protection API',
        'Backend & API',
        'A security-focused API concept for password protection, hashing and authentication workflows.',
        ['Backend', 'API', 'Security'],
        null,
        null,
        true
      ],
      [
        'naicts-infohub',
        'NAICTS INFOHUB',
        'Faculty Platform',
        'A faculty information platform designed for structured news, announcements, events and protected content management.',
        ['Node.js', 'PostgreSQL', 'Cloudinary'],
        null,
        'https://github.com/codexincweb',
        true
      ],
      [
        'pq-repository',
        'PQ Repository',
        'Education Platform',
        'A past-question repository for FUT Minna SICT departments, supporting image and PDF resources with administrative management.',
        ['Node.js', 'PostgreSQL', 'PWA'],
        null,
        'https://github.com/codexincweb',
        true
      ],
      [
        'cloud-hub',
        'Cloud Hub',
        'Learning Platform',
        'A student resource directory connecting learners with technical learning paths, certifications and practical resources.',
        ['Web Development', 'Database', 'Admin CMS'],
        null,
        'https://github.com/codexincweb/cloud-hub',
        false
      ],
      [
        'sict-timetable-planner',
        'SICT Timetable Planner',
        'Productivity Tool',
        'An editable timetable planner for SICT students and course representatives, designed around a clean weekly grid and printable schedules.',
        ['React', 'Vite', 'Tailwind CSS'],
        'https://v0-sict-timetableplanner.vercel.app',
        null,
        false
      ]
    ];

    for (const r of rows) {
      await query(
        `
        INSERT INTO works
        (slug,title,category,summary,description,tech,live_url,repo_url,featured)
        VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8)
        `,
        r
      );
    }
  }
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  pool,
  query,
  initDb,
  randomToken
};
