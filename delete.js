const { pool } = require('./config/db');

async function deleteAdmin() {
  try {
    const [result] = await pool.query("DELETE FROM users WHERE username = 'superadmin'");
    console.log('Deleted rows:', result.affectedRows);
  } catch(err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

deleteAdmin();
