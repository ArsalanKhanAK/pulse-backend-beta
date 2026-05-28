const express = require('express');
const router = express.Router();
const c = require('../controllers/workoutPlanController');
const requireAuth = require('../middleware/authMiddleware');
const { requireMemberAuth } = require('../controllers/memberPortalController');

// ---------- Middleware to handle both admin & member tokens ----------
const tryAdminAuth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) {
    const jwt = require('jsonwebtoken');
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gym_management_super_secret_jwt_key_2026');
      if (decoded.role === 'member') {
        req.member = decoded;
      } else {
        req.user = decoded;
      }
    } catch(e) {}
  }
  if (!req.member && !req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  next();
};

// ---------- Named Workout Plans (Admin only) ----------
router.get('/plans', requireAuth, c.getPlans);
router.post('/plans', requireAuth, c.createPlan);
router.delete('/plans/:planId', requireAuth, c.deletePlan);
router.patch('/plans/:planId/toggle-global', requireAuth, c.toggleGlobalPlan);
router.get('/plans/:planId/exercises', requireAuth, c.getPlanExercises);
router.post('/plans/:planId/exercises', requireAuth, c.addExerciseToPlan);
router.delete('/plans/:planId/exercises/:itemId', requireAuth, c.removeExerciseFromPlan);

// ---------- Member Assignment ----------
router.post('/assign', requireAuth, c.assignPlanToMember);
router.delete('/assign/:memberId', requireAuth, c.unassignPlanFromMember);
router.get('/assign/:memberId', requireAuth, c.getMemberAssignment);

// ---------- Member Portal (member token) ----------
router.get('/member/me', requireMemberAuth, c.getMemberPlanForPortal);

module.exports = router;
