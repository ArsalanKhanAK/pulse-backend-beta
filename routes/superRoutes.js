const express = require('express');
const router = express.Router();
const superController = require('../controllers/superController');
const authMiddleware = require('../middleware/authMiddleware');

// Role check middleware: Super Admin ONLY
const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Super Admin role required.' });
  }
  next();
};

// Protect all Super Admin endpoints
router.use(authMiddleware);
router.use(superAdminOnly);

router.post('/gyms', superController.createGymOwner);
router.get('/gyms', superController.getGyms);
router.put('/gyms/:gymId', superController.updateGymOwner);
router.delete('/gyms/:gymId', superController.deleteGymOwner);
router.post('/adjust-days', superController.adjustDays);
router.post('/adjust-grace-days', superController.adjustGraceDays);
router.get('/receipts', superController.getPendingReceipts);
router.post('/verify-receipt', superController.verifyReceipt);
router.get('/earnings', superController.getSaaSEarnings);

module.exports = router;
