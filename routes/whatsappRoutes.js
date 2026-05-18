const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const authMiddleware = require('../middleware/authMiddleware');

// Protect all WhatsApp integration configurations
router.use(authMiddleware);

// WhatsApp API endpoints
router.get('/status', whatsappController.getStatus);
router.post('/connect', whatsappController.connect);
router.post('/disconnect', whatsappController.disconnect);
router.post('/send-message', whatsappController.sendSingleMessage);
router.post('/trigger-reminders', whatsappController.triggerBulkReminders);

module.exports = router;
