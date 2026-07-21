// =====================================
// Fish Feeder IoT Dashboard
// =====================================

// ---------- DOM ----------

const statusText = document.getElementById("statusText");
const lastSeen = document.getElementById("lastSeen");

const weight = document.getElementById("weight");
const foodBar = document.getElementById("foodBar");
const foodStatusLabel = document.getElementById("foodStatusLabel");
const daysRemainingText = document.getElementById("daysRemainingText");
const dailyUsage = document.getElementById("dailyUsage");
const saveUsageBtn = document.getElementById("saveUsageBtn");

const historyTable = document.getElementById("historyTable");
const alertList = document.getElementById("alertList");
const scheduleList = document.getElementById("scheduleList");

const feedBtn = document.getElementById("feedBtn");
const stopBtn = document.getElementById("stopBtn");

const feedAmount = document.getElementById("feedAmount");

const scheduleTime = document.getElementById("scheduleTime");
const addSchedule = document.getElementById("addSchedule");

const clearHistory = document.getElementById("clearHistory");

const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authDeviceId = document.getElementById("authDeviceId");
const authDeviceCode = document.getElementById("authDeviceCode");
const authError = document.getElementById("authError");
const logoutBtn = document.getElementById("logoutBtn");

// =====================================
// DEVICE AUTH (ไม่มีระบบ Login/User จริง
// เก็บแค่ "ไอดีเครื่อง" + "รหัส" ไว้ใน localStorage ของเบราว์เซอร์)
// =====================================

const AUTH_KEY = "fishfeeder_auth";

function getAuth() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    } catch {
        return null;
    }
}

function setAuth(deviceId, deviceCode) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ deviceId, deviceCode }));
}

function clearAuthStorage() {
    localStorage.removeItem(AUTH_KEY);
}

function authHeaders() {
    const auth = getAuth();
    if (!auth) return {};
    return {
        "x-device-id": auth.deviceId,
        "x-device-code": auth.deviceCode
    };
}

function showAuthModal(message) {
    authError.textContent = message || "";
    authModal.style.display = "flex";
}

function hideAuthModal() {
    authModal.style.display = "none";
}

// =====================================
// XSS PROTECTION
// เดิม renderHistory/renderAlerts ใส่ค่าจาก MQTT/Firestore ลง innerHTML ตรง ๆ
// ถ้ามีใครยิงข้อความปลอมผ่าน MQTT (เช่น broker credential หลุด) จะแทรก script ได้
// =====================================

function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// =====================================
// FOOD STATUS (fallback ฝั่ง client)
// ค่าที่ถูกต้องควรมาจาก server (data.foodStatus) เสมอ
// ฟังก์ชันนี้ใช้เป็น fallback เท่านั้นกรณี server เก่ายังไม่ส่ง foodStatus มา
// =====================================

function calculateFoodStatus(weightRemaining, dailyUsageValue) {

    if (dailyUsageValue <= 0) {
        return {
            level: "green",
            label: "ปกติ",
            daysRemaining: Infinity,
            weightRemaining
        };
    }

    const daysRemaining = weightRemaining / dailyUsageValue;

    if (daysRemaining < 3) {
        return {
            level: "red",
            label: "วิกฤต",
            daysRemaining: Number(daysRemaining.toFixed(1)),
            weightRemaining
        };
    }

    if (daysRemaining < 7) {
        return {
            level: "yellow",
            label: "เตือน",
            daysRemaining: Number(daysRemaining.toFixed(1)),
            weightRemaining
        };
    }

    return {
        level: "green",
        label: "ปกติ",
        daysRemaining: Number(daysRemaining.toFixed(1)),
        weightRemaining
    };

}

// =====================================
// API
// =====================================

async function getJSON(url) {

    const res = await fetch(url, {
        headers: { ...authHeaders() }
    });

    if (res.status === 401) {
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("Unauthorized");
    }

    return await res.json();

}

async function postJSON(url, data = {}) {

    const res = await fetch(url, {

        method: "POST",

        headers: {
            "Content-Type": "application/json",
            ...authHeaders()
        },

        body: JSON.stringify(data)

    });

    if (res.status === 401) {
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("Unauthorized");
    }

    return await res.json();

}

async function deleteAPI(url) {

    const res = await fetch(url, {

        method: "DELETE",

        headers: { ...authHeaders() }

    });

    if (res.status === 401) {
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("Unauthorized");
    }

    return await res.json();

}

// =====================================
// LOAD STATUS
// =====================================

async function loadStatus() {

    const data = await getJSON("/api/status");

    updateStatus(data);

}

// =====================================
// LOAD HISTORY
// =====================================

async function loadHistory() {

    const history = await getJSON("/api/history");

    renderHistory(history);

}

// =====================================
// LOAD ALERTS
// =====================================

async function loadAlerts() {

    const alerts = await getJSON("/api/alerts");

    renderAlerts(alerts);

}

// =====================================
// LOAD SCHEDULE
// =====================================

async function loadSchedule() {

    const schedules = await getJSON("/api/schedule");

    renderSchedule(schedules);

}

// =====================================
// STATUS
// =====================================

function updateStatus(data) {

    if (data.online) {

        statusText.innerHTML = "ONLINE";
        statusText.className = "online";

    } else {

        statusText.innerHTML = "OFFLINE";
        statusText.className = "offline";

    }

    // เดิม: ช่อง dailyUsage มีค่า default "100" ติดมาตั้งแต่ HTML เสมอ
    // ทำให้ Number(dailyUsage.value || data.dailyUsage || 100) ไม่เคยไปอ่านค่าจริงจาก server เลย
    // แก้ไข: sync ค่าจาก server เข้าช่อง input ทุกครั้งที่ได้ status ใหม่ (ถ้า user ยังไม่ได้พิมพ์เอง)
    if (data.dailyUsage && document.activeElement !== dailyUsage) {
        dailyUsage.value = data.dailyUsage;
    }

    const currentWeight = data.weight || 0;
    const dailyUsageValue = Number(dailyUsage.value || data.dailyUsage || 100);

    // ใช้ foodStatus ที่ server คำนวณมาให้ก่อนเสมอ (ตรงกับที่ backend ใช้ตัดสินใจแจ้งเตือนจริง)
    // ถ้า server เก่ายังไม่ส่งมา ค่อย fallback มาคำนวณฝั่ง client
    const foodStatus = data.foodStatus || calculateFoodStatus(currentWeight, dailyUsageValue);

    weight.innerHTML = currentWeight;
    foodStatusLabel.innerHTML = foodStatus.label;
    foodStatusLabel.className = `fw-bold text-${foodStatus.level === 'green' ? 'success' : foodStatus.level === 'yellow' ? 'warning' : 'danger'}`;
    daysRemainingText.innerHTML = foodStatus.daysRemaining === Infinity ? "∞ วัน" : `${foodStatus.daysRemaining} วัน`;

    // แสดงเวลาที่ Backend ส่งมา
    if (data.lastSeen) {

        if (data.lastSeen._seconds) {

            // Firestore Timestamp
            lastSeen.innerHTML = new Date(
                data.lastSeen._seconds * 1000
            ).toLocaleString();

        } else {

            // ISO String หรือ Date
            lastSeen.innerHTML = new Date(
                data.lastSeen
            ).toLocaleString();

        }

    } else {

        lastSeen.innerHTML = "-";

    }

    updateProgress(currentWeight);

}

// =====================================
// PROGRESS BAR
// =====================================

function updateProgress(current) {

    const max = 3000;

    let percent = (current / max) * 100;

    if (percent > 100) percent = 100;

    foodBar.style.width = percent + "%";

    foodBar.innerHTML = Math.round(percent) + "%";

    if (percent > 60) {

        foodBar.className = "progress-bar bg-success";

    }

    else if (percent > 30) {

        foodBar.className = "progress-bar bg-warning";

    }

    else {

        foodBar.className = "progress-bar bg-danger";

    }

}
// =====================================
// RENDER HISTORY
// =====================================

function renderHistory(history) {

    historyTable.innerHTML = "";

    history.forEach(item => {

        const tr = document.createElement("tr");

        const date = item.timestamp
            ? new Date(
                item.timestamp._seconds
                    ? item.timestamp._seconds * 1000
                    : item.timestamp
              ).toLocaleString()
            : "-";

        // เดิมใส่ item.amount / item.mode ตรง ๆ ผ่าน innerHTML -> เสี่ยง XSS ถ้าค่ามาจาก MQTT ที่ปลอมได้
        tr.innerHTML = `
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(item.amount)} g</td>
            <td>${escapeHtml(item.mode)}</td>
        `;

        historyTable.appendChild(tr);

    });

}

// =====================================
// RENDER ALERTS
// =====================================

function renderAlerts(alerts) {

    alertList.innerHTML = "";

    alerts.forEach(alert => {

        const li = document.createElement("li");

        li.className = "list-group-item";

        li.innerHTML = `
            <strong>${escapeHtml((alert.level || "").toUpperCase())}</strong><br>
            ${escapeHtml(alert.message)}
        `;

        alertList.appendChild(li);

    });

}

// =====================================
// RENDER SCHEDULE
// =====================================

let schedules = [];

function renderSchedule(data) {

    schedules = data;

    scheduleList.innerHTML = "";

    data.forEach(item => {

        const li = document.createElement("li");

        li.className =
            "list-group-item d-flex justify-content-between align-items-center";

        const timeSpan = document.createElement("span");
        timeSpan.textContent = item.time;

        const btn = document.createElement("button");
        btn.className = "btn btn-danger btn-sm";
        btn.textContent = "Delete";
        btn.addEventListener("click", () => removeSchedule(item.id));

        li.appendChild(timeSpan);
        li.appendChild(btn);

        scheduleList.appendChild(li);

    });

}

// =====================================
// REMOVE SCHEDULE
// =====================================

function removeSchedule(id) {

    schedules = schedules.filter(item => item.id !== id);

    saveSchedule();

}

// =====================================
// SAVE SCHEDULE
// =====================================

async function saveSchedule() {

    const payload = schedules.map(item => ({

        time: item.time,

        enable: true

    }));

    const result = await postJSON("/api/schedule", {

        schedules: payload

    });

    if (result && result.success === false) {
        alert(result.message);
    }

    loadSchedule();

}

// =====================================
// APP INIT (หลังจากยืนยันไอดีเครื่อง+รหัสแล้วเท่านั้น)
// =====================================

let socket = null;

function startApp(auth) {

    // ส่ง deviceId/deviceCode ตอน connect เพื่อให้ server ตรวจสอบใน io.use()
    socket = io({
        auth: {
            deviceId: auth.deviceId,
            deviceCode: auth.deviceCode
        }
    });

    socket.on("connect", () => {
        console.log("Socket Connected");
    });

    socket.on("connect_error", (err) => {
        console.log("Socket connect_error:", err.message);
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
    });

    socket.on("status", (data) => {
        updateStatus(data);
    });

    socket.on("weight", (data) => {
        updateStatus({
            online: true,
            weight: data.weight
        });
    });

    socket.on("history", (data) => {
        renderHistory(data);
    });

    socket.on("alerts", (data) => {
        renderAlerts(data);
    });

    socket.on("alert", () => {
        loadAlerts();
    });

    socket.on("schedule", (data) => {
        renderSchedule(data);
    });

    // ---------- Button Events ----------

    saveUsageBtn.addEventListener("click", async () => {

        const usage = Number(dailyUsage.value);

        if (usage <= 0) {
            alert("Daily usage must be greater than 0");
            return;
        }

        await postJSON("/api/usage", { dailyUsage: usage });

        alert("Daily usage updated");

    });

    feedBtn.addEventListener("click", async () => {

        const grams = Number(feedAmount.value);

        if (grams <= 0) {
            alert("Amount must be greater than 0");
            return;
        }

        const result = await postJSON("/api/feed", { grams });

        if (result && result.success === false) {
            alert(result.message);
        }

    });

    stopBtn.addEventListener("click", async () => {
        await postJSON("/api/stop");
    });

    addSchedule.addEventListener("click", () => {

        if (scheduleTime.value === "") {
            alert("Please select time");
            return;
        }

        schedules.push({
            time: scheduleTime.value,
            enable: true
        });

        saveSchedule();

        scheduleTime.value = "";

    });

    clearHistory.addEventListener("click", async () => {

        if (confirm("Clear feeding history?")) {
            await deleteAPI("/api/history");
            loadHistory();
        }

    });

    // ---------- Initial Load ----------

    async function init() {
        await loadStatus();
        await loadHistory();
        await loadAlerts();
        await loadSchedule();
    }

    init();

}

// =====================================
// AUTH GATE
// =====================================

authForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    const deviceId = authDeviceId.value.trim();
    const deviceCode = authDeviceCode.value.trim();

    if (!deviceId || !deviceCode) {
        authError.textContent = "กรุณากรอกไอดีเครื่องและรหัส";
        return;
    }

    try {

        const res = await fetch("/api/verify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-device-id": deviceId,
                "x-device-code": deviceCode
            },
            body: JSON.stringify({})
        });

        if (res.ok) {
            setAuth(deviceId, deviceCode);
            hideAuthModal();
            startApp({ deviceId, deviceCode });
        } else {
            authError.textContent = "ไอดีเครื่องหรือรหัสไม่ถูกต้อง";
        }

    } catch (err) {
        authError.textContent = "เชื่อมต่อ server ไม่ได้ ลองใหม่อีกครั้ง";
    }

});

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        clearAuthStorage();
        if (socket) socket.disconnect();
        location.reload();
    });
}

// ---------- Bootstrap ----------

const existingAuth = getAuth();

if (existingAuth) {
    hideAuthModal();
    startApp(existingAuth);
} else {
    showAuthModal();
}