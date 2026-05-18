const whatsappService = require('../services/whatsappService');

// Get current WhatsApp Connection Status scoped by Gym
exports.getStatus = (req, res) => {
  const gymId = req.user.gym_id;
  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    const details = whatsappService.getStatusDetails(gymId);
    return res.status(200).json({ success: true, ...details });
  } catch (error) {
    console.error('[WhatsApp Controller] getStatus error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to retrieve connection status.' });
  }
};

// Initiate or restart connection process scoped by Gym
exports.connect = async (req, res) => {
  const gymId = req.user.gym_id;
  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    const io = req.app.get('io');
    whatsappService.connectWhatsApp(gymId, io);
    return res.status(200).json({ success: true, message: 'WhatsApp connection process initialized.' });
  } catch (error) {
    console.error('[WhatsApp Controller] connect error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to initialize connection process.' });
  }
};

// Disconnect WhatsApp session and delete credentials scoped by Gym
exports.disconnect = async (req, res) => {
  const gymId = req.user.gym_id;
  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    await whatsappService.disconnectWhatsApp(gymId);
    return res.status(200).json({ success: true, message: 'Successfully logged out and session deleted.' });
  } catch (error) {
    console.error('[WhatsApp Controller] disconnect error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to properly disconnect WhatsApp session.' });
  }
};

// Send a single custom WhatsApp message scoped by Gym
exports.sendSingleMessage = async (req, res) => {
  const gymId = req.user.gym_id;
  const { phone, message } = req.body;

  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  if (!phone || !message) {
    return res.status(400).json({ success: false, message: 'Please provide both phone number and message.' });
  }

  try {
    await whatsappService.sendMessage(gymId, phone, message);
    return res.status(200).json({ success: true, message: 'Message sent successfully.' });
  } catch (error) {
    console.error('[WhatsApp Controller] sendSingleMessage error:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Failed to send message.' });
  }
};

// Manually trigger the expiry scan and send reminders for this specific Gym
exports.triggerBulkReminders = async (req, res) => {
  const gymId = req.user.gym_id;
  if (!gymId) {
    return res.status(400).json({ success: false, message: 'You are not linked to any Gym profile.' });
  }

  try {
    const result = await whatsappService.sendBulkReminders(gymId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.status(200).json({
      success: true,
      message: `Expiry scanning and reminder dispatch complete. Sent: ${result.sentCount}.`,
      data: result
    });
  } catch (error) {
    console.error('[WhatsApp Controller] triggerBulkReminders error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to process bulk reminders.' });
  }
};
