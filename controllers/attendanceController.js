const { pool } = require('../config/db');
const { io } = require('../server'); // for real-time events if needed

// 1. GET /api/attendance/snapshot (For offline sync)
exports.getSnapshot = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    
    // Get all active members for this gym
    const [members] = await pool.query(
      `SELECT id, member_custom_id, name, phone, expiry_date, status, photo_base64 
       FROM members 
       WHERE gym_id = ? AND status = 'active'`,
      [gymId]
    );

    res.json({ success: true, members });
  } catch (error) {
    console.error('[Attendance] Snapshot error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Helper to get reset window
const getResetWindow = (checkDate, resetTimeString) => {
  if (!resetTimeString) resetTimeString = '00:00';
  const [resetH, resetM] = resetTimeString.split(':').map(Number);
  const checkTime = checkDate.getHours() * 60 + checkDate.getMinutes();
  const resetTime = resetH * 60 + resetM;

  const windowStart = new Date(checkDate);
  windowStart.setHours(resetH, resetM, 0, 0);

  if (checkTime >= resetTime) {
    // Window is today reset_time to tomorrow reset_time
  } else {
    // Window is yesterday reset_time to today reset_time
    windowStart.setDate(windowStart.getDate() - 1);
  }
  
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 1);

  return { windowStart, windowEnd };
};

// 2. POST /api/attendance/mark (Real-time check-in)
exports.markAttendance = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { member_id, method, check_in_time } = req.body;

    if (!member_id || !method) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Check if member belongs to gym
    const [memberRows] = await pool.query(
      `SELECT * FROM members WHERE id = ? AND gym_id = ?`,
      [member_id, gymId]
    );

    if (memberRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const [gymRows] = await pool.query('SELECT daily_reset_time FROM gyms WHERE id = ?', [gymId]);
    const resetTimeStr = gymRows.length > 0 ? gymRows[0].daily_reset_time : '00:00';

    const checkDate = check_in_time ? new Date(check_in_time) : new Date();
    const { windowStart, windowEnd } = getResetWindow(checkDate, resetTimeStr);

    const [existing] = await pool.query(
      `SELECT id FROM attendance_logs 
       WHERE member_id = ? AND check_in_time >= ? AND check_in_time < ?`,
      [member_id, windowStart, windowEnd]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Already checked in today' });
    }

    await pool.query(
      `INSERT INTO attendance_logs (gym_id, member_id, check_in_time, method, sync_status) 
       VALUES (?, ?, ?, ?, 'synced')`,
      [gymId, member_id, checkDate, method]
    );

    res.json({ success: true, message: 'Attendance marked' });
  } catch (error) {
    console.error('[Attendance] Mark error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 3. POST /api/attendance/bulk-sync (Offline batch sync)
exports.bulkSync = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { logs } = req.body; // array of { member_id, method, check_in_time, offline_uuid }

    if (!logs || !Array.isArray(logs)) {
      return res.status(400).json({ success: false, message: 'Invalid logs payload' });
    }

    const [gymRows] = await pool.query('SELECT daily_reset_time FROM gyms WHERE id = ?', [gymId]);
    const resetTimeStr = gymRows.length > 0 ? gymRows[0].daily_reset_time : '00:00';

    let syncedCount = 0;
    
    for (const log of logs) {
      try {
        // Prevent duplicates using offline_uuid
        const [existing] = await pool.query(
          `SELECT id FROM attendance_logs WHERE offline_uuid = ?`,
          [log.offline_uuid]
        );

        if (existing.length === 0) {
          const scanTime = log.check_in_time ? new Date(log.check_in_time) : new Date();
          const { windowStart, windowEnd } = getResetWindow(scanTime, resetTimeStr);
          
          const [dailyCheck] = await pool.query(
            `SELECT id FROM attendance_logs WHERE member_id = ? AND check_in_time >= ? AND check_in_time < ?`,
            [log.member_id, windowStart, windowEnd]
          );

          if (dailyCheck.length === 0) {
            await pool.query(
              `INSERT INTO attendance_logs (gym_id, member_id, check_in_time, method, sync_status, offline_uuid) 
               VALUES (?, ?, ?, ?, 'synced', ?)`,
              [gymId, log.member_id, scanTime, log.method, log.offline_uuid]
            );
            syncedCount++;
          }
        }
      } catch (err) {
        console.error(`[Attendance] Failed to sync log for UUID ${log.offline_uuid}:`, err);
      }
    }

    res.json({ success: true, synced_count: syncedCount });
  } catch (error) {
    console.error('[Attendance] Bulk sync error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 4. GET /api/attendance/reports
exports.getReports = async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT a.id, a.check_in_time, a.method, m.name as member_name, m.member_custom_id
      FROM attendance_logs a
      JOIN members m ON a.member_id = m.id
      WHERE a.gym_id = ?
    `;
    const params = [gymId];

    if (start_date && end_date) {
      query += ` AND DATE(a.check_in_time) BETWEEN ? AND ?`;
      params.push(start_date, end_date);
    } else {
      // Default to today
      query += ` AND DATE(a.check_in_time) = CURDATE()`;
    }

    query += ` ORDER BY a.check_in_time DESC`;

    const [logs] = await pool.query(query, params);

    res.json({ success: true, logs });
  } catch (error) {
    console.error('[Attendance] Reports error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 5. POST /api/attendance/manual-reset — Manually clear today's check-in window
exports.manualResetAttendance = async (req, res) => {
  try {
    const gymId = req.user.gymId;

    // Get the gym's daily reset time
    const [gymRows] = await pool.query('SELECT daily_reset_time FROM gyms WHERE id = ?', [gymId]);
    const resetTimeStr = gymRows.length > 0 ? gymRows[0].daily_reset_time : '00:00';
    const { windowStart, windowEnd } = getResetWindow(new Date(), resetTimeStr);

    // Delete all attendance logs in the current window for this gym
    const [result] = await pool.query(
      `DELETE FROM attendance_logs WHERE gym_id = ? AND check_in_time >= ? AND check_in_time < ?`,
      [gymId, windowStart, windowEnd]
    );

    res.json({ success: true, message: `Attendance reset. ${result.affectedRows} check-in(s) cleared.` });
  } catch (error) {
    console.error('[Attendance] Manual reset error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
