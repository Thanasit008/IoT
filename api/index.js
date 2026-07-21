const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ----------------------------------------------------
// 1. Firebase Admin Initializing
// ----------------------------------------------------
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app`
  });
}

const db = admin.database();

// ----------------------------------------------------
// 2. HiveMQ MQTT Connection
// ----------------------------------------------------
const mqttOptions = {
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT || '8883'),
  protocol: 'mqtts',
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: true,
  reconnectPeriod: 2000
};

const mqttClient = mqtt.connect(mqttOptions);

mqttClient.on('connect', () => {
  console.log('✅ Connected to HiveMQ Cloud Broker successfully!');
  
  // Subscribe topics สำหรับรับค่าจาก ESP8266
  mqttClient.subscribe('fishfeeder/+/status');
  mqttClient.subscribe('fishfeeder/+/weight');
  mqttClient.subscribe('fishfeeder/+/log');
});

// Sync ข้อมูลจาก MQTT เข้า Firebase Realtime Database
mqttClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const topicParts = topic.split('/');
    const deviceId = topicParts[1];
    const dataCategory = topicParts[2]; // status, weight, log

    if (deviceId && dataCategory) {
      db.ref(`devices/${deviceId}/${dataCategory}`).set({
        ...payload,
        updatedAt: admin.database.ServerValue.TIMESTAMP
      });
      console.log(`[MQTT Sync] -> Firebase (${deviceId}/${dataCategory})`);
    }
  } catch (e) {
    console.log(`[MQTT Raw] ${topic}: ${message.toString()}`);
  }
});

mqttClient.on('error', (err) => {
  console.error('❌ MQTT Connection Error:', err.message);
});

// ----------------------------------------------------
// 3. REST API Routes
// ----------------------------------------------------

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Online', timestamp: new Date() });
});

// สั่งให้อาหารปลา (Feed Command)
app.post('/api/feed', (req, res) => {
  const { deviceId, amountGrams } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId parameter' });

  const topic = `fishfeeder/${deviceId}/cmd/feed`;
  const payload = JSON.stringify({ 
    action: 'FEED',
    amount: amountGrams || 10, 
    timestamp: Math.floor(Date.now() / 1000)
  });

  mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to publish to MQTT' });
    res.json({ success: true, message: `Feed command sent to device: ${deviceId}` });
  });
});

// สั่งหยุดฉุกเฉิน (Emergency Stop Command)
app.post('/api/stop', (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId parameter' });

  const topic = `fishfeeder/${deviceId}/cmd/stop`;
  const payload = JSON.stringify({ 
    action: 'EMERGENCY_STOP',
    timestamp: Math.floor(Date.now() / 1000)
  });

  mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to publish STOP command' });
    res.json({ success: true, message: `EMERGENCY STOP sent to device: ${deviceId}` });
  });
});

// ----------------------------------------------------
// 4. Server Start
// ----------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Smart Fish Feeder API is running on port ${PORT}`);
});

module.exports = app;