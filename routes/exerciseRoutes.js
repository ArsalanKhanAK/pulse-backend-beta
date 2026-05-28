const express = require('express');
const router = express.Router();
const exerciseController = require('../controllers/exerciseController');
const requireAuth = require('../middleware/authMiddleware');

router.get('/categories', requireAuth, exerciseController.getCategories);
router.get('/', requireAuth, exerciseController.getExercises);

module.exports = router;
