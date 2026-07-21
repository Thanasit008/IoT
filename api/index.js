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
// 1. Firebase Admin Initializing (Safe Mode)
// ----------------------------------------------------
try {
  if (!admin.apps.length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey) {
      // จัดการตัวอักษรขึ้นบรรทัดใหม่ \n ให้ถูกต้องสำหรับ Vercel
      privateKey = privateKey.replace(/\\n/g, '\n').replace(/^"(.*)"$/, '$1');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app`
    });
    console.log('✅ Firebase initialized successfully');
  }
} catch (error) {
  console.error('❌ Firebase Init Error:', error.message);
}

// ----------------------------------------------------
// 2. Helper Function: ส่ง MQTT ในระบบ Serverless
// ----------------------------------------------------
function publishMQTT(topic, payload) {
  return new Promise((resolve, reject) => {
    const mqttOptions = {
      host: process.env.MQTT_HOST,
      port: parseInt(process.env.MQTT_PORT || '8883'),
      protocol: 'mqtts',
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS,
      rejectUnauthorized: true,
      connectTimeout: 5000
    };

    const client = mqtt.connect(mqttOptions);

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error('MQTT connection timeout'));
    }, 7000);

    client.on('connect', () => {
      client.publish(topic, payload, { qos: 1 }, (err) => {
        clearTimeout(timeout);
        client.end(); // ปิดการเชื่อมต่อเมื่อส่งเสร็จ
        if (err) reject(err);
        else resolve();
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end(true);
      reject(err);
    });
  });
}

// ----------------------------------------------------
// 3. REST API Routes
// ----------------------------------------------------

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Online', timestamp: new Date() });
});

// สั่งให้อาหารปลา (Feed Command)
app.post('/api/feed', async (req, res) => {
  try {
    const { deviceId, amountGrams } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId parameter' });

    const topic = `fishfeeder/${deviceId}/cmd/feed`;
    const payload = JSON.stringify({ 
      action: 'FEED',
      amount: amountGrams || 10, 
      timestamp: Math.floor(Date.now() / 1000)
    });

    // ส่งข้อความผ่าน MQTT
    await publishMQTT(topic, payload);

    // บันทึก Log ลง Firebase (ถ้ามี)
    try {
      if (admin.apps.length) {
        const db = admin.database();
        await db.ref(`devices/${deviceId}/logs`).push({
          action: 'FEED',
          amount: amountGrams || 10,
          timestamp: admin.database.ServerValue.TIMESTAMP
        });
      }
    } catch (dbErr) {
      console.error('Firebase log error:', dbErr.message);
    }

    res.json({ success: true, message: `Feed command sent to device: ${deviceId}` });
  } catch (error) {
    console.error('API /api/feed Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// สั่งหยุดฉุกเฉิน (Emergency Stop Command)
app.post('/api/stop', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId parameter' });

    const topic = `fishfeeder/${deviceId}/cmd/stop`;
    const payload = JSON.stringify({ 
      action: 'EMERGENCY_STOP',
      timestamp: Math.floor(Date.now() / 1000)
    });

    await publishMQTT(topic, payload);

    res.json({ success: true, message: `EMERGENCY STOP sent to device: ${deviceId}` });
  } catch (error) {
    console.error('API /api/stop Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 4. Server Start (สำหรับ Local Test)
// ----------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Smart Fish Feeder API is running on port ${PORT}`);
  });
}

module.exports = app;