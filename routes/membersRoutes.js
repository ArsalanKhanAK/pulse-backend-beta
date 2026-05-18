const express = require('express');
const router = express.Router();
const membersController = require('../controllers/membersController');
const authMiddleware = require('../middleware/authMiddleware');

// Protect all gym membership operations
router.use(authMiddleware);

// Get Dashboard Statistics
router.get('/stats', membersController.getStats);

// Members CRUD & Actions Routes
router.get('/earnings', membersController.getEarnings);
router.post('/renew', membersController.renewMember);

router.get('/', membersController.getMembers);
router.get('/:id', membersController.getMemberById);
router.post('/', membersController.createMember);
router.put('/:id', membersController.updateMember);
router.delete('/:id', membersController.deleteMember);

module.exports = router;
