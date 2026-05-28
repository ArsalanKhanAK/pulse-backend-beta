const { pool } = require('../config/db');

// 1. GET /api/exercises/categories
exports.getCategories = async (req, res) => {
  try {
    const gymId = req.user.gymId;

    // Get categories directly from exercises table group by category
    const [rows] = await pool.query(
      `SELECT category as name, COUNT(id) as count 
       FROM exercises 
       GROUP BY category 
       ORDER BY category ASC`
    );

    res.json({ success: true, categories: rows });
  } catch (error) {
    console.error('[Exercise] Get categories error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 2. GET /api/exercises
exports.getExercises = async (req, res) => {
  try {
    const { category, search } = req.query;
    
    let query = `SELECT * FROM exercises WHERE 1=1`;
    const params = [];

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    if (search) {
      query += ` AND name LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY name ASC LIMIT 100`;

    const [exercises] = await pool.query(query, params);

    res.json({ success: true, exercises });
  } catch (error) {
    console.error('[Exercise] Get exercises error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
