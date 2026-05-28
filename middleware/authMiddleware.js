const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
require('dotenv').config();

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gym_management_super_secret_jwt_key_2026');
    
    // Attach decoded user information
    req.user = decoded;

    // Check database to enforce subscription gating status in real-time
    const [rows] = await pool.query('SELECT role, status, gym_id FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User account not found.' });
    }

    const dbUser = rows[0];
    req.user.role = dbUser.role;
    req.user.status = dbUser.status;
    req.user.gym_id = dbUser.gym_id;
    req.user.gymId = dbUser.gym_id; // Add camelCase version for newer controllers

    // SaaS Expiry Gating Exceptions: 
    // Allow expired/suspended owners to fetch their details, upload receipts, check subscription state, and chat with Support
    const isExceptionRoute = req.originalUrl.includes('/api/auth/me') ||
                             req.originalUrl.includes('/api/gym/upload-receipt') ||
                             req.originalUrl.includes('/api/gym/subscription-status') ||
                             req.originalUrl.includes('/api/chat');

    if (dbUser.role === 'gym_admin' && dbUser.status === 'banned' && !isExceptionRoute) {
      return res.status(403).json({
        success: false,
        message: `Your gym admin account is banned. Please upload your payment receipt to renew access.`,
        suspended: true,
        status: dbUser.status
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};
