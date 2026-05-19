const express = require('express');
const router = express.Router();
const superController = require('../controllers/superController');
const authMiddleware = require('../middleware/authMiddleware');

// Role check middleware: Allow BOTH Master Admin and Super Admin
const superAdminOrMaster = (req, res, next) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'master_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Administrator role required.' });
  }
  next();
};

// Role check middleware: Master Admin ONLY
const masterAdminOnly = (req, res, next) => {
  if (req.user.role !== 'master_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Master Admin role required.' });
  }
  next();
};

// Protect all endpoints
router.use(authMiddleware);

// ==========================================
// SHARED ENDPOINTS (Super Admin & Master Admin)
// ==========================================
router.post('/gyms', superAdminOrMaster, superController.createGymOwner);
router.get('/gyms', superAdminOrMaster, superController.getGyms);
router.post('/adjust-days', superAdminOrMaster, superController.adjustDays);
router.post('/adjust-grace-days', superAdminOrMaster, superController.adjustGraceDays);
router.get('/receipts', superAdminOrMaster, superController.getPendingReceipts);
router.post('/verify-receipt', superAdminOrMaster, superController.verifyReceipt);

// ==========================================
// MASTER ADMIN ONLY ENDPOINTS
// ==========================================
// Gym Management
router.put('/gyms/:gymId', masterAdminOnly, superController.updateGymOwner);
router.delete('/gyms/:gymId', masterAdminOnly, superController.deleteGymOwner);

// Earnings & History
router.get('/earnings', masterAdminOnly, superController.getSaaSEarnings);

// Settings (Dynamic Payments)
router.get('/settings', masterAdminOnly, superController.getAppSettings);
router.put('/settings', masterAdminOnly, superController.updateAppSettings);

// Audit Logs
router.get('/audit-logs', masterAdminOnly, superController.getAuditLogs);
router.delete('/audit-logs', masterAdminOnly, superController.clearAuditLogs);

// Master Credentials Update
router.put('/credentials', masterAdminOnly, superController.updateMasterCredentials);

// Manager (Super Admin) Accounts Management
router.get('/managers', masterAdminOnly, superController.getManagers);
router.post('/managers', masterAdminOnly, superController.createManager);
router.put('/managers/:id', masterAdminOnly, superController.updateManager);
router.delete('/managers/:id', masterAdminOnly, superController.deleteManager);

module.exports = router;
