const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  jidNormalizedUser,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

// Multi-Device Socket Maps
const activeSockets = new Map();
const connectionStatuses = new Map(); // gymId -> status ('disconnected', 'connecting', 'qrcode', 'connected')
const currentQRs = new Map();
const currentQRDataURLs = new Map();
const reconnectAttempts = new Map();

let ioInstance = null;
const MAX_RECONNECT_ATTEMPTS = 5;

// Helper to get session directory per Gym
function getSessionDir(gymId) {
  const dir = path.join(__dirname, '..', 'session_auth', `gym_${gymId}`);
  if (!fs.existsSync(path.dirname(dir))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
  }
  return dir;
}

// Clean up session directory per Gym
function clearSession(gymId) {
  const sessionDir = getSessionDir(gymId);
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[WhatsApp - Gym ${gymId}] Session directory cleared.`);
    }
  } catch (error) {
    console.error(`[WhatsApp - Gym ${gymId}] Error clearing session directory:`, error.message);
  }
}

// Clean and format phone numbers for WhatsApp
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = '92' + cleaned.substring(1);
  }
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = cleaned + '@s.whatsapp.net';
  }
  return cleaned;
}

// Initialize and Connect WhatsApp per Gym
async function connectWhatsApp(gymId, io = null) {
  if (io) ioInstance = io;
  
  const gId = parseInt(gymId, 10);
  console.log(`[WhatsApp - Gym ${gId}] Initializing connection...`);
  connectionStatuses.set(gId, 'connecting');
  
  if (ioInstance) {
    ioInstance.emit('whatsapp_status', { gymId: gId, status: 'connecting' });
  }

  // Terminate existing socket if any is open
  if (activeSockets.has(gId)) {
    try {
      const oldSock = activeSockets.get(gId);
      oldSock.end();
    } catch (e) {}
    activeSockets.delete(gId);
  }

  try {
    const sessionDir = getSessionDir(gId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Dynamic WhatsApp Web Version query to prevent 405 WebSocket Handshake Errors
    let version = [2, 3000, 1017585554];
    try {
      const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion();
      version = latestVersion;
      console.log(`[WhatsApp - Gym ${gId}] Fetched latest WhatsApp Web version: ${version.join('.')}, isLatest: ${isLatest}`);
    } catch (err) {
      console.warn(`[WhatsApp - Gym ${gId}] Failed to query latest version from API, using fallback:`, version.join('.'), err.message);
    }

    // Create the socket connection
    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Windows', 'Chrome', '110.0.5481.177']
    });

    activeSockets.set(gId, sock);

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

    // Monitor Connection States
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQRs.set(gId, qr);
        connectionStatuses.set(gId, 'qrcode');
        try {
          const qrDataURL = await QRCode.toDataURL(qr);
          currentQRDataURLs.set(gId, qrDataURL);
          console.log(`[WhatsApp - Gym ${gId}] New QR Code generated.`);
          if (ioInstance) {
            ioInstance.emit('whatsapp_status', { gymId: gId, status: 'qrcode', qr: qrDataURL });
          }
        } catch (err) {
          console.error(`[WhatsApp - Gym ${gId}] QR generation error:`, err.message);
        }
      }

      if (connection === 'connecting') {
        connectionStatuses.set(gId, 'connecting');
        console.log(`[WhatsApp - Gym ${gId}] Connecting to WhatsApp...`);
        if (ioInstance) {
          ioInstance.emit('whatsapp_status', { gymId: gId, status: 'connecting' });
        }
      }

      if (connection === 'open') {
        connectionStatuses.set(gId, 'connected');
        currentQRs.delete(gId);
        currentQRDataURLs.delete(gId);
        reconnectAttempts.set(gId, 0);
        
        const userJid = jidNormalizedUser(sock.user.id);
        console.log(`[WhatsApp - Gym ${gId}] Connected successfully as ${userJid}`);
        
        if (ioInstance) {
          ioInstance.emit('whatsapp_status', { 
            gymId: gId,
            status: 'connected', 
            user: { id: userJid, name: sock.user.name || 'Gym Admin' } 
          });
        }
      }

      if (connection === 'close') {
        currentQRs.delete(gId);
        currentQRDataURLs.delete(gId);
        
        const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[WhatsApp - Gym ${gId}] Connection closed. Reason code: ${statusCode}, Should reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          const currentAttempts = reconnectAttempts.get(gId) || 0;
          const nextAttempt = currentAttempts + 1;
          reconnectAttempts.set(gId, nextAttempt);

          if (nextAttempt <= MAX_RECONNECT_ATTEMPTS) {
            console.log(`[WhatsApp - Gym ${gId}] Reconnecting attempt ${nextAttempt}/${MAX_RECONNECT_ATTEMPTS} in 5s...`);
            connectionStatuses.set(gId, 'connecting');
            if (ioInstance) {
              ioInstance.emit('whatsapp_status', { gymId: gId, status: 'connecting' });
            }
            setTimeout(() => connectWhatsApp(gId), 5000);
          } else {
            console.log(`[WhatsApp - Gym ${gId}] Max reconnect attempts reached. Please scan QR code again.`);
            connectionStatuses.set(gId, 'disconnected');
            if (ioInstance) {
              ioInstance.emit('whatsapp_status', { gymId: gId, status: 'disconnected' });
            }
          }
        } else {
          console.log(`[WhatsApp - Gym ${gId}] Logged out. Clearing session cache...`);
          connectionStatuses.set(gId, 'disconnected');
          clearSession(gId);
          activeSockets.delete(gId);
          if (ioInstance) {
            ioInstance.emit('whatsapp_status', { gymId: gId, status: 'disconnected' });
          }
        }
      }
    });

  } catch (error) {
    console.error(`[WhatsApp - Gym ${gId}] Critical connection error:`, error.message);
    connectionStatuses.set(gId, 'disconnected');
    if (ioInstance) {
      ioInstance.emit('whatsapp_status', { gymId: gId, status: 'disconnected' });
    }
  }
}

// Disconnect/Logout WhatsApp per Gym
async function disconnectWhatsApp(gymId) {
  const gId = parseInt(gymId, 10);
  console.log(`[WhatsApp - Gym ${gId}] Logging out...`);
  try {
    const sock = activeSockets.get(gId);
    if (sock) {
      await sock.logout().catch(() => {});
      sock.end();
      activeSockets.delete(gId);
    }
  } catch (error) {
    console.error(`[WhatsApp - Gym ${gId}] Error during socket logout:`, error.message);
  }
  clearSession(gId);
  connectionStatuses.set(gId, 'disconnected');
  currentQRs.delete(gId);
  currentQRDataURLs.delete(gId);
  if (ioInstance) {
    ioInstance.emit('whatsapp_status', { gymId: gId, status: 'disconnected' });
  }
}

// Send Single Message scoped by Gym
async function sendMessage(gymId, phone, text) {
  const gId = parseInt(gymId, 10);
  const status = connectionStatuses.get(gId) || 'disconnected';
  const sock = activeSockets.get(gId);

  if (status !== 'connected' || !sock) {
    throw new Error(`WhatsApp is not connected for Gym #${gId}. Please scan QR code first.`);
  }

  try {
    const formattedJid = formatPhoneNumber(phone);
    console.log(`[WhatsApp - Gym ${gId}] Sending message to ${formattedJid}: "${text.substring(0, 30)}..."`);
    
    const [result] = await sock.onWhatsApp(formattedJid);
    if (!result || !result.exists) {
      throw new Error(`The phone number ${phone} is not registered on WhatsApp.`);
    }

    const response = await sock.sendMessage(formattedJid, { text });
    return response;
  } catch (error) {
    console.error(`[WhatsApp - Gym ${gId}] Failed to send message to ${phone}:`, error.message);
    throw error;
  }
}

// Auto-Reboot Saved Sessions (reads local session folders and loads them)
async function resumeSessions(io) {
  ioInstance = io;
  const sessionsPath = path.join(__dirname, '..', 'session_auth');
  if (!fs.existsSync(sessionsPath)) return;

  try {
    const files = fs.readdirSync(sessionsPath);
    for (const file of files) {
      if (file.startsWith('gym_')) {
        const gymId = parseInt(file.replace('gym_', ''), 10);
        if (!isNaN(gymId)) {
          console.log(`[WhatsApp Daemon] Auto-resuming saved session for Gym #${gymId}...`);
          connectWhatsApp(gymId, ioInstance).catch(err => {
            console.error(`[WhatsApp Daemon] Failed to auto-resume session for Gym #${gymId}:`, err.message);
          });
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp Daemon] Error scanning saved sessions:', err.message);
  }
}

// Automated Bulk Reminder System for ALL Gyms (or a Single Gym if gymId is provided)
// CRITICAL: Filter OUT disabled/left members ('status = active' query)
async function sendBulkReminders(gymId = null) {
  console.log(`[Reminder System] Starting automated reminder scan...`);
  const today = new Date().toISOString().slice(0, 10);
  
  try {
    // Select all members with expired membership AND active account status (status = 'active')
    // Exclude members categorized as 'left' / disabled!
    let query = 'SELECT * FROM members WHERE expiry_date < ? AND status = "active"';
    const params = [today];
    
    if (gymId) {
      query += ' AND gym_id = ?';
      params.push(parseInt(gymId, 10));
    }

    const [expiredMembers] = await pool.query(query, params);

    console.log(`[Reminder System] Found ${expiredMembers.length} active-but-expired memberships.`);
    
    let sentCount = 0;
    const details = [];

    for (const member of expiredMembers) {
      const gId = parseInt(member.gym_id, 10);
      const isConnected = (connectionStatuses.get(gId) === 'connected');

      if (!isConnected) {
        console.warn(`[Reminder System] Skipped member ${member.name} - Gym #${gId} WhatsApp is NOT connected.`);
        details.push({ 
          id: member.id, 
          name: member.name, 
          phone: member.phone, 
          status: 'failed', 
          error: `Gym #${gId} WhatsApp not connected.` 
        });
        continue;
      }

      // Fetch gym specific template
      const [gymRows] = await pool.query('SELECT name, reminder_template FROM gyms WHERE id = ?', [gId]);
      let gymName = 'The Gym';
      let reminderTemplate = 'Assalamualaikum [MemberName], your gym membership has expired on [ExpiryDate]. Kindly pay your fees to continue your membership. Thank you. - [GymName]';
      
      if (gymRows.length > 0) {
        gymName = gymRows[0].name;
        if (gymRows[0].reminder_template) {
           reminderTemplate = gymRows[0].reminder_template;
        }
      }

      // Replace magic tags
      const memberExpiry = member.expiry_date ? (typeof member.expiry_date === 'string' ? member.expiry_date.slice(0,10) : member.expiry_date.toISOString().slice(0, 10)) : 'N/A';
      const message = reminderTemplate
         .replace(/\\[MemberName\\]/gi, member.name)
         .replace(/\\[ExpiryDate\\]/gi, memberExpiry)
         .replace(/\\[GymName\\]/gi, gymName);
      
      try {
        await sendMessage(gId, member.phone, message);
        
        // Auto mark unpaid
        await pool.query(
          'UPDATE members SET fee_status = "Unpaid" WHERE id = ?',
          [member.id]
        );

        sentCount++;
        details.push({ id: member.id, name: member.name, phone: member.phone, status: 'success' });
        
        // Spam rate limit delay (3 seconds)
        await delay(3000);
      } catch (err) {
        console.error(`[Reminder System] Failed to send reminder to ${member.name} (${member.phone}) for Gym #${gId}:`, err.message);
        details.push({ id: member.id, name: member.name, phone: member.phone, status: 'failed', error: err.message });
      }
    }

    console.log(`[Reminder System] Completed. Reminders sent to ${sentCount}/${expiredMembers.length} members.`);
    return { success: true, totalExpired: expiredMembers.length, sentCount, details };

  } catch (error) {
    console.error('[Reminder System] Critical error in bulk reminder job:', error.message);
    return { success: false, error: error.message, sentCount: 0 };
  }
}

// Retrieve current status & data per Gym
function getStatusDetails(gymId) {
  const gId = parseInt(gymId, 10);
  const status = connectionStatuses.get(gId) || 'disconnected';
  const qr = currentQRDataURLs.get(gId) || null;
  const sock = activeSockets.get(gId);
  
  return {
    status,
    qr,
    user: sock && sock.user ? { id: sock.user.id, name: sock.user.name || 'Gym Admin' } : null
  };
}

module.exports = {
  connectWhatsApp,
  disconnectWhatsApp,
  sendMessage,
  resumeSessions,
  sendBulkReminders,
  getStatusDetails,
  connectionStatus: (gymId) => connectionStatuses.get(parseInt(gymId, 10)) || 'disconnected'
};
