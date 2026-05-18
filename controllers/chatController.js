const { pool } = require('../config/db');

// Send a support message
exports.sendMessage = async (req, res) => {
  const { receiverId, message } = req.body;
  const senderId = req.user.id;

  if (!receiverId || !message) {
    return res.status(400).json({ success: false, message: 'Receiver ID and Message are required.' });
  }

  try {
    await pool.query(
      'INSERT INTO support_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
      [senderId, receiverId, message]
    );

    return res.status(201).json({ success: true, message: 'Message sent successfully.' });
  } catch (error) {
    console.error('[Chat Controller] sendMessage error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Get chat history with a specific user
exports.getChatHistory = async (req, res) => {
  const currentUserId = req.user.id;
  const targetUserId = req.params.userId; // The ID of the person we are chatting with

  try {
    // 1. Mark unread messages from this target user as read
    await pool.query(
      'UPDATE support_messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
      [targetUserId, currentUserId]
    );

    // 2. Fetch the conversation history
    const [messages] = await pool.query(
      `SELECT m.*, u_sender.username AS sender_name, u_sender.role AS sender_role
       FROM support_messages m
       JOIN users u_sender ON m.sender_id = u_sender.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?) 
          OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC`,
      [currentUserId, targetUserId, targetUserId, currentUserId]
    );

    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error('[Chat Controller] getChatHistory error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Get Super Admin User ID (for Gym Admins to know who to send messages to)
exports.getSuperAdminContact = async (req, res) => {
  try {
    const [superAdmins] = await pool.query("SELECT id, username FROM users WHERE role = 'super_admin' LIMIT 1");
    if (superAdmins.length === 0) {
      return res.status(404).json({ success: false, message: 'Super Admin not found.' });
    }
    return res.status(200).json({ success: true, data: superAdmins[0] });
  } catch (error) {
    console.error('[Chat Controller] getSuperAdminContact error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Super Admin: Get list of all Gym Admins who have active chat histories or are registered
exports.getChatContacts = async (req, res) => {
  try {
    // Return all gym admins with an unread count
    const [contacts] = await pool.query(`
      SELECT 
        u.id, u.username, g.name AS gym_name, g.logo_base64,
        (SELECT COUNT(*) FROM support_messages sm WHERE sm.sender_id = u.id AND sm.receiver_id = ? AND sm.is_read = FALSE) AS unread_count,
        (SELECT created_at FROM support_messages sm2 WHERE (sm2.sender_id = u.id AND sm2.receiver_id = ?) OR (sm2.sender_id = ? AND sm2.receiver_id = u.id) ORDER BY created_at DESC LIMIT 1) AS last_message_time
      FROM users u
      LEFT JOIN gyms g ON u.gym_id = g.id
      WHERE u.role = 'gym_admin'
      ORDER BY last_message_time DESC, u.username ASC
    `, [req.user.id, req.user.id, req.user.id]);

    return res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    console.error('[Chat Controller] getChatContacts error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
