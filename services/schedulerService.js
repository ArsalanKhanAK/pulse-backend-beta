const cron = require('node-cron');
const { pool } = require('../config/db');
const { sendBulkReminders } = require('./whatsappService');

function initializeScheduler() {
  console.log('[Scheduler] SaaS Multi-Gym Scheduler service initialized.');
  console.log('[Scheduler] Expiry checks and reminders scheduled to run daily at 9:00 AM.');

  // Cron schedule: '0 9 * * *' executes daily at exactly 9:00 AM.
  const dailyJob = cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduler] 9:00 AM Cron Triggered: Starting system auditing...');
    
    try {
      // TASK A: Auditing SaaS Gym Admin Subscriptions
      console.log('[Scheduler] Auditing Gym Owner subscriptions...');
      const now = new Date();

      // 1. Transition Active -> Suspended if expired
      const [expiredGyms] = await pool.query(`
        SELECT id, username, subscription_expires_at 
        FROM users 
        WHERE role = 'gym_admin' AND status = 'active' AND subscription_expires_at < NOW()
      `);
      
      for (const gymAdmin of expiredGyms) {
        console.log(`[Scheduler] Gym Admin '${gymAdmin.username}' subscription expired. Moving to grace period.`);
        // Set status to suspended and set 3-day grace period lock
        await pool.query(`
          UPDATE users 
          SET status = 'suspended', grace_period_expires_at = DATE_ADD(NOW(), INTERVAL 3 DAY)
          WHERE id = ?
        `, [gymAdmin.id]);
      }

      // 2. Transition Suspended -> Banned if grace period expired without payment approval
      const [bannedGyms] = await pool.query(`
        SELECT id, username 
        FROM users 
        WHERE role = 'gym_admin' AND status = 'suspended' AND grace_period_expires_at < NOW()
      `);

      for (const gymAdmin of bannedGyms) {
        console.log(`[Scheduler] Grace period expired for Gym Admin '${gymAdmin.username}'. Banning account.`);
        await pool.query(`
          UPDATE users 
          SET status = 'banned'
          WHERE id = ?
        `, [gymAdmin.id]);
      }

      // TASK B: Autoclassify expired gym members to 'left' after 15 days of outstanding renewals
      console.log('[Scheduler] Auditing expired member tenures (15-day renewals limit)...');
      const [memberLeftResult] = await pool.query(`
        UPDATE members 
        SET status = 'left' 
        WHERE status = 'active' AND expiry_date < DATE_SUB(CURDATE(), INTERVAL 15 DAY)
      `);
      if (memberLeftResult.affectedRows > 0) {
        console.log(`[Scheduler] Moved ${memberLeftResult.affectedRows} members to 'left' category (disabled status).`);
      }

      // TASK C: Run Automated WhatsApp billing reminders for active outstanding expired members
      console.log('[Scheduler] Dispatching automated WhatsApp billing alerts to active expired members...');
      const reminderResults = await sendBulkReminders();
      console.log('[Scheduler] Bulk automated reminders check complete:', reminderResults);

    } catch (error) {
      console.error('[Scheduler] Critical error in daily scheduler auditing loop:', error.message);
    }
  }, {
    scheduled: true
  });

  return dailyJob;
}

module.exports = {
  initializeScheduler
};
