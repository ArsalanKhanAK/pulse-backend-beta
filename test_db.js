const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
  console.log('=== Database Diagnostic Test ===');
  console.log('Testing connection parameters:');
  console.log('Host:', process.env.DB_HOST || 'localhost');
  console.log('User:', process.env.DB_USER || 'root');
  console.log('Pass:', process.env.DB_PASS ? '********' : '(empty)');
  console.log('Name:', process.env.DB_NAME || 'gym_management');

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || ''
    });
    console.log('\n[SUCCESS] Connected to MySQL successfully!');
    
    const [rows] = await connection.query('SELECT VERSION() as version;');
    console.log('[SUCCESS] MySQL Server Version:', rows[0].version);
    
    await connection.end();
  } catch (err) {
    console.log('\n[ERROR] Connection failed!');
    console.log('Error Code:', err.code);
    console.log('Error Number:', err.errno);
    console.log('SQL State:', err.sqlState);
    console.log('Full Error Message:', err.message);
    console.log('\nError Stack Trace:');
    console.error(err);
  }
}

test();
