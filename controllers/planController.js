const { pool } = require('../config/db');

// Get all membership plans for active Gym
exports.getPlans = async (req, res) => {
  const gymId = req.user.gym_id;
  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM membership_plans WHERE gym_id = ? ORDER BY id DESC', [gymId]);
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[Plan Controller] getPlans error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Create new membership plan
exports.createPlan = async (req, res) => {
  const gymId = req.user.gym_id;
  const { name, price, duration_months, admission_fee, description } = req.body;

  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  if (!name || price === undefined || !duration_months) {
    return res.status(400).json({ success: false, message: 'Name, price and duration are required.' });
  }

  try {
    await pool.query(
      `INSERT INTO membership_plans (gym_id, name, price, duration_months, admission_fee, description) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [gymId, name, price, duration_months, admission_fee || 0.00, description || '']
    );

    return res.status(201).json({ success: true, message: 'Plan created successfully.' });
  } catch (error) {
    console.error('[Plan Controller] createPlan error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Update an existing membership plan
exports.updatePlan = async (req, res) => {
  const { id } = req.params;
  const gymId = req.user.gym_id;
  const { name, price, duration_months, admission_fee, description } = req.body;

  if (!name || price === undefined || !duration_months) {
    return res.status(400).json({ success: false, message: 'Name, price and duration are required.' });
  }

  try {
    const [check] = await pool.query('SELECT id FROM membership_plans WHERE id = ? AND gym_id = ?', [id, gymId]);
    if (check.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }

    await pool.query(
      `UPDATE membership_plans 
       SET name = ?, price = ?, duration_months = ?, admission_fee = ?, description = ? 
       WHERE id = ? AND gym_id = ?`,
      [name, price, duration_months, admission_fee || 0.00, description || '', id, gymId]
    );

    return res.status(200).json({ success: true, message: 'Plan updated successfully.' });
  } catch (error) {
    console.error('[Plan Controller] updatePlan error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Delete membership plan
exports.deletePlan = async (req, res) => {
  const { id } = req.params;
  const gymId = req.user.gym_id;

  try {
    const [check] = await pool.query('SELECT id FROM membership_plans WHERE id = ? AND gym_id = ?', [id, gymId]);
    if (check.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }

    await pool.query('DELETE FROM membership_plans WHERE id = ? AND gym_id = ?', [id, gymId]);
    return res.status(200).json({ success: true, message: 'Plan deleted successfully.' });
  } catch (error) {
    console.error('[Plan Controller] deletePlan error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
