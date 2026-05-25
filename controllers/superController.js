const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

// 1. Create Gym & Admin Owner (Trial 30 Days)
exports.createGymOwner = async (req, res) => {
  const { gymName, address, phone, logo_base64, username, password, monthlyFee } = req.body;

  if (!gymName || !username || !password) {
    return res.status(400).json({ success: false, message: 'Gym Name, Admin Username and Password are required.' });
  }

  const feeAmount = monthlyFee ? parseFloat(monthlyFee) : 1000.00;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // A. Insert Gym profile details
    const [gymResult] = await connection.query(
      'INSERT INTO gyms (name, address, phone, logo_base64, monthly_fee) VALUES (?, ?, ?, ?, ?)',
      [gymName, address || '', phone || '', logo_base64 || '', feeAmount]
    );
    const gymId = gymResult.insertId;

    // B. Check if Username already exists
    const [checkUser] = await connection.query('SELECT * FROM users WHERE username = ?', [username]);
    if (checkUser.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'Admin username is already taken.' });
    }

    // C. Hash Admin password & set initial 30-day subscription
    const hashedPassword = await bcrypt.hash(password, 10);
    const subscriptionExpiry = new Date();
    subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 30); // 30 days initial trial

    await connection.query(
      `INSERT INTO users (username, password, role, gym_id, subscription_expires_at, status) 
       VALUES (?, ?, 'gym_admin', ?, ?, 'active')`,
      [username, hashedPassword, gymId, subscriptionExpiry]
    );

    await connection.commit();
    connection.release();

    return res.status(201).json({
      success: true,
      message: 'Gym and Admin account created successfully with 30-day trial!'
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('[Super Controller] createGymOwner error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 2. Fetch all Gyms with Subscriptions metadata
exports.getGyms = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        g.id as gym_id, g.name as gym_name, g.address, g.phone, g.logo_base64,
        u.id as user_id, u.username, u.status, u.subscription_expires_at, u.grace_period_expires_at
      FROM gyms g
      JOIN users u ON g.id = u.gym_id
      WHERE u.role = 'gym_admin'
      ORDER BY g.id DESC
    `);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('[Super Controller] getGyms error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 2.5 Get Gym Stats for Master Admin (Total Members & Monthly Revenue)
exports.getGymStats = async (req, res) => {
  const { month } = req.query; // expected format 'YYYY-MM'
  
  if (!month) {
    return res.status(400).json({ success: false, message: 'Month parameter (YYYY-MM) is required.' });
  }

  try {
    const [rows] = await pool.query(`
      SELECT 
        g.id as gym_id,
        g.name as gym_name,
        (SELECT COUNT(*) FROM members m WHERE m.gym_id = g.id AND m.status != 'left') as total_members,
        (SELECT COALESCE(SUM(amount), 0) FROM member_renewals r WHERE r.gym_id = g.id AND DATE_FORMAT(r.renewal_date, '%Y-%m') = ?) as monthly_revenue
      FROM gyms g
      JOIN users u ON g.id = u.gym_id
      WHERE u.role = 'gym_admin'
    `, [month]);

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[Super Controller] getGymStats error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 2.6 Get Admin Sessions (Master Admin)
exports.getAdminSessions = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.admin_id, u.username, u.role, DATE_ADD(s.login_at, INTERVAL 5 HOUR) as login_at, DATE_ADD(s.logout_at, INTERVAL 5 HOUR) as logout_at, s.ip_address, g.name as gym_name
      FROM admin_sessions s
      JOIN users u ON s.admin_id = u.id
      LEFT JOIN gyms g ON u.gym_id = g.id
      ORDER BY s.login_at DESC
      LIMIT 100
    `);
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[Super Controller] getAdminSessions error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 2.7 Clear Admin Sessions (Master Admin)
exports.clearAdminSessions = async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE admin_sessions');
    return res.status(200).json({ success: true, message: 'Admin sessions cleared successfully.' });
  } catch (error) {
    console.error('[Super Controller] clearAdminSessions error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 3. Adjust Subscription Days manually (+/- days)
exports.adjustDays = async (req, res) => {
  const { userId, days } = req.body; // days can be positive or negative integer

  if (!userId || days === undefined || isNaN(days)) {
    return res.status(400).json({ success: false, message: 'Valid User ID and Days modifier are required.' });
  }

  try {
    // Check if user exists
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND role = \'gym_admin\'', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gym Admin account not found.' });
    }

    const user = rows[0];
    let baseDate = user.subscription_expires_at ? new Date(user.subscription_expires_at) : new Date();
    
    // Adjust days
    baseDate.setDate(baseDate.getDate() + parseInt(days, 10));

    // Determine status (if extended, restore to active; if expired, transition to suspended with 3-day grace)
    let status = user.status;
    let graceDate = user.grace_period_expires_at;

    if (baseDate > new Date()) {
      status = 'active';
      graceDate = null;
    } else {
      // Subscription has expired
      if (status !== 'banned') {
        status = 'suspended';
        // If there was no grace period set previously, set it to 3 days from now
        if (!graceDate) {
          const threeDaysFromNow = new Date();
          threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
          graceDate = threeDaysFromNow;
        }
      }
    }

    await pool.query(
      `UPDATE users 
       SET subscription_expires_at = ?, status = ?, grace_period_expires_at = ? 
       WHERE id = ?`,
      [baseDate, status, graceDate, userId]
    );

    // Log the action
    await pool.query(
      'INSERT INTO audit_logs (admin_id, action_type, target_gym_id, description) VALUES (?, ?, ?, ?)',
      [req.user.id, 'ADJUST_DAYS', user.gym_id, `Adjusted subscription by ${days > 0 ? '+' : ''}${days} days for Gym Admin ${user.username}.`]
    );

    return res.status(200).json({
      success: true,
      message: `Subscription successfully adjusted by ${days} days! New expiry: ${baseDate.toISOString().slice(0, 10)}`
    });
  } catch (error) {
    console.error('[Super Controller] adjustDays error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 3.5 Adjust Grace Period Days manually (+/- days)
exports.adjustGraceDays = async (req, res) => {
  const { userId, days } = req.body; // days can be positive or negative integer

  if (!userId || days === undefined || isNaN(days)) {
    return res.status(400).json({ success: false, message: 'Valid User ID and Grace Days modifier are required.' });
  }

  try {
    // Check if user exists
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND role = \'gym_admin\'', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gym Admin account not found.' });
    }

    const user = rows[0];
    
    // If the account has no grace period date set, initialize it to now first
    let baseDate = user.grace_period_expires_at ? new Date(user.grace_period_expires_at) : new Date();
    
    // Adjust grace days
    baseDate.setDate(baseDate.getDate() + parseInt(days, 10));

    // Determine status (if extended in future, restore from banned to suspended)
    let status = user.status;
    if (baseDate > new Date()) {
      if (status === 'banned' || status === 'active') {
        status = 'suspended';
      }
    } else {
      status = 'banned';
    }

    await pool.query(
      `UPDATE users 
       SET grace_period_expires_at = ?, status = ? 
       WHERE id = ?`,
      [baseDate, status, userId]
    );

    // Log the action
    await pool.query(
      'INSERT INTO audit_logs (admin_id, action_type, target_gym_id, description) VALUES (?, ?, ?, ?)',
      [req.user.id, 'ADJUST_GRACE_DAYS', user.gym_id, `Adjusted grace period by ${days > 0 ? '+' : ''}${days} days for Gym Admin ${user.username}.`]
    );

    return res.status(200).json({
      success: true,
      message: `Grace period successfully adjusted by ${days} days! New grace expiry: ${baseDate.toISOString().slice(0, 10)}`
    });
  } catch (error) {
    console.error('[Super Controller] adjustGraceDays error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 4. Retrieve Pending Payment Receipts
exports.getPendingReceipts = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, g.name as gym_name 
      FROM payments p
      JOIN gyms g ON p.gym_id = g.id
      WHERE p.status = 'pending'
      ORDER BY p.id ASC
    `);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('[Super Controller] getPendingReceipts error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 5. Verify Receipt (Approve/Reject manual payments)
exports.verifyReceipt = async (req, res) => {
  const { paymentId, status, rejectionReason } = req.body; // 'approved' or 'rejected'

  if (!paymentId || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Valid Payment ID and Status are required.' });
  }
  
  if (status === 'rejected' && (!rejectionReason || rejectionReason.trim() === '')) {
    return res.status(400).json({ success: false, message: 'A rejection reason is required when rejecting a payment.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // A. Check payment entry
    const [pRows] = await connection.query('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (pRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    const payment = pRows[0];
    if (payment.status !== 'pending') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'This payment has already been processed.' });
    }

    // B. Update payment status
    await connection.query(
      'UPDATE payments SET status = ?, verified_at = NOW(), rejection_reason = ? WHERE id = ?',
      [status, status === 'rejected' ? rejectionReason : null, paymentId]
    );

    // C. If approved, add 30 days and reactivate account
    if (status === 'approved') {
      // Find admin associated with this gym
      const [uRows] = await connection.query('SELECT * FROM users WHERE gym_id = ? AND role = \'gym_admin\'', [payment.gym_id]);
      if (uRows.length > 0) {
        const user = uRows[0];
        
        // Calculate new expiry date: GREATEST(subscription_expires_at, NOW()) + 30 Days
        const now = new Date();
        let baseDate = user.subscription_expires_at ? new Date(user.subscription_expires_at) : now;
        if (baseDate < now) {
          baseDate = now;
        }
        baseDate.setDate(baseDate.getDate() + 30); // Add 30 Days

        await connection.query(
          `UPDATE users 
           SET subscription_expires_at = ?, status = 'active', grace_period_expires_at = NULL 
           WHERE id = ?`,
          [baseDate, user.id]
        );
        
        // Log the renewal action
        await connection.query(
          'INSERT INTO audit_logs (admin_id, action_type, target_gym_id, description) VALUES (?, ?, ?, ?)',
          [req.user.id, 'RENEW_GYM', payment.gym_id, `Approved payment of Rs. ${payment.amount}. Expiry extended to ${baseDate.toISOString().slice(0, 10)}.`]
        );

        console.log(`[Super Admin Portal] Approved payment. Gym #${payment.gym_id} subscription extended to ${baseDate.toISOString().slice(0, 10)}`);
      }
    } else if (status === 'rejected') {
      // Log the rejection action
      await connection.query(
        'INSERT INTO audit_logs (admin_id, action_type, target_gym_id, description) VALUES (?, ?, ?, ?)',
        [req.user.id, 'REJECT_PAYMENT', payment.gym_id, `Rejected payment of Rs. ${payment.amount}. Reason: ${rejectionReason}`]
      );
    }

    await connection.commit();
    connection.release();

    return res.status(200).json({
      success: true,
      message: `Receipt has been successfully ${status}!`
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('[Super Controller] verifyReceipt error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 6. Get Super Admin SaaS Earnings Analytics (Splitting for CEO Arsalan & Co-founder Uffair)
exports.getSaaSEarnings = async (req, res) => {
  try {
    const { month, startDate, endDate } = req.query;

    let totalWhere = "status = 'approved'";
    let monthlyWhere = "status = 'approved' AND verified_at IS NOT NULL";
    let historyWhere = "p.status = 'approved'";
    
    const params = [];
    const monthlyParams = [];
    const historyParams = [];

    // Filter by specific Month (YYYY-MM)
    if (month) {
      totalWhere += " AND DATE_FORMAT(verified_at, '%Y-%m') = ?";
      monthlyWhere += " AND DATE_FORMAT(verified_at, '%Y-%m') = ?";
      historyWhere += " AND DATE_FORMAT(p.verified_at, '%Y-%m') = ?";
      params.push(month);
      monthlyParams.push(month);
      historyParams.push(month);
    }

    // Filter by Start Date (YYYY-MM-DD)
    if (startDate) {
      totalWhere += " AND DATE(verified_at) >= ?";
      monthlyWhere += " AND DATE(verified_at) >= ?";
      historyWhere += " AND DATE(p.verified_at) >= ?";
      params.push(startDate);
      monthlyParams.push(startDate);
      historyParams.push(startDate);
    }

    // Filter by End Date (YYYY-MM-DD)
    if (endDate) {
      totalWhere += " AND DATE(verified_at) <= ?";
      monthlyWhere += " AND DATE(verified_at) <= ?";
      historyWhere += " AND DATE(p.verified_at) <= ?";
      params.push(endDate);
      monthlyParams.push(endDate);
      historyParams.push(endDate);
    }

    // A. Fetch total sum of approved subscription payments
    const [[{ total }]] = await pool.query(
      `SELECT SUM(amount) AS total FROM payments WHERE ${totalWhere}`,
      params
    );

    const totalEarnings = parseFloat(total || 0);
    const arsalanShare = totalEarnings * 0.60;
    const uffairShare = totalEarnings * 0.40;

    // B. Fetch monthly breakdown
    const [monthlyEarnings] = await pool.query(
      `SELECT 
        DATE_FORMAT(verified_at, '%Y-%m') AS month_key,
        DATE_FORMAT(verified_at, '%M %Y') AS month_label,
        SUM(amount) AS total,
        SUM(amount) * 0.60 AS arsalan,
        SUM(amount) * 0.40 AS uffair
       FROM payments
       WHERE ${monthlyWhere}
       GROUP BY month_key, month_label
       ORDER BY month_key DESC`,
      monthlyParams
    );

    // C. Fetch all approved payment logs for display
    const [paymentsHistory] = await pool.query(
      `SELECT p.*, g.name AS gym_name
       FROM payments p
       JOIN gyms g ON p.gym_id = g.id
       WHERE ${historyWhere}
       ORDER BY p.verified_at DESC`,
      historyParams
    );

    return res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        arsalanShare,
        uffairShare,
        monthlyEarnings,
        paymentsHistory
      }
    });
  } catch (error) {
    console.error('[Super Controller] getSaaSEarnings error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 7. Update Gym Owner & Profile details
exports.updateGymOwner = async (req, res) => {
  const { gymId } = req.params;
  const { gymName, address, phone, logo_base64, username, password, monthlyFee } = req.body;

  if (!gymName || !username) {
    return res.status(400).json({ success: false, message: 'Gym Name and Admin Username are required.' });
  }

  const feeAmount = monthlyFee ? parseFloat(monthlyFee) : 1000.00;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // A. Update Gym profile details
    await connection.query(
      'UPDATE gyms SET name = ?, address = ?, phone = ?, logo_base64 = ?, monthly_fee = ? WHERE id = ?',
      [gymName, address || '', phone || '', logo_base64 || '', feeAmount, gymId]
    );

    // B. Find gym admin user associated with this gym
    const [uRows] = await connection.query('SELECT * FROM users WHERE gym_id = ? AND role = \'gym_admin\'', [gymId]);
    if (uRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Gym Admin user not found.' });
    }

    const userId = uRows[0].id;

    // C. Check if Username already exists for another user
    const [checkUser] = await connection.query('SELECT * FROM users WHERE username = ? AND id != ?', [username, userId]);
    if (checkUser.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'Admin username is already taken by another account.' });
    }

    // D. Update Username
    await connection.query('UPDATE users SET username = ? WHERE id = ?', [username, userId]);

    // E. Update Password if provided
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      await connection.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
    }

    await connection.commit();
    connection.release();

    return res.status(200).json({
      success: true,
      message: 'Gym and Admin account updated successfully!'
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('[Super Controller] updateGymOwner error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 8. Delete Gym & Admin Owner
exports.deleteGymOwner = async (req, res) => {
  const { gymId } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // A. Explicitly delete gym admin user(s) first to avoid foreign key dangling
    await connection.query('DELETE FROM users WHERE gym_id = ?', [gymId]);

    // B. Delete gym (this will cascade delete payments, plans, members, renewals because of ON DELETE CASCADE!)
    await connection.query('DELETE FROM gyms WHERE id = ?', [gymId]);

    await connection.commit();
    connection.release();

    return res.status(200).json({ success: true, message: 'Gym and associated admin account deleted successfully.' });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('[Super Controller] deleteGymOwner error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// ==========================================
// MASTER ADMIN SPECIFIC ENDPOINTS
// ==========================================

// 9. Get Global Settings (Payment Accounts)
exports.getAppSettings = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM app_settings');
    const settings = rows.reduce((acc, curr) => {
      acc[curr.setting_key] = curr.setting_value;
      return acc;
    }, {});
    return res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error('[Super Controller] getAppSettings error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 10. Update Global Settings
exports.updateAppSettings = async (req, res) => {
  const { easypaisa_number, jazzcash_number } = req.body;
  try {
    if (easypaisa_number) {
      await pool.query("INSERT INTO app_settings (setting_key, setting_value) VALUES ('easypaisa_number', ?) ON DUPLICATE KEY UPDATE setting_value = ?", [easypaisa_number, easypaisa_number]);
    }
    if (jazzcash_number) {
      await pool.query("INSERT INTO app_settings (setting_key, setting_value) VALUES ('jazzcash_number', ?) ON DUPLICATE KEY UPDATE setting_value = ?", [jazzcash_number, jazzcash_number]);
    }
    
    // Log the action
    await pool.query(
      'INSERT INTO audit_logs (admin_id, action_type, description) VALUES (?, ?, ?)',
      [req.user.id, 'UPDATE_SETTINGS', 'Master Admin updated system payment gateways numbers.']
    );

    return res.status(200).json({ success: true, message: 'Settings updated successfully.' });
  } catch (error) {
    console.error('[Super Controller] updateAppSettings error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 11. Get Audit Logs
exports.getAuditLogs = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, u.username as admin_username, g.name as gym_name
      FROM audit_logs a
      LEFT JOIN users u ON a.admin_id = u.id
      LEFT JOIN gyms g ON a.target_gym_id = g.id
      ORDER BY a.created_at DESC
      LIMIT 500
    `);
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[Super Controller] getAuditLogs error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 12. Get Managers (Super Admins)
exports.getManagers = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, username, status, created_at FROM users WHERE role = 'super_admin' ORDER BY id DESC");
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[Super Controller] getManagers error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 13. Create Manager (Super Admin)
exports.createManager = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
  
  try {
    const [check] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (check.length > 0) return res.status(400).json({ success: false, message: 'Username already taken.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password, role, status) VALUES (?, ?, 'super_admin', 'active')", [username, hashedPassword]);
    
    await pool.query('INSERT INTO audit_logs (admin_id, action_type, description) VALUES (?, ?, ?)',
      [req.user.id, 'CREATE_MANAGER', `Created new Manager account: ${username}`]);

    return res.status(201).json({ success: true, message: 'Manager created successfully.' });
  } catch (error) {
    console.error('[Super Controller] createManager error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 14. Update Manager
exports.updateManager = async (req, res) => {
  const { id } = req.params;
  const { username, password, status } = req.body;
  
  try {
    if (username) {
      const [check] = await pool.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
      if (check.length > 0) return res.status(400).json({ success: false, message: 'Username already taken.' });
    }

    let query = "UPDATE users SET status = ?";
    let params = [status || 'active'];
    
    if (username) {
      query += ", username = ?";
      params.push(username);
    }
    
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += ", password = ?";
      params.push(hashedPassword);
    }
    
    query += " WHERE id = ? AND role = 'super_admin'";
    params.push(id);
    
    await pool.query(query, params);
    
    await pool.query('INSERT INTO audit_logs (admin_id, action_type, description) VALUES (?, ?, ?)',
      [req.user.id, 'UPDATE_MANAGER', `Updated Manager account ID ${id}.`]);

    return res.status(200).json({ success: true, message: 'Manager updated successfully.' });
  } catch (error) {
    console.error('[Super Controller] updateManager error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 15. Delete Manager
exports.deleteManager = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM users WHERE id = ? AND role = 'super_admin'", [id]);
    
    await pool.query('INSERT INTO audit_logs (admin_id, action_type, description) VALUES (?, ?, ?)',
      [req.user.id, 'manager_action', `Deleted Manager account ID ${id}.`]);

    return res.status(200).json({ success: true, message: 'Manager deleted successfully.' });
  } catch (error) {
    console.error('[Super Controller] deleteManager error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 16. Clear Audit Logs
exports.clearAuditLogs = async (req, res) => {
  try {
    await pool.query("DELETE FROM audit_logs");
    return res.status(200).json({ success: true, message: 'Audit logs cleared successfully.' });
  } catch (error) {
    console.error('[Super Controller] clearAuditLogs error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 17. Update Master Credentials
exports.updateMasterCredentials = async (req, res) => {
  const { newUsername, newPassword } = req.body;
  
  if (!newUsername && !newPassword) {
    return res.status(400).json({ success: false, message: 'Nothing to update.' });
  }

  try {
    if (newUsername) {
      const [check] = await pool.query('SELECT id FROM users WHERE username = ? AND id != ?', [newUsername, req.user.id]);
      if (check.length > 0) return res.status(400).json({ success: false, message: 'Username already taken.' });
    }

    let query = "UPDATE users SET ";
    let params = [];
    let updates = [];

    if (newUsername) {
      updates.push("username = ?");
      params.push(newUsername);
    }
    
    if (newPassword && newPassword.trim() !== '') {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      updates.push("password = ?");
      params.push(hashedPassword);
    }

    query += updates.join(", ") + " WHERE id = ? AND role = 'master_admin'";
    params.push(req.user.id);
    
    await pool.query(query, params);
    
    return res.status(200).json({ success: true, message: 'Master Admin credentials updated successfully.' });
  } catch (error) {
    console.error('[Super Controller] updateMasterCredentials error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 18. Get Feature Flags
exports.getFeatureFlags = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE "flag_%"');
    let flags = rows.reduce((acc, curr) => {
      acc[curr.setting_key] = curr.setting_value;
      return acc;
    }, {});

    // If user is a gym_admin, merge with gym-specific feature overrides
    if (req.user && req.user.role === 'gym_admin' && req.user.gym_id) {
      const [gymRows] = await pool.query('SELECT features_config FROM gyms WHERE id = ?', [req.user.gym_id]);
      if (gymRows.length > 0 && gymRows[0].features_config) {
        let gymFlags = gymRows[0].features_config;
        if (typeof gymFlags === 'string') {
          try { gymFlags = JSON.parse(gymFlags); } catch(e) {}
        }
        // Merge gymFlags into flags (overriding global where set to '0' or '1')
        if (gymFlags && typeof gymFlags === 'object') {
          for (const key in gymFlags) {
            if (gymFlags[key] === '0' || gymFlags[key] === '1') {
              flags[key] = gymFlags[key];
            }
          }
        }
      }
    }

    return res.status(200).json({ success: true, data: flags });
  } catch (error) {
    console.error('[Super Controller] getFeatureFlags error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 20. Get Gym Specific Feature Flags (Master Admin)
exports.getGymFeatureFlags = async (req, res) => {
  const { gymId } = req.params;
  try {
    const [rows] = await pool.query('SELECT features_config FROM gyms WHERE id = ?', [gymId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gym not found.' });
    }
    let config = rows[0].features_config;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch (e) { config = {}; }
    }
    return res.status(200).json({ success: true, data: config || {} });
  } catch (error) {
    console.error('[Super Controller] getGymFeatureFlags error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 21. Update Gym Specific Feature Flags (Master Admin)
exports.updateGymFeatureFlags = async (req, res) => {
  const { gymId } = req.params;
  const flags = req.body; // e.g. { flag_whatsapp_tab: '1', flag_import_export: null, ... }
  try {
    // Only keep flags that are strictly '0' or '1' (null/undefined means inherit)
    const configToSave = {};
    for (const key in flags) {
      if (flags[key] === '0' || flags[key] === '1') {
        configToSave[key] = flags[key];
      }
    }
    await pool.query('UPDATE gyms SET features_config = ? WHERE id = ?', [JSON.stringify(configToSave), gymId]);
    return res.status(200).json({ success: true, message: 'Gym feature permissions updated successfully.' });
  } catch (error) {
    console.error('[Super Controller] updateGymFeatureFlags error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 19. Update Feature Flags
exports.updateFeatureFlags = async (req, res) => {
  const flags = req.body; // e.g. { flag_whatsapp_tab: '1', flag_import_export: '0', ... }
  try {
    const updatePromises = Object.keys(flags).map(key => {
      if (key.startsWith('flag_')) {
        const value = String(flags[key]);
        return pool.query("INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?", [key, value, value]);
      }
      return Promise.resolve();
    });
    
    await Promise.all(updatePromises);

    // Log the action
    await pool.query(
      'INSERT INTO audit_logs (admin_id, action_type, description) VALUES (?, ?, ?)',
      [req.user.id, 'UPDATE_FEATURE_FLAGS', 'Master Admin updated feature visibility flags.']
    );

    return res.status(200).json({ success: true, message: 'Feature flags updated successfully.' });
  } catch (error) {
    console.error('[Super Controller] updateFeatureFlags error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
