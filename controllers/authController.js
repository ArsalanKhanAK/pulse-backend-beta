const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'gym_management_super_secret_jwt_key_2026';

// Unified Multi-Tenant Login Handler
exports.login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Please provide both username and password.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    // Sign jwt token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, gym_id: user.gym_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // If Gym Admin, fetch customized gym branding
    let gymBranding = null;
    if (user.role === 'gym_admin' && user.gym_id) {
      const [gymRows] = await pool.query('SELECT * FROM gyms WHERE id = ?', [user.gym_id]);
      if (gymRows.length > 0) {
        gymBranding = gymRows[0];
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      admin: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        subscription_expires_at: user.subscription_expires_at,
        grace_period_expires_at: user.grace_period_expires_at,
        gym: gymBranding
      }
    });
  } catch (error) {
    console.error('[Auth Controller] Login error:', error.message);
    return res.status(500).json({ success: false, message: 'An internal server error occurred.' });
  }
};

// Check Auth Session and dynamic states
exports.getMe = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, role, status, gym_id, subscription_expires_at, grace_period_expires_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const user = rows[0];
    let gymBranding = null;
    if (user.role === 'gym_admin' && user.gym_id) {
      const [gymRows] = await pool.query('SELECT * FROM gyms WHERE id = ?', [user.gym_id]);
      if (gymRows.length > 0) {
        gymBranding = gymRows[0];
      }
    }

    return res.status(200).json({
      success: true,
      admin: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        subscription_expires_at: user.subscription_expires_at,
        grace_period_expires_at: user.grace_period_expires_at,
        gym: gymBranding
      }
    });
  } catch (error) {
    console.error('[Auth Controller] getMe error:', error.message);
    return res.status(500).json({ success: false, message: 'An internal server error occurred.' });
  }
};
