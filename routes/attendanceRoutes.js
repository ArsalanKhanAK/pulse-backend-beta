const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const requireAuth = require('../middleware/authMiddleware');

router.get('/snapshot', requireAuth, attendanceController.getSnapshot);
router.post('/mark', requireAuth, attendanceController.markAttendance);
router.post('/bulk-sync', requireAuth, attendanceController.bulkSync);
router.get('/reports', requireAuth, attendanceController.getReports);
router.post('/manual-reset', requireAuth, attendanceController.manualResetAttendance);

module.exports = router;
