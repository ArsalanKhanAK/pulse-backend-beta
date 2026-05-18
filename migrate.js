const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function runMigration() {
  console.log('=== Running SaaS Multi-Gym Platform Database Migration ===');
  
  let connection;
  try {
    // 1. Establish connection to MySQL
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : undefined
    });

    const dbName = process.env.DB_NAME || 'gym_management';
    
    // On cloud database providers like Aiven, 'defaultdb' is already created and 'avnadmin' doesn't have CREATE DATABASE privilege.
    if (process.env.DB_SSL) {
      console.log('[Migration] Cloud environment detected. Skipping CREATE DATABASE statement.');
    } else {
      console.log(`[Migration] Ensuring database '${dbName}' exists...`);
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    }
    
    await connection.changeUser({ database: dbName });
    console.log('[Migration] Connected to database successfully.');

    // 2. Create gyms table
    console.log('[Migration] Creating or verifying \'gyms\' table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS gyms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(50),
        logo_base64 LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2b. Inspect 'gyms' table columns to perform safe ALTERs
    console.log('[Migration] Checking \'gyms\' table structure...');
    const [gymColumns] = await connection.query('SHOW COLUMNS FROM gyms;');
    const gymColNames = gymColumns.map(c => c.Field);

    if (!gymColNames.includes('monthly_fee')) {
      console.log('[Migration] Adding \'monthly_fee\' column to \'gyms\'...');
      await connection.query(`
        ALTER TABLE gyms ADD COLUMN monthly_fee DECIMAL(10, 2) DEFAULT 1000.00;
      `);
    }

    // 3. Inspect 'users' table columns to perform safe ALTERs
    console.log('[Migration] Checking \'users\' table structure...');
    const [userColumns] = await connection.query('SHOW COLUMNS FROM users;');
    const userColNames = userColumns.map(c => c.Field);

    if (!userColNames.includes('role')) {
      console.log('[Migration] Adding \'role\' column to \'users\'...');
      await connection.query(`
        ALTER TABLE users ADD COLUMN role ENUM('super_admin', 'gym_admin') DEFAULT 'gym_admin';
      `);
    }
    if (!userColNames.includes('gym_id')) {
      console.log('[Migration] Adding \'gym_id\' column to \'users\'...');
      await connection.query(`
        ALTER TABLE users 
        ADD COLUMN gym_id INT NULL,
        ADD CONSTRAINT fk_user_gym FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE SET NULL;
      `);
    }
    if (!userColNames.includes('subscription_expires_at')) {
      console.log('[Migration] Adding subscription columns to \'users\'...');
      await connection.query(`
        ALTER TABLE users 
        ADD COLUMN subscription_expires_at DATETIME NULL,
        ADD COLUMN grace_period_expires_at DATETIME NULL;
      `);
    }
    if (!userColNames.includes('status')) {
      console.log('[Migration] Adding \'status\' column to \'users\'...');
      await connection.query(`
        ALTER TABLE users ADD COLUMN status ENUM('active', 'suspended', 'banned') DEFAULT 'active';
      `);
    }

    // 4. Create payments table
    console.log('[Migration] Creating or verifying \'payments\' table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gym_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        payment_method ENUM('EasyPaisa', 'JazzCash') NOT NULL,
        receipt_image_base64 LONGTEXT NOT NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_at DATETIME NULL,
        FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4c. Create membership_plans table
    console.log('[Migration] Creating or verifying \'membership_plans\' table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS membership_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gym_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        duration_months INT DEFAULT 1,
        admission_fee DECIMAL(10, 2) DEFAULT 0.00,
        description TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4d. Create member_renewals table
    console.log('[Migration] Creating or verifying \'member_renewals\' table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS member_renewals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT NOT NULL,
        gym_id INT NOT NULL,
        plan_id INT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        renewal_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expiry_date DATE NOT NULL,
        payment_type ENUM('plan', 'manual') DEFAULT 'plan',
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
        FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE,
        FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4b. Create support_messages table (Chat System)
    console.log('[Migration] Creating or verifying \'support_messages\' table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Inspect 'members' table columns to perform safe ALTERs
    console.log('[Migration] Checking \'members\' table structure...');
    const [memberColumns] = await connection.query('SHOW COLUMNS FROM members;');
    const memberColNames = memberColumns.map(c => c.Field);

    if (!memberColNames.includes('gym_id')) {
      console.log('[Migration] Adding \'gym_id\' column to \'members\'...');
      // Allow it to be NULL temporarily or default to 1, or let's just add it as NULLable first
      await connection.query(`
        ALTER TABLE members 
        ADD COLUMN gym_id INT NULL,
        ADD CONSTRAINT fk_member_gym FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE;
      `);
    }
    if (!memberColNames.includes('member_custom_id')) {
      console.log('[Migration] Adding \'member_custom_id\' column to \'members\'...');
      await connection.query(`
        ALTER TABLE members ADD COLUMN member_custom_id VARCHAR(100) NULL;
      `);
    }

    // Add or modify member status column safely
    if (!memberColNames.includes('status')) {
      console.log("[Migration] Adding 'status' column to 'members'...");
      await connection.query(`
        ALTER TABLE members ADD COLUMN status ENUM('active', 'left') DEFAULT 'active';
      `);
    } else {
      console.log("[Migration] Modifying 'status' column in 'members'...");
      await connection.query(`
        ALTER TABLE members MODIFY COLUMN status ENUM('active', 'left') DEFAULT 'active';
      `);
    }

    // 6. Seed default Super Admin account if it doesn't exist
    console.log('[Migration] Seeding default Super Admin...');
    const [superAdmins] = await connection.query('SELECT * FROM users WHERE username = ?;', ['superadmin']);
    if (superAdmins.length === 0) {
      const hashedPassword = await bcrypt.hash('super123', 10);
      await connection.query(`
        INSERT INTO users (username, password, role, status)
        VALUES (?, ?, 'super_admin', 'active');
      `, ['superadmin', hashedPassword]);
      console.log('[Migration] Super Admin seeded: superadmin / super123');
    } else {
      console.log('[Migration] Super Admin already exists.');
    }

    console.log('\n[SUCCESS] SaaS Database Migrations executed successfully!');
    await connection.end();
  } catch (err) {
    console.error('\n[ERROR] Migration failed!');
    console.error(err);
    if (connection) await connection.end();
    process.exit(1);
  }
}

module.exports = runMigration;
