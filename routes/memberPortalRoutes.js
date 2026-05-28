const express = require('express');
const router = express.Router();
const memberPortalController = require('../controllers/memberPortalController');
const { requireMemberAuth } = memberPortalController;

router.post('/login', memberPortalController.login);
router.get('/me', requireMemberAuth, memberPortalController.getMe);
router.get('/qr', requireMemberAuth, memberPortalController.getQr);

module.exports = router;
