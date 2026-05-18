const { pool } = require('./config/db');

async function check() {
  const [rows] = await pool.query('SELECT id, username, role FROM users');
  console.log(rows);
  process.exit(0);
}

check();
