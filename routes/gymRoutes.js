const express = require('express');
const router = express.Router();
const gymController = require('../controllers/gymController');
const authMiddleware = require('../middleware/authMiddleware');

// Protect all Gym Admin endpoints
router.use(authMiddleware);

router.post('/upload-receipt', gymController.uploadReceipt);
router.get('/subscription-status', gymController.getSubscriptionStatus);

module.exports = router;
