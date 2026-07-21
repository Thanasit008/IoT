const admin = require("firebase-admin");
const path = require("path");

// อ่าน Service Account จากไฟล์
const serviceAccount = require(path.join(
    __dirname,
    "../firebase-service-account.json"
));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ตั้งค่าให้ Firestore ไม่ละเว้น undefined
db.settings({
    ignoreUndefinedProperties: true
});

module.exports = {
    admin,
    db
};