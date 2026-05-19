const { pool } = require('../config/db');

// Send a support message
exports.sendMessage = async (req, res) => {
  const { receiverId, message } = req.body;
  const senderId = req.user.id;
  const senderRole = req.user.role;

  if (senderRole === 'master_admin') {
    return res.status(403).json({ success: false, message: 'Master Admin is in view-only mode and cannot send replies.' });
  }

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
  const currentUserRole = req.user.role;

  try {
    // 1. Mark unread messages from this target user as read
    if (currentUserRole === 'super_admin' || currentUserRole === 'master_admin') {
      await pool.query(
        `UPDATE support_messages m
         JOIN users u_receiver ON m.receiver_id = u_receiver.id
         SET m.is_read = TRUE 
         WHERE m.sender_id = ? AND u_receiver.role IN ('super_admin', 'master_admin') AND m.is_read = FALSE`,
        [targetUserId]
      );
    } else {
      await pool.query(
        `UPDATE support_messages m
         JOIN users u_sender ON m.sender_id = u_sender.id
         SET m.is_read = TRUE 
         WHERE u_sender.role IN ('super_admin', 'master_admin') AND m.receiver_id = ? AND m.is_read = FALSE`,
        [currentUserId]
      );
    }

    // 2. Fetch the conversation history
    // We want a unified channel between the Gym Admin and any Support Team member (super_admin / master_admin)
    const queryUserId = (currentUserRole === 'super_admin' || currentUserRole === 'master_admin') ? targetUserId : currentUserId;

    const [messages] = await pool.query(
      `SELECT m.*, u_sender.username AS sender_name, u_sender.role AS sender_role
       FROM support_messages m
       JOIN users u_sender ON m.sender_id = u_sender.id
       JOIN users u_receiver ON m.receiver_id = u_receiver.id
       WHERE (m.sender_id = ? AND u_receiver.role IN ('super_admin', 'master_admin')) 
          OR (u_sender.role IN ('super_admin', 'master_admin') AND m.receiver_id = ?)
       ORDER BY m.created_at ASC`,
      [queryUserId, queryUserId]
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
    const [superAdmins] = await pool.query("SELECT id, username, role FROM users WHERE role = 'super_admin' LIMIT 1");
    if (superAdmins.length === 0) {
      // Fallback to master admin if no super admin exists
      const [masters] = await pool.query("SELECT id, username, role FROM users WHERE role = 'master_admin' LIMIT 1");
      if (masters.length === 0) {
        return res.status(404).json({ success: false, message: 'Support desk contact not found.' });
      }
      return res.status(200).json({ success: true, data: masters[0] });
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
    // Return all gym admins with an unread count based on unified support team channel
    const [contacts] = await pool.query(`
      SELECT 
        u.id, u.username, g.name AS gym_name, g.logo_base64,
        (SELECT COUNT(*) 
         FROM support_messages sm 
         JOIN users u_rec ON sm.receiver_id = u_rec.id
         WHERE sm.sender_id = u.id AND u_rec.role IN ('super_admin', 'master_admin') AND sm.is_read = FALSE) AS unread_count,
        (SELECT sm2.created_at 
         FROM support_messages sm2 
         JOIN users u_sender2 ON sm2.sender_id = u_sender2.id
         JOIN users u_receiver2 ON sm2.receiver_id = u_receiver2.id
         WHERE (sm2.sender_id = u.id AND u_receiver2.role IN ('super_admin', 'master_admin')) 
            OR (u_sender2.role IN ('super_admin', 'master_admin') AND sm2.receiver_id = u.id) 
         ORDER BY sm2.created_at DESC LIMIT 1) AS last_message_time
      FROM users u
      LEFT JOIN gyms g ON u.gym_id = g.id
      WHERE u.role = 'gym_admin'
      ORDER BY last_message_time DESC, u.username ASC
    `);

    return res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    console.error('[Chat Controller] getChatContacts error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Gym Admin: get initial unread message count from support team (for badge on page load/refresh)
exports.getGymUnreadCount = async (req, res) => {
  const currentUserId = req.user.id;
  try {
    const [result] = await pool.query(
      `SELECT COUNT(*) as unread_count
       FROM support_messages sm
       JOIN users u_sender ON sm.sender_id = u_sender.id
       WHERE u_sender.role IN ('super_admin', 'master_admin')
         AND sm.receiver_id = ?
         AND sm.is_read = FALSE`,
      [currentUserId]
    );
    return res.status(200).json({ success: true, data: { unread_count: parseInt(result[0].unread_count, 10) } });
  } catch (error) {
    console.error('[Chat Controller] getGymUnreadCount error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
