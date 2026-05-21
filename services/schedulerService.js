const cron = require('node-cron');
const { pool } = require('../config/db');
const { sendBulkReminders } = require('./whatsappService');

const moment = require('moment-timezone');

function initializeScheduler() {
  console.log('[Scheduler] SaaS Multi-Gym Scheduler service initialized.');
  console.log('[Scheduler] Minutely cron started for custom Auto-Sender and Daily Checks.');

  // Cron schedule: '* * * * *' executes every minute.
  const minutelyJob = cron.schedule('* * * * *', async () => {
    try {
      const nowPKT = moment().tz('Asia/Karachi');
      const currentTimeStr = nowPKT.format('HH:mm');

      // TASK A & B: Run global auditing ONCE a day at exactly 09:00 PKT
      if (currentTimeStr === '09:00') {
        console.log('[Scheduler] 09:00 AM PKT Triggered: Starting daily system auditing...');
        
        // TASK A: Auditing SaaS Gym Admin Subscriptions
        const [expiredGyms] = await pool.query(`
          SELECT id, username, subscription_expires_at 
          FROM users 
          WHERE role = 'gym_admin' AND status = 'active' AND subscription_expires_at < NOW()
        `);
        
        for (const gymAdmin of expiredGyms) {
          console.log(`[Scheduler] Gym Admin '${gymAdmin.username}' subscription expired. Moving to grace period.`);
          await pool.query(`
            UPDATE users 
            SET status = 'suspended', grace_period_expires_at = DATE_ADD(NOW(), INTERVAL 3 DAY)
            WHERE id = ?
          `, [gymAdmin.id]);
        }

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

        // TASK B: Autoclassify expired gym members to 'left' based on gym's custom disable_days limit
        console.log('[Scheduler] Auditing expired member tenures (Custom disable limits)...');
        const [memberLeftResult] = await pool.query(`
          UPDATE members m
          JOIN gyms g ON m.gym_id = g.id
          SET m.status = 'left' 
          WHERE m.status = 'active' AND DATEDIFF(CURDATE(), m.expiry_date) >= g.disable_days
        `);
        
        if (memberLeftResult.affectedRows > 0) {
          console.log(`[Scheduler] Moved ${memberLeftResult.affectedRows} members to 'left' category (disabled status).`);
        }
      }

      // TASK C: Run Automated WhatsApp billing reminders per gym based on their custom auto_sender_time
      const [gymsToNotify] = await pool.query(`
         SELECT id, name FROM gyms 
         WHERE auto_sender_enabled = 1 AND auto_sender_time = ?
      `, [currentTimeStr]);

      if (gymsToNotify.length > 0) {
         console.log(`[Scheduler] Dispatching automated WhatsApp billing alerts for ${gymsToNotify.length} gyms at ${currentTimeStr} PKT...`);
         for (const gym of gymsToNotify) {
            console.log(`[Scheduler] Running reminder job for Gym #${gym.id} (${gym.name})...`);
            await sendBulkReminders(gym.id);
         }
      }

    } catch (error) {
      console.error('[Scheduler] Critical error in minutely scheduler auditing loop:', error.message);
    }
  }, {
    scheduled: true
  });

  return minutelyJob;
}

module.exports = {
  initializeScheduler
};
