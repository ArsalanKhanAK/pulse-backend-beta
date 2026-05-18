const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'gym_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

async function initializeDatabase() {
  let connection;
  try {
    // Connect without database first to ensure the database itself exists
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || ''
    });

    const dbName = process.env.DB_NAME || 'gym_management';
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.end();

    const bcrypt = require('bcryptjs');

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create members table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        start_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        fee_status ENUM('Paid', 'Unpaid') DEFAULT 'Unpaid' NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Check if default admin exists, if not seed it
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [adminUsername]);
    if (rows.length === 0) {
      const plainPassword = process.env.ADMIN_PASSWORD || 'admin123';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [adminUsername, hashedPassword]);
      console.log(`[Database] Default admin user '${adminUsername}' created successfully.`);
    } else {
      console.log(`[Database] Admin user '${adminUsername}' verified.`);
    }

    console.log('[Database] Database tables initialized and verified.');
  } catch (error) {
    console.error('[Database] Initialization error:', error.message);
    console.error('[Database] WARNING: Please ensure XAMPP MySQL server is running.');
  }
}

module.exports = {
  pool,
  initializeDatabase
};
