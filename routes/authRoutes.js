const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// Public Route: Login
router.post('/login', authController.login);

// Public Route: Logout
router.post('/logout', authController.logout);

// Protected Route: Retrieve Active Admin Account
router.get('/me', authMiddleware, authController.getMe);

// Protected Route: Update theme preference
router.put('/theme', authMiddleware, authController.updateTheme);

// Public Route: Retrieve App Settings (Payment Numbers)
router.get('/settings', authController.getSettings);

module.exports = router;
