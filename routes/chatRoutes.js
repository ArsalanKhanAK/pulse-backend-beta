const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

// Base prefix: /api/chat
router.use(authMiddleware);

// Role check middleware for Super Admin specific chat endpoints
const supportTeamOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'master_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Support desk access required.' });
  }
  next();
};

router.post('/send', chatController.sendMessage);
router.get('/history/:userId', chatController.getChatHistory);

// Gym Admins need to fetch Super Admin ID to send initial messages
router.get('/super-contact', chatController.getSuperAdminContact);

// Support desk teams need to see all Gym Admins
router.get('/contacts', supportTeamOnly, chatController.getChatContacts);

module.exports = router;
