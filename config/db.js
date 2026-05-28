const mysql = require('mysql2/promise');
const runMigration = require('../migrate');
require('dotenv').config();

let poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'gym_management',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  ssl: process.env.DB_SSL ? { rejectUnauthorized: true, minVersion: 'TLSv1.2' } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
};

if (process.env.DB_URL) {
  try {
    const parsedUrl = new URL(process.env.DB_URL);
    poolConfig.host = parsedUrl.hostname;
    poolConfig.user = decodeURIComponent(parsedUrl.username);
    poolConfig.password = decodeURIComponent(parsedUrl.password);
    poolConfig.port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3306;
    poolConfig.database = parsedUrl.pathname.substring(1); // remove leading slash
    poolConfig.ssl = { rejectUnauthorized: true, minVersion: 'TLSv1.2' }; // Enforce SSL for TiDB Serverless
  } catch (err) {
    console.error('[Database] Failed to parse DB_URL:', err.message);
  }
}

const pool = mysql.createPool(poolConfig);

async function initializeDatabase() {
  let connection;
  try {
    const dbName = process.env.DB_NAME || 'gym_management';

    // On cloud database providers like Aiven, 'defaultdb' is already created and 'avnadmin' doesn't have CREATE DATABASE privilege.
    if (process.env.DB_SSL || process.env.DB_URL) {
      console.log('[Database] Cloud environment detected. Skipping CREATE DATABASE statement.');
    } else {
      // Connect without database first to ensure the database itself exists (Local only)
      connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || '',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : undefined
      });
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
      await connection.end();
    }

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

    // 2. Trigger the comprehensive SaaS multi-gym schema migration & superadmin seeding
    await runMigration();

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
