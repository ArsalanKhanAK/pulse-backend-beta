const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const { initializeDatabase } = require('./config/db');
const whatsappService = require('./services/whatsappService');
const schedulerService = require('./services/schedulerService');

const authRoutes = require('./routes/authRoutes');
const membersRoutes = require('./routes/membersRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const superRoutes = require('./routes/superRoutes');
const gymRoutes = require('./routes/gymRoutes');
const chatRoutes = require('./routes/chatRoutes');
const planRoutes = require('./routes/planRoutes');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*', // Allow all origins for development and API consumers
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

const PORT = process.env.PORT || 5000;

// Save Socket.io globally in Express App context for controller routing access
app.set('io', io);

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Support larger base64 logo and receipt uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check API
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Gym SaaS Multi-Tenant API is fully operational.', time: new Date() });
});

// Register REST API Routes
app.use('/api/auth', authRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/super', superRoutes);
app.use('/api/gym', gymRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/plans', planRoutes);

// Socket.io Real-time Event Connection Handler
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  // Listen for frontend requesting WhatsApp status of a specific Gym
  socket.on('get_whatsapp_status', ({ gymId }) => {
    if (gymId) {
      const details = whatsappService.getStatusDetails(gymId);
      socket.emit('whatsapp_status', {
        gymId: parseInt(gymId, 10),
        status: details.status,
        qr: details.qr,
        user: details.user
      });
    }
  });

  // ── SUPPORT CHAT REAL-TIME EVENTS ──

  // User joins their personal notification room so they receive messages
  socket.on('join_chat_room', ({ userId, role }) => {
    if (userId) {
      const room = `chat_user_${userId}`;
      socket.join(room);
      console.log(`[Chat] User ${userId} joined room: ${room}`);

      // Support team members also join a shared desk room
      if (role === 'super_admin' || role === 'master_admin') {
        socket.join('support_team_desk');
        console.log(`[Chat] Support member ${userId} joined support_team_desk`);
      }
    }
  });

  // Relay a chat message to the receiver's room in real-time
  socket.on('send_chat_message', ({ senderId, receiverId, message, sender_name, sender_role }) => {
    if (!senderId || !receiverId || !message) return;
    const payload = {
      sender_id: senderId,
      receiver_id: receiverId,
      sender_name: sender_name || 'Unknown',
      sender_role: sender_role || 'gym_admin',
      message,
      is_read: false,
      created_at: new Date().toISOString()
    };

    if (sender_role === 'super_admin' || sender_role === 'master_admin') {
      // Message from Support to Gym Admin (receiverId)
      // Deliver to the Gym Admin
      io.to(`chat_user_${receiverId}`).emit('new_chat_message', payload);
      // Deliver to all Support Team members so they stay perfectly in sync in real-time
      io.to('support_team_desk').emit('new_chat_message', payload);
    } else {
      // Message from Gym Admin (senderId) to Support
      // Deliver back to Gym Admin (to confirm receipt/render)
      io.to(`chat_user_${senderId}`).emit('new_chat_message', payload);
      // Deliver to all Support Team members
      io.to('support_team_desk').emit('new_chat_message', payload);
    }

    console.log(`[Chat] Message from ${senderId} (${sender_role}) => ${receiverId}: ${message.substring(0, 50)}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Main Startup Entry Function
async function startServer() {
  console.log('[Server] Starting Gym Management System...');
  
  // 1. Initialize and verify Database and Tables
  await initializeDatabase();

  // 2. Start Express, HTTP, and Socket Servers
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`[Server] Core SaaS Server listening on port ${PORT}`);
    console.log(`[Server] Health Endpoint: http://localhost:${PORT}/health`);
    console.log(`======================================================\n`);
  });

  // 3. Auto-Resume all saved active WhatsApp connections in the background
  await whatsappService.resumeSessions(io);

  // 4. Fire up node-cron Expiry audits & reminders (9:00 AM daily)
  schedulerService.initializeScheduler();
}

// Global Exception Handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

startServer().catch((err) => {
  console.error('[Server] Critical Startup Failure:', err.message);
});
