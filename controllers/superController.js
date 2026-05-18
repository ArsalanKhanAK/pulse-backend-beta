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
        console.log(`[Super Admin Portal] Approved payment. Gym #${payment.gym_id} subscription extended to ${baseDate.toISOString().slice(0, 10)}`);
      }
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
    const arsalanShare = totalEarnings * 0.50;
    const uffairShare = totalEarnings * 0.50;

    // B. Fetch monthly breakdown
    const [monthlyEarnings] = await pool.query(
      `SELECT 
        DATE_FORMAT(verified_at, '%Y-%m') AS month_key,
        DATE_FORMAT(verified_at, '%M %Y') AS month_label,
        SUM(amount) AS total,
        SUM(amount) * 0.50 AS arsalan,
        SUM(amount) * 0.50 AS uffair
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
