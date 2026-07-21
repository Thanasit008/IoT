const { db, admin } = require("./firebase");

// =======================================
// HELPER: ลบเอกสารทั้งหมดแบบแบ่ง batch
// (Firestore จำกัด batch ละไม่เกิน 500 operations)
// =======================================

async function deleteAllDocs(snapshot) {

    const docs = snapshot.docs;
    const CHUNK_SIZE = 400;

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {

        const batch = db.batch();

        docs.slice(i, i + CHUNK_SIZE).forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();

    }

}

// =======================================
// DEVICE
// =======================================

async function updateDevice(data) {

    await db.collection("device")
        .doc("state")
        .set({
            ...data,
            lastSeen: admin.firestore.FieldValue.serverTimestamp()
        }, {
            merge: true
        });

}

async function getDevice() {

    const doc = await db
        .collection("device")
        .doc("state")
        .get();

    if (!doc.exists) {
        return null;
    }

    return {
        id: doc.id,
        ...doc.data()
    };

}

// =======================================
// WEIGHT
// =======================================

async function updateWeight(weight) {

    await db.collection("device")
        .doc("state")
        .set({
            weight,
            foodRemaining: weight
        }, {
            merge: true
        });

}

async function updateDailyUsage(dailyUsage) {

    await db.collection("device")
        .doc("state")
        .set({
            dailyUsage
        }, {
            merge: true
        });

}

// =======================================
// HISTORY
// =======================================

async function saveHistory(data) {

    await db.collection("history")
        .add({

            amount: data.amount,

            mode: data.mode || "manual",

            timestamp: admin.firestore.FieldValue.serverTimestamp()

        });

}

async function getHistory(limit = 100) {

    const snapshot = await db
        .collection("history")
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

}

async function clearHistory() {

    const snapshot = await db
        .collection("history")
        .get();

    await deleteAllDocs(snapshot);

}

// =======================================
// ALERT
// =======================================

async function saveAlert(data) {

    await db.collection("alerts")
        .add({

            message: data.message,

            level: data.level || "info",

            timestamp: admin.firestore.FieldValue.serverTimestamp()

        });

}

async function getAlerts(limit = 20) {

    const snapshot = await db
        .collection("alerts")
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

}

async function clearAlerts() {

    const snapshot = await db
        .collection("alerts")
        .get();

    await deleteAllDocs(snapshot);

}

// =======================================
// SCHEDULE
// =======================================

async function saveSchedules(schedules) {

    const snapshot = await db
        .collection("schedule")
        .get();

    await deleteAllDocs(snapshot);

    const batch = db.batch();

    schedules.forEach(item => {

        const ref = db.collection("schedule").doc();

        batch.set(ref, {

            time: item.time,

            enable: item.enable ?? true,

            createdAt: admin.firestore.FieldValue.serverTimestamp()

        });

    });

    await batch.commit();

}

async function getSchedules() {

    const snapshot = await db
        .collection("schedule")
        .orderBy("time")
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

}

// =======================================
// EXPORT
// =======================================

module.exports = {

    // Device
    updateDevice,
    getDevice,

    // Weight
    updateWeight,
    updateDailyUsage,

    // History
    saveHistory,
    getHistory,
    clearHistory,

    // Alert
    saveAlert,
    getAlerts,
    clearAlerts,

    // Schedule
    saveSchedules,
    getSchedules

};