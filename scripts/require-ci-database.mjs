import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required: refusing to silently skip the critical auth/practice-data database suite.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query('select 1');
  console.log('PostgreSQL preflight passed; DB-backed tests will run.');
} finally {
  await pool.end();
}
