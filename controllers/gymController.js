const { pool } = require('../config/db');

// 1. Gym Admin: Upload Subscription Payment Receipt
exports.uploadReceipt = async (req, res) => {
  const { payment_method, receipt_image_base64 } = req.body;
  const gymId = req.user.gym_id;

  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  if (!payment_method || !receipt_image_base64) {
    return res.status(400).json({ success: false, message: 'Payment Method and Receipt Photo are required.' });
  }

  try {
    // A. Fetch fixed monthly fee from gym settings
    const [gymRows] = await pool.query('SELECT monthly_fee FROM gyms WHERE id = ?', [gymId]);
    const amount = gymRows.length > 0 ? gymRows[0].monthly_fee : 1000.00;

    // B. Insert pending payment receipt with exact amount
    await pool.query(
      `INSERT INTO payments (gym_id, amount, payment_method, receipt_image_base64, status) 
       VALUES (?, ?, ?, ?, 'pending')`,
      [gymId, amount, payment_method, receipt_image_base64]
    );

    return res.status(201).json({
      success: true,
      message: 'Your payment receipt has been uploaded successfully! It is pending verification by Super Admin.'
    });
  } catch (error) {
    console.error('[Gym Controller] uploadReceipt error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 2. Gym Admin: Fetch Subscription details
exports.getSubscriptionStatus = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.subscription_expires_at, u.grace_period_expires_at, u.status, g.monthly_fee 
       FROM users u 
       JOIN gyms g ON u.gym_id = g.id 
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gym Admin account not found.' });
    }

    const user = rows[0];
    const now = new Date();
    let daysRemaining = 0;
    let graceHoursRemaining = 0;
    let computedStatus = user.status;

    if (user.subscription_expires_at) {
      const expiry = new Date(user.subscription_expires_at);
      const diff = expiry - now;
      daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));

      // Dynamic computation: if subscription has expired but status is still 'active'
      if (expiry <= now && computedStatus === 'active') {
        computedStatus = 'suspended';
        
        // Auto-initialize grace period of 3 days from now
        if (!user.grace_period_expires_at) {
          const newGrace = new Date();
          newGrace.setDate(newGrace.getDate() + 3);
          user.grace_period_expires_at = newGrace;
          
          // Background update to DB
          pool.query('UPDATE users SET status = ?, grace_period_expires_at = ? WHERE id = ?', ['suspended', newGrace, req.user.id]).catch(err => console.error(err));
        } else {
          pool.query('UPDATE users SET status = ? WHERE id = ?', ['suspended', req.user.id]).catch(err => console.error(err));
        }
      }
    }

    if (user.grace_period_expires_at && computedStatus === 'suspended') {
      const graceExpiry = new Date(user.grace_period_expires_at);
      const diff = graceExpiry - now;
      graceHoursRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60)));

      // Dynamic computation: if grace period has expired
      if (graceExpiry <= now) {
        computedStatus = 'banned';
        graceHoursRemaining = 0;
        pool.query('UPDATE users SET status = ? WHERE id = ?', ['banned', req.user.id]).catch(err => console.error(err));
      }
    }

    // Also check if they have a pending upload or recently rejected one
    const [payments] = await pool.query(
      'SELECT id, status, submitted_at, rejection_reason FROM payments WHERE gym_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.gym_id]
    );
    const lastPayment = payments.length > 0 ? payments[0] : null;

    return res.status(200).json({
      success: true,
      subscription: {
        status: computedStatus,
        expires_at: user.subscription_expires_at,
        grace_expires_at: user.grace_period_expires_at,
        days_remaining: daysRemaining,
        grace_hours_remaining: graceHoursRemaining,
        monthly_fee: user.monthly_fee,
        last_payment: lastPayment
      }
    });
  } catch (error) {
    console.error('[Gym Controller] getSubscriptionStatus error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
