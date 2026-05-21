const express = require('express');
const router = express.Router();
const membersController = require('../controllers/membersController');
const authMiddleware = require('../middleware/authMiddleware');

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Protect all gym membership operations
router.use(authMiddleware);

// Get Dashboard Statistics
router.get('/stats', membersController.getStats);

// Members CRUD & Actions Routes
router.get('/earnings', membersController.getEarnings);
router.post('/renew', membersController.renewMember);

// Excel Import/Export Routes
router.get('/export', membersController.exportMembers);
router.post('/import', upload.single('file'), membersController.importMembers);

router.get('/', membersController.getMembers);
router.get('/:id', membersController.getMemberById);
router.post('/', membersController.createMember);
router.put('/:id', membersController.updateMember);
router.delete('/:id', membersController.deleteMember);

module.exports = router;
