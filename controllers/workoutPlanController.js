const { pool } = require('../config/db');

// ============================================================
// NAMED WORKOUT PLANS (Gym Owner creates plans like "Beginner Chest")
// ============================================================

// 1. GET /api/workout-plan/plans  — List all named plans for this gym
exports.getPlans = async (req, res) => {
  try {
    const gymId = req.user.gymId;

    const [plans] = await pool.query(
      `SELECT wp.id, wp.name, wp.description, wp.is_global, wp.created_at,
              COUNT(wpi.id) as exercise_count
       FROM workout_plans wp
       LEFT JOIN workout_plan_items wpi ON wpi.plan_id = wp.id
       WHERE wp.gym_id = ?
       GROUP BY wp.id
       ORDER BY wp.created_at DESC`,
      [gymId]
    );

    res.json({ success: true, plans });
  } catch (error) {
    console.error('[Workout Plan] Get plans error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 2. POST /api/workout-plan/plans  — Create a new named plan
exports.createPlan = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { name, description, is_global } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Plan name is required' });
    }

    const [result] = await pool.query(
      `INSERT INTO workout_plans (gym_id, name, description, is_global) VALUES (?, ?, ?, ?)`,
      [gymId, name.trim(), description || '', is_global ? 1 : 0]
    );

    res.json({ success: true, message: 'Plan created', id: result.insertId });
  } catch (error) {
    console.error('[Workout Plan] Create plan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 3. DELETE /api/workout-plan/plans/:planId  — Delete a named plan
exports.deletePlan = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { planId } = req.params;

    await pool.query(`DELETE FROM workout_plans WHERE id = ? AND gym_id = ?`, [planId, gymId]);

    res.json({ success: true, message: 'Plan deleted' });
  } catch (error) {
    console.error('[Workout Plan] Delete plan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 3b. PATCH /api/workout-plan/plans/:planId/toggle-global  — Toggle global flag
exports.toggleGlobalPlan = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { planId } = req.params;

    // Get current value
    const [rows] = await pool.query(`SELECT is_global FROM workout_plans WHERE id = ? AND gym_id = ?`, [planId, gymId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Plan not found' });

    const newVal = rows[0].is_global === 1 ? 0 : 1;
    await pool.query(`UPDATE workout_plans SET is_global = ? WHERE id = ? AND gym_id = ?`, [newVal, planId, gymId]);

    res.json({ success: true, is_global: newVal });
  } catch (error) {
    console.error('[Workout Plan] Toggle global error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 4. GET /api/workout-plan/plans/:planId/exercises  — Get exercises in a plan
exports.getPlanExercises = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { planId } = req.params;

    const [exercises] = await pool.query(
      `SELECT wpi.id, wpi.exercise_id, wpi.sets, wpi.reps, wpi.order_index,
              e.name, e.category, e.equipment, e.gif_path, e.instructions_en
       FROM workout_plan_items wpi
       JOIN exercises e ON wpi.exercise_id = e.id
       JOIN workout_plans wp ON wp.id = wpi.plan_id AND wp.gym_id = ?
       WHERE wpi.plan_id = ?
       ORDER BY wpi.order_index ASC`,
      [gymId, planId]
    );

    res.json({ success: true, exercises });
  } catch (error) {
    console.error('[Workout Plan] Get plan exercises error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 5. POST /api/workout-plan/plans/:planId/exercises  — Add exercise to a plan
exports.addExerciseToPlan = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { planId } = req.params;
    const { exercise_id, sets, reps } = req.body;

    if (!exercise_id) {
      return res.status(400).json({ success: false, message: 'Exercise ID required' });
    }

    // Verify plan belongs to this gym
    const [plans] = await pool.query(`SELECT id FROM workout_plans WHERE id = ? AND gym_id = ?`, [planId, gymId]);
    if (plans.length === 0) return res.status(404).json({ success: false, message: 'Plan not found' });

    const [orderRows] = await pool.query(`SELECT MAX(order_index) as maxOrder FROM workout_plan_items WHERE plan_id = ?`, [planId]);
    const newOrder = (orderRows[0].maxOrder || 0) + 1;

    const [result] = await pool.query(
      `INSERT INTO workout_plan_items (plan_id, exercise_id, sets, reps, order_index) VALUES (?, ?, ?, ?, ?)`,
      [planId, exercise_id, sets || 3, reps || 12, newOrder]
    );

    res.json({ success: true, message: 'Exercise added to plan', id: result.insertId });
  } catch (error) {
    console.error('[Workout Plan] Add to plan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 6. DELETE /api/workout-plan/plans/:planId/exercises/:itemId
exports.removeExerciseFromPlan = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { planId, itemId } = req.params;

    await pool.query(
      `DELETE wpi FROM workout_plan_items wpi
       JOIN workout_plans wp ON wp.id = wpi.plan_id AND wp.gym_id = ?
       WHERE wpi.id = ? AND wpi.plan_id = ?`,
      [gymId, itemId, planId]
    );

    res.json({ success: true, message: 'Exercise removed' });
  } catch (error) {
    console.error('[Workout Plan] Remove from plan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// MEMBER PLAN ASSIGNMENT
// ============================================================

// 7. POST /api/workout-plan/assign  — Assign a named plan to a member
exports.assignPlanToMember = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { member_id, plan_id } = req.body;

    if (!member_id || !plan_id) {
      return res.status(400).json({ success: false, message: 'member_id and plan_id are required' });
    }

    // Verify member belongs to this gym
    const [members] = await pool.query(`SELECT id FROM members WHERE id = ? AND gym_id = ?`, [member_id, gymId]);
    if (members.length === 0) return res.status(404).json({ success: false, message: 'Member not found' });

    // Remove existing assignment and replace (one plan per member)
    await pool.query(`DELETE FROM member_workout_plans WHERE member_id = ? AND gym_id = ?`, [member_id, gymId]);
    await pool.query(
      `INSERT INTO member_workout_plans (gym_id, member_id, plan_id) VALUES (?, ?, ?)`,
      [gymId, member_id, plan_id]
    );

    res.json({ success: true, message: 'Plan assigned to member' });
  } catch (error) {
    console.error('[Workout Plan] Assign plan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 8. DELETE /api/workout-plan/assign/:memberId  — Unassign plan from member
exports.unassignPlanFromMember = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { memberId } = req.params;

    await pool.query(`DELETE FROM member_workout_plans WHERE member_id = ? AND gym_id = ?`, [memberId, gymId]);

    res.json({ success: true, message: 'Plan unassigned' });
  } catch (error) {
    console.error('[Workout Plan] Unassign plan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 9. GET /api/workout-plan/assign/:memberId — Get plan assigned to a member
exports.getMemberAssignment = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { memberId } = req.params;

    const [rows] = await pool.query(
      `SELECT mwp.plan_id, wp.name as plan_name 
       FROM member_workout_plans mwp
       JOIN workout_plans wp ON wp.id = mwp.plan_id
       WHERE mwp.member_id = ? AND mwp.gym_id = ?`,
      [memberId, gymId]
    );

    res.json({ success: true, assignment: rows[0] || null });
  } catch (error) {
    console.error('[Workout Plan] Get assignment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// MEMBER PORTAL — What exercises does the logged-in member see?
// ============================================================

// 10. GET /api/workout-plan/member/me  — Used by MemberApp to fetch their plans
exports.getMemberPlanForPortal = async (req, res) => {
  try {
    const memberId = req.member.memberId;
    const gymId = req.member.gymId;

    // Fetch explicitly assigned plans
    const [assignments] = await pool.query(
      `SELECT mwp.plan_id as id, wp.name as name
       FROM member_workout_plans mwp
       JOIN workout_plans wp ON wp.id = mwp.plan_id
       WHERE mwp.member_id = ? AND mwp.gym_id = ?`,
      [memberId, gymId]
    );

    // Fetch all global plans
    const [globalPlans] = await pool.query(
      `SELECT id, name FROM workout_plans WHERE gym_id = ? AND is_global = 1`,
      [gymId]
    );

    // Combine uniquely by plan ID
    const planMap = new Map();
    [...assignments, ...globalPlans].forEach(p => {
      planMap.set(p.id, p);
    });

    let plansData = [];

    for (const plan of planMap.values()) {
      const [exercises] = await pool.query(
        `SELECT wpi.id, wpi.exercise_id, wpi.sets, wpi.reps, wpi.order_index,
                e.name, e.category, e.equipment, e.gif_path, e.instructions_en
         FROM workout_plan_items wpi
         JOIN exercises e ON wpi.exercise_id = e.id
         WHERE wpi.plan_id = ?
         ORDER BY wpi.order_index ASC`,
        [plan.id]
      );
      
      plansData.push({
        plan_id: plan.id,
        plan_name: plan.name,
        exercises
      });
    }

    res.json({ success: true, plans: plansData });
  } catch (error) {
    console.error('[Workout Plan] Member portal plan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

