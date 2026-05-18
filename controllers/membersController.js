const { pool } = require('../config/db');

// 1. Get Scoped Members with Search and Advanced Filters (Active, Expired, Disabled/Left)
exports.getMembers = async (req, res) => {
  const gymId = req.user.gym_id;
  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    const { search, status, fee_status } = req.query;
    
    // Scoped to the logged-in Gym's ID
    let query = 'SELECT * FROM members WHERE gym_id = ?';
    const params = [gymId];

    // Search by Name, Phone, or custom Member ID
    if (search) {
      query += ' AND (name LIKE ? OR phone LIKE ? OR member_custom_id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Filter by Advanced Membership Statuses
    if (status) {
      const today = new Date().toISOString().slice(0, 10);
      if (status === 'active') {
        // Active and NOT expired
        query += ' AND status = "active" AND expiry_date >= ?';
        params.push(today);
      } else if (status === 'expired') {
        // Active but EXPIRED
        query += ' AND status = "active" AND expiry_date < ?';
        params.push(today);
      } else if (status === 'left') {
        // Disabled / Left member category
        query += ' AND status = "left"';
      }
    }

    // Filter by Fee Status
    if (fee_status) {
      query += ' AND fee_status = ?';
      params.push(fee_status);
    }

    query += ' ORDER BY id DESC';

    const [rows] = await pool.query(query, params);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('[Members Controller] getMembers error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 2. Get Single Scoped Member Details
exports.getMemberById = async (req, res) => {
  const { id } = req.params;
  const gymId = req.user.gym_id;

  try {
    const [rows] = await pool.query('SELECT * FROM members WHERE id = ? AND gym_id = ?', [id, gymId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[Members Controller] getMemberById error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 3. Create Scoped Member with Custom ID
exports.createMember = async (req, res) => {
  const { name, phone, start_date, expiry_date, fee_status, member_custom_id, status } = req.body;
  const gymId = req.user.gym_id;

  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  if (!name || !phone || !start_date || !expiry_date || !fee_status || !member_custom_id) {
    return res.status(400).json({ success: false, message: 'Please fill in all required fields, including Member ID.' });
  }

  try {
    // Check if member ID is unique within this specific gym
    const [existing] = await pool.query(
      'SELECT id FROM members WHERE member_custom_id = ? AND gym_id = ?',
      [member_custom_id, gymId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'This Member ID is already assigned in your gym.' });
    }

    const [result] = await pool.query(
      `INSERT INTO members (gym_id, member_custom_id, name, phone, start_date, expiry_date, fee_status, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [gymId, member_custom_id, name, phone, start_date, expiry_date, fee_status, status || 'active']
    );

    const [newMember] = await pool.query('SELECT * FROM members WHERE id = ?', [result.insertId]);

    return res.status(201).json({
      success: true,
      message: 'Member added successfully.',
      data: newMember[0]
    });
  } catch (error) {
    console.error('[Members Controller] createMember error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 4. Update Scoped Member
exports.updateMember = async (req, res) => {
  const { id } = req.params;
  const { name, phone, start_date, expiry_date, fee_status, member_custom_id, status } = req.body;
  const gymId = req.user.gym_id;

  if (!name || !phone || !start_date || !expiry_date || !fee_status || !member_custom_id) {
    return res.status(400).json({ success: false, message: 'Please fill in all required fields, including Member ID.' });
  }

  try {
    // Ensure member belongs to this gym
    const [check] = await pool.query('SELECT * FROM members WHERE id = ? AND gym_id = ?', [id, gymId]);
    if (check.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    // Check if updated member ID clashes with another member in this gym
    const [clash] = await pool.query(
      'SELECT id FROM members WHERE member_custom_id = ? AND gym_id = ? AND id != ?',
      [member_custom_id, gymId, id]
    );
    if (clash.length > 0) {
      return res.status(400).json({ success: false, message: 'This Member ID is already in use by another subscriber.' });
    }

    await pool.query(
      `UPDATE members 
       SET name = ?, phone = ?, start_date = ?, expiry_date = ?, fee_status = ?, member_custom_id = ?, status = ? 
       WHERE id = ? AND gym_id = ?`,
      [name, phone, start_date, expiry_date, fee_status, member_custom_id, status || 'active', id, gymId]
    );

    const [updatedMember] = await pool.query('SELECT * FROM members WHERE id = ?', [id]);

    return res.status(200).json({
      success: true,
      message: 'Member updated successfully.',
      data: updatedMember[0]
    });
  } catch (error) {
    console.error('[Members Controller] updateMember error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 5. Delete Scoped Member
exports.deleteMember = async (req, res) => {
  const { id } = req.params;
  const gymId = req.user.gym_id;

  try {
    const [check] = await pool.query('SELECT * FROM members WHERE id = ? AND gym_id = ?', [id, gymId]);
    if (check.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    await pool.query('DELETE FROM members WHERE id = ? AND gym_id = ?', [id, gymId]);
    return res.status(200).json({ success: true, message: 'Member deleted successfully.' });
  } catch (error) {
    console.error('[Members Controller] deleteMember error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 6. Get Scoped Dashboard Statistics
exports.getStats = async (req, res) => {
  const gymId = req.user.gym_id;

  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Total Members registered in this gym (active and left)
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM members WHERE gym_id = ?', [gymId]);

    // Active Members (status = active AND expiry_date >= today)
    const [[{ active }]] = await pool.query(
      'SELECT COUNT(*) as active FROM members WHERE gym_id = ? AND status = "active" AND expiry_date >= ?', 
      [gymId, today]
    );

    // Expired Members (status = active AND expiry_date < today)
    const [[{ expired }]] = await pool.query(
      'SELECT COUNT(*) as expired FROM members WHERE gym_id = ? AND status = "active" AND expiry_date < ?', 
      [gymId, today]
    );

    // Disabled / Left Members (status = left)
    const [[{ leftCount }]] = await pool.query(
      'SELECT COUNT(*) as leftCount FROM members WHERE gym_id = ? AND status = "left"',
      [gymId]
    );

    // Fee unpaid active members
    const [[{ unpaidFees }]] = await pool.query(
      'SELECT COUNT(*) as unpaidFees FROM members WHERE gym_id = ? AND status = "active" AND fee_status = "Unpaid"',
      [gymId]
    );

    // Fee paid active members
    const [[{ paidFees }]] = await pool.query(
      'SELECT COUNT(*) as paidFees FROM members WHERE gym_id = ? AND status = "active" AND fee_status = "Paid"',
      [gymId]
    );

    return res.status(200).json({
      success: true,
      stats: {
        total,
        active,
        expired,
        leftCount,
        unpaidFees,
        paidFees
      }
    });
  } catch (error) {
    console.error('[Members Controller] getStats error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 7. Renew a Member (Plan or Manual) and log earnings
exports.renewMember = async (req, res) => {
  const { memberId, planId, manualAmount, manualMonths, customExpiryDate, admissionFee } = req.body;
  const gymId = req.user.gym_id;

  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  if (!memberId) {
    return res.status(400).json({ success: false, message: 'Member ID is required.' });
  }

  try {
    // 1. Fetch member details
    const [memberRows] = await pool.query('SELECT * FROM members WHERE id = ? AND gym_id = ?', [memberId, gymId]);
    if (memberRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }
    const member = memberRows[0];

    let amount = 0;
    let monthsToExtend = 1;
    let finalExpiryDate = null;
    let paymentType = 'manual';
    let chosenPlanId = null;

    // Calculate dynamic start date: if current expiry is in future, extend from it. Otherwise, extend from today.
    const today = new Date();
    const currentExpiry = member.expiry_date ? new Date(member.expiry_date) : today;
    let startDate = currentExpiry > today ? currentExpiry : today;

    if (planId) {
      // 2. Fetch plan details
      const [planRows] = await pool.query('SELECT * FROM membership_plans WHERE id = ? AND gym_id = ?', [planId, gymId]);
      if (planRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Selected plan not found.' });
      }
      const plan = planRows[0];
      amount = parseFloat(plan.price) + parseFloat(plan.admission_fee || 0);
      monthsToExtend = plan.duration_months;
      paymentType = 'plan';
      chosenPlanId = plan.id;

      const newExpiry = new Date(startDate);
      newExpiry.setMonth(newExpiry.getMonth() + monthsToExtend);
      finalExpiryDate = newExpiry.toISOString().slice(0, 10);
    } else {
      // 3. Fallback to manual
      if (manualAmount === undefined) {
        return res.status(400).json({ success: false, message: 'Plan ID or manual amount is required.' });
      }
      amount = parseFloat(manualAmount) + parseFloat(admissionFee || 0);
      paymentType = 'manual';

      if (customExpiryDate) {
        finalExpiryDate = customExpiryDate;
      } else {
        monthsToExtend = parseInt(manualMonths || 1, 10);
        const newExpiry = new Date(startDate);
        newExpiry.setMonth(newExpiry.getMonth() + monthsToExtend);
        finalExpiryDate = newExpiry.toISOString().slice(0, 10);
      }
    }

    // 4. Update member's expiry date, fee_status to 'Paid', and status to 'active'
    const todayStr = today.toISOString().slice(0, 10);
    await pool.query(
      `UPDATE members 
       SET expiry_date = ?, fee_status = 'Paid', status = 'active', start_date = ? 
       WHERE id = ?`,
      [finalExpiryDate, todayStr, memberId]
    );

    // 5. Insert renewal history record
    await pool.query(
      `INSERT INTO member_renewals (member_id, gym_id, plan_id, amount, expiry_date, payment_type) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [memberId, gymId, chosenPlanId, amount, finalExpiryDate, paymentType]
    );

    return res.status(200).json({
      success: true,
      message: 'Member renewed successfully!',
      data: {
        new_expiry: finalExpiryDate,
        amount_collected: amount
      }
    });
  } catch (error) {
    console.error('[Members Controller] renewMember error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// 8. Get Gym Monthly Earnings Analytics (scoped to Gym Admin)
exports.getEarnings = async (req, res) => {
  const gymId = req.user.gym_id;

  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    // 1. Fetch dynamic monthly sums
    const [monthlyEarnings] = await pool.query(
      `SELECT 
        DATE_FORMAT(renewal_date, '%Y-%m') AS month_key,
        DATE_FORMAT(renewal_date, '%M %Y') AS month_label,
        SUM(amount) AS total
       FROM member_renewals
       WHERE gym_id = ?
       GROUP BY month_key, month_label
       ORDER BY month_key DESC`,
      [gymId]
    );

    // 2. Fetch recent renewal transactions
    const [recentRenewals] = await pool.query(
      `SELECT r.*, m.name AS member_name, m.member_custom_id, p.name AS plan_name
       FROM member_renewals r
       JOIN members m ON r.member_id = m.id
       LEFT JOIN membership_plans p ON r.plan_id = p.id
       WHERE r.gym_id = ?
       ORDER BY r.id DESC
       LIMIT 100`,
      [gymId]
    );

    return res.status(200).json({
      success: true,
      data: {
        monthlyEarnings,
        recentRenewals
      }
    });
  } catch (error) {
    console.error('[Members Controller] getEarnings error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
