const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');

// 1. POST /api/member-portal/login
exports.login = async (req, res) => {
  try {
    const { identifier } = req.body; // Can be Gym ID (member_custom_id) or Phone

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Gym ID or Phone is required' });
    }

    const [members] = await pool.query(
      `SELECT m.*, g.name as gym_name, g.logo_base64 as gym_logo 
       FROM members m 
       JOIN gyms g ON m.gym_id = g.id 
       WHERE m.member_custom_id = ? OR m.phone = ?`,
      [identifier, identifier]
    );

    if (members.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const member = members[0];

    // Optional: check if member is active
    if (member.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Membership is inactive or expired. Please contact the gym.' });
    }

    // Generate member JWT token
    const token = jwt.sign(
      { 
        memberId: member.id, 
        gymId: member.gym_id,
        role: 'member'
      },
      process.env.JWT_SECRET || 'gym_management_super_secret_jwt_key_2026',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      member: {
        id: member.id,
        name: member.name,
        member_custom_id: member.member_custom_id,
        gym_name: member.gym_name,
        gym_logo: member.gym_logo
      }
    });

  } catch (error) {
    console.error('[Member Portal] Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Middleware to verify member token
exports.requireMemberAuth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gym_management_super_secret_jwt_key_2026');
    if (decoded.role !== 'member') {
      return res.status(403).json({ success: false, message: 'Invalid role' });
    }
    req.member = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// 2. GET /api/member-portal/me
exports.getMe = async (req, res) => {
  try {
    const memberId = req.member.memberId;

    const [members] = await pool.query(
      `SELECT m.id, m.name, m.phone, m.member_custom_id, m.start_date, m.expiry_date, m.status, m.photo_base64,
              g.name as gym_name, g.logo_base64 as gym_logo, g.features_config
       FROM members m
       JOIN gyms g ON m.gym_id = g.id
       WHERE m.id = ?`,
      [memberId]
    );

    if (members.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const member = members[0];
    let qrTimer = 30;
    if (member.features_config) {
      try {
        const config = JSON.parse(member.features_config);
        if (config.qr_timer) qrTimer = parseInt(config.qr_timer);
      } catch(e) {}
    }
    member.qr_timer = qrTimer;
    delete member.features_config;

    res.json({ success: true, member });
  } catch (error) {
    console.error('[Member Portal] Get me error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 3. GET /api/member-portal/qr
// Returns payload for Static QR (member_custom_id)
exports.getQr = async (req, res) => {
  try {
    const memberId = req.member.memberId;
    const gymId = req.member.gymId;

    const [rows] = await pool.query('SELECT member_custom_id FROM members WHERE id = ? AND gym_id = ?', [memberId, gymId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Member not found' });

    res.json({ success: true, qrData: rows[0].member_custom_id });
  } catch (error) {
    console.error('[Member Portal] QR error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
