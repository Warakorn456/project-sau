// ============================================================
//  Smart Farm Dashboard - Frontend JavaScript
// ============================================================

const socket = io();

// ============================================================
//  Page Navigation
// ============================================================

function goPage(name) {
    // ล็อกการเปลี่ยนหน้าเมื่อโปรแกรมรันอยู่ใน AUTO mode (เฉพาะ admin)
    if (currentRole === 'admin' && runState.running && runState.mode === 'auto' && name !== 'run') {
        showToast('🔒 กด MANUAL ก่อนเปลี่ยนหน้า');
        flashLockHint();
        return;
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + name);
    if (target) target.classList.add('active');

    document.querySelectorAll('[data-page]').forEach(el => {
        el.classList.toggle('active', el.dataset.page === name);
    });

    closeSidebar();
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    sb.classList.toggle('open');
    ov.classList.toggle('show');
}

function closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('show');
}

// ============================================================
//  Role Management
// ============================================================

let currentRole = 'viewer';

// ตรวจสอบ response ถ้า server redirect ไป login = session หมดอายุ
function checkSession(r) {
    if (r.redirected || r.url.includes('/login') || r.url === window.location.origin + '/') {
        showToast('⚠️ Session หมดอายุ กำลัง redirect ไป Login...');
        setTimeout(() => { window.location.href = '/'; }, 1500);
        throw new Error('session_expired');
    }
    return r;
}

function loadMe() {
    fetch('/api/me')
        .then(checkSession)
        .then(r => r.json())
        .then(data => {
            currentRole = data.role;

            document.getElementById('user-name').textContent = data.username;
            const roleTag = document.getElementById('user-role-tag');
            if (data.role === 'admin') {
                roleTag.textContent = 'Admin';
                roleTag.className = 'role-tag role-admin';
            } else {
                roleTag.textContent = 'Viewer';
                roleTag.className = 'role-tag role-viewer';
            }

            applyRole(data.role);
        })
        .catch(err => { if (err.message !== 'session_expired') console.error('[Me] Error:', err); });
}

function applyRole(role) {
    const isAdmin = role === 'admin';

    // ซ่อน/แสดง element ที่ต้องการ admin
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });

    // แสดง badge "ดูสถานะเท่านั้น" ถ้าเป็น viewer
    const readonlyBadge = document.getElementById('mode-readonly-badge');
    if (readonlyBadge) readonlyBadge.style.display = isAdmin ? 'none' : 'flex';

    // ทำให้ input ใน auto-panel อ่านอย่างเดียวสำหรับ viewer
    document.querySelectorAll('#auto-panel input, #auto-panel select').forEach(el => {
        el.disabled = !isAdmin;
    });

    // โหลดรายชื่อ user ถ้าเป็น admin
    if (isAdmin) loadUsers();
}

// ชื่อรีเลย์ (แก้ไขได้ตามต้องการ)
const RELAY_NAMES = [
    'น้ำเติมลัง1', 'น้ำเติมลัง2',
    'สารAลัง1',    'สารAลัง2',
    'สารBลัง1',    'สารBลัง2',
    'วนลัง1เข้า',  'วนลัง1ออก',
    'วนลัง2เข้า',  'วนลัง2ออก'
];

// ============================================================
//  สร้างปุ่ม Relay
// ============================================================

const relayGrid = document.getElementById('relay-grid');

for (let i = 0; i < 10; i++) {
    const btn = document.createElement('button');
    btn.className = 'relay-btn';
    btn.id = `relay-btn-${i}`;
    btn.onclick = () => toggleRelay(i);
    btn.innerHTML = `
        <div class="relay-num">R${i + 1}</div>
        <div class="relay-name">${RELAY_NAMES[i]}</div>
        <div class="relay-status-icon" id="relay-icon-${i}">⭕</div>
        <div class="relay-status-text" id="relay-text-${i}">ปิด</div>
    `;
    relayGrid.appendChild(btn);
}

// ============================================================
//  Relay Control
// ============================================================

let relayStates = new Array(10).fill(false);

function toggleRelay(index) {
    const newState = !relayStates[index];
    fetch('/api/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, state: newState })
    }).catch(err => console.error('Relay error:', err));
}

function updateRelayUI(relays) {
    relayStates = relays;
    for (let i = 0; i < 10; i++) {
        const btn  = document.getElementById(`relay-btn-${i}`);
        const icon = document.getElementById(`relay-icon-${i}`);
        const text = document.getElementById(`relay-text-${i}`);
        if (relays[i]) {
            btn.classList.add('on');
            icon.textContent = '🟢';
            text.textContent = 'เปิด';
        } else {
            btn.classList.remove('on');
            icon.textContent = '⭕';
            text.textContent = 'ปิด';
        }
    }
}

// ============================================================
//  Sensor Display
// ============================================================

function setStatusBadge(id, online, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'status-badge ' + (online ? 'online' : 'offline');
    const t = el.querySelector('.status-text');
    if (t) t.textContent = label;
}

// เวลาแพ็กเก็ตล่าสุดจาก ESP32 — เก็บไว้ให้นาฬิกาเดินตัวนับ "ออฟไลน์มานานแค่ไหน" ต่อได้เอง
// ⚠️ รีเซ็ตทุกครั้งที่ server บูตใหม่ (Render spin down ก็นับ) ตัวเลขนี้จึงบอกได้แค่ "ตั้งแต่
// server ตื่นล่าสุด" — ประวัติที่เชื่อถือได้จริงคือช่วงที่ขาดข้อมูลในหน้ารายงาน ซึ่งอ่านจาก
// record ที่เก็บถาวรไว้
let lastEspSeen = null;
let espOnline   = false;
let serverDown  = false;   // browser หลุดจาก server เอง — คนละเรื่องกับ ESP32 ออฟไลน์

// "5 นาที" / "3 ชม. 20 น." / "2 วัน 5 ชม." — ใช้กับตัวนับเวลาที่เซ็นเซอร์เงียบ
function humanSince(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 1)  return 'ไม่ถึงนาที';
    if (mins < 60) return mins + ' นาที';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return hrs + ' ชม.' + (mins % 60 ? ' ' + (mins % 60) + ' น.' : '');
    return Math.floor(hrs / 24) + ' วัน' + (hrs % 24 ? ' ' + (hrs % 24) + ' ชม.' : '');
}

// วาด badge ใหม่จาก state ที่เก็บไว้ — เรียกซ้ำได้ทุกวินาทีจากนาฬิกา ตัวนับจะได้เดินเอง
// โดยไม่ต้องรอ event (ESP32 เงียบ = ไม่มี event เข้ามาให้ trigger)
function refreshEspBadges() {
    if (serverDown) {
        setStatusBadge('esp-status',      false, 'Offline');
        setStatusBadge('esp-status-desk', false, 'Server: Offline');
        return;
    }
    let label = espOnline ? 'Online' : 'Offline';
    if (!espOnline && lastEspSeen) label += ' (' + humanSince(Date.now() - lastEspSeen) + ')';
    setStatusBadge('esp-status',      espOnline, label);
    setStatusBadge('esp-status-desk', espOnline, 'ESP32: ' + label);
}

function updateSensorUI(data) {
    const online = !!data.connected;
    espOnline = online;
    if (data.timestamp) lastEspSeen = new Date(data.timestamp).getTime();
    refreshEspBadges();

    if (data.timestamp) {
        const d = new Date(data.timestamp);
        document.getElementById('last-update').textContent =
            'อัปเดต: ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    setText('val-temp',    data.temperature.toFixed(1));
    setText('val-hum',     data.humidity.toFixed(1));
    setText('val-light',   Math.round(data.light).toLocaleString());
    setText('val-volt',    data.voltage.toFixed(2));
    setText('val-current', data.current.toFixed(3));
    setText('val-power',   data.power.toFixed(2));

    const temp = data.temperature;
    setText('sub-temp', temp < 15 ? '⚠️ เย็นเกิน' : temp > 35 ? '⚠️ ร้อนเกิน' : 'ปกติ ✓');

    const hum = data.humidity;
    setText('sub-hum', hum < 40 ? '⚠️ แห้งเกิน' : hum > 85 ? '⚠️ ชื้นเกิน' : 'ปกติ ✓');

    const lux = data.light;
    setText('sub-light', lux < 200 ? '🌑 มืด' : lux < 1000 ? '🌤️ ปานกลาง' : '☀️ สว่างดี');

    function phLabel(v) {
        return v < 5.5 ? '🔴 กรดจัด' : v < 6.0 ? '🟠 กรด' :
               v < 6.5 ? '🟡 ต่ำเล็กน้อย' : v <= 7.5 ? '🟢 ปกติ' :
               v <= 8.0 ? '🟡 สูงเล็กน้อย' : '🔴 ด่างจัด';
    }
    setText('val-ph',  data.ph  != null ? data.ph.toFixed(1)  : '--');
    setText('sub-ph',  data.ph  != null ? phLabel(data.ph)    : '⚠️ sensor error');
    setText('val-ph2', data.ph2 != null ? data.ph2.toFixed(1) : '--');
    setText('sub-ph2', data.ph2 != null ? phLabel(data.ph2)   : '⚠️ sensor error');

    if (Array.isArray(data.waterLevel)) {
        data.waterLevel.forEach((pct, i) => updateWaterLevel(i, pct));
    }
    updateRunSensorUI(data);
}

function updateWaterLevel(index, pct) {
    const bar      = document.getElementById(`wl-bar-${index}`);
    const pctEl    = document.getElementById(`wl-pct-${index}`);
    const statusEl = document.getElementById(`wl-status-${index}`);

    if (pct < 0) {
        pctEl.textContent = 'N/A';
        bar.style.width = '0%';
        bar.className = 'water-bar';
        statusEl.textContent = '⚠️ ไม่พบสัญญาณเซ็นเซอร์';
        return;
    }

    const clamped = Math.min(100, Math.max(0, pct));
    pctEl.textContent = clamped.toFixed(0) + '%';
    bar.style.width = clamped + '%';

    if (clamped < 20) {
        bar.className = 'water-bar low';
        statusEl.textContent = '🔴 ระดับน้ำวิกฤต - ต้องเติมด่วน!';
    } else if (clamped < 50) {
        bar.className = 'water-bar medium';
        statusEl.textContent = '🟡 ระดับน้ำต่ำ';
    } else {
        bar.className = 'water-bar high';
        statusEl.textContent = '🟢 ระดับน้ำปกติ';
    }
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ============================================================
//  Charts (Chart.js)
// ============================================================

const charts = {};
const MAX_CHART_POINTS = 1440; // 24h × 60min

// ตั้งค่า Chart.js default
const BASE_OPTS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
        legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 }, padding: 12 }
        },
        tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
                title: (items) => {
                    if (!items.length) return '';
                    const lbl = items[0].label;
                    return Array.isArray(lbl) ? `${lbl[1]} ${lbl[0]}` : lbl;
                }
            }
        }
    },
    scales: {
        x: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { maxTicksLimit: 8, font: { size: 10 }, maxRotation: 0, minRotation: 0 }
        },
        y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { font: { size: 10 } }
        }
    },
    elements: {
        point: { radius: 0, hoverRadius: 4 },
        line:  { tension: 0.3, borderWidth: 2 }
    }
};

// ============================================================
//  TRAY_VIEW — แหล่งความจริงเดียวว่าค่าไหนเป็นของลังไหน
//
//  record ที่เก็บไม่ได้แยกตามลัง (เป็นภาพรวมทั้งฟาร์ม ณ วินาทีนั้น) การแยก
//  ว่าลังไหนเห็นค่าอะไรจึงทำที่นี่ที่เดียว แล้วใช้ขับทั้ง "กราฟ" และ
//  "ตารางสรุปรายวัน" เพื่อไม่ให้ทั้งสองอย่างหลุดจากกัน
//
//  .all = หน้าประวัติ 24 ชม. (ต้องเหมือนเดิมทุกประการ ห้ามเปลี่ยน)
//  .1 / .2 = หน้ารายงานรอบปลูกของแต่ละลัง
//
//  ลัง2 ไม่มีถังน้ำวน เพราะ ultrasonic index [6] เดิมถูกตัดตอนยก GPIO39
//  ไปให้ pH ลัง2 — คอลัมน์นั้นจึงหายไปเองในมุมมองลัง2
// ============================================================
const TRAY_VIEW = (() => {
    const ph = [
        { label: 'pH ลัง1', border: '#7b1fa2', bg: 'rgba(123,31,162,0.07)', fill: true, get: r => r.p  ?? null },
        { label: 'pH ลัง2', border: '#d81b60', bg: 'rgba(216,27,96,0.07)',  fill: true, get: r => r.p2 ?? null }
    ];

    const waterNames  = ['ถังสารA', 'ถังสารB', 'ถังน้ำเติม',
                         'ลังปลูกผัก1', 'ถังน้ำวนลัง1',
                         'ลังปลูกผัก2'];
    const waterColors = ['#1565c0', '#2e7d32', '#00838f',
                         '#558b2f', '#e65100', '#6a1b9a'];
    const water = waterNames.map((name, i) => ({
        label: `${name} (%)`, border: waterColors[i], bg: waterColors[i] + '12', fill: false,
        get: r => (r.w || [])[i] ?? null
    }));

    // ถังสารA / สารB / น้ำเติม ใช้ร่วมกันทั้ง 2 ลัง — เก็บไว้ในมุมมองของทั้งคู่
    // เพราะเป็นตัวอธิบายการจ่ายสารและการเติมน้ำของลังนั้นโดยตรง
    const sharedTanks = [water[0], water[1], water[2]];

    return {
        all: { ph, water },
        1:   { ph: [ph[0]], water: [...sharedTanks, water[3], water[4]] },
        2:   { ph: [ph[1]], water: [...sharedTanks, water[5]] }
    };
})();

// แปลง spec ใน TRAY_VIEW → dataset ของ Chart.js
function viewDataset(spec) {
    return {
        label: spec.label,
        data: [],
        borderColor: spec.border,
        backgroundColor: spec.bg,
        fill: spec.fill
    };
}

// สร้างชุดกราฟ 5 อัน (temp/hum, light, ph, power, water) ชี้ไปยัง canvas id ที่ระบุ
// ใช้ทั้งหน้าประวัติ (24h) และหน้ารายงานรอบปลูก (เต็มช่วง) เพื่อไม่ต้อง copy โค้ดกราฟซ้ำ
function buildCharts(elIds, view = TRAY_VIEW.all) {
    const c = {};

    // อุณหภูมิ & ความชื้น (แกน Y คู่)
    c.tempHum = new Chart(document.getElementById(elIds.tempHum), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'อุณหภูมิ (°C)',
                    data: [],
                    borderColor: '#f57c00',
                    backgroundColor: 'rgba(245,124,0,0.07)',
                    fill: true,
                    yAxisID: 'yTemp'
                },
                {
                    label: 'ความชื้น (%)',
                    data: [],
                    borderColor: '#1976d2',
                    backgroundColor: 'rgba(25,118,210,0.07)',
                    fill: true,
                    yAxisID: 'yHum'
                }
            ]
        },
        options: {
            ...BASE_OPTS,
            scales: {
                x: BASE_OPTS.scales.x,
                yTemp: {
                    type: 'linear', position: 'left',
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { font: { size: 10 }, color: '#f57c00' },
                    title: { display: true, text: '°C', color: '#f57c00', font: { size: 10 } }
                },
                yHum: {
                    type: 'linear', position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { font: { size: 10 }, color: '#1976d2' },
                    title: { display: true, text: '%', color: '#1976d2', font: { size: 10 } }
                }
            }
        }
    });

    // แสงสว่าง
    c.light = new Chart(document.getElementById(elIds.light), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'แสงสว่าง (lux)',
                data: [],
                borderColor: '#f9a825',
                backgroundColor: 'rgba(249,168,37,0.09)',
                fill: true
            }]
        },
        options: { ...BASE_OPTS }
    });

    // pH — จำนวนเส้นตามมุมมอง (ประวัติ 2 เส้น, รายงานรายลัง 1 เส้น)
    c.ph = new Chart(document.getElementById(elIds.ph), {
        type: 'line',
        data: {
            labels: [],
            datasets: view.ph.map(viewDataset)
        },
        options: {
            ...BASE_OPTS,
            scales: {
                x: BASE_OPTS.scales.x,
                y: {
                    ...BASE_OPTS.scales.y,
                    min: 0, max: 14,
                    title: { display: true, text: 'pH', font: { size: 10 } }
                }
            }
        }
    });

    // ไฟฟ้า (แกน Y คู่: แรงดัน / กระแส)
    c.power = new Chart(document.getElementById(elIds.power), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'แรงดัน (V)',
                    data: [],
                    borderColor: '#ff8f00',
                    backgroundColor: 'rgba(255,143,0,0.07)',
                    fill: true,
                    yAxisID: 'yVolt'
                },
                {
                    label: 'กระแส (A)',
                    data: [],
                    borderColor: '#2e7d32',
                    backgroundColor: 'rgba(46,125,50,0.07)',
                    fill: true,
                    yAxisID: 'yCurr'
                }
            ]
        },
        options: {
            ...BASE_OPTS,
            scales: {
                x: BASE_OPTS.scales.x,
                yVolt: {
                    type: 'linear', position: 'left',
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { font: { size: 10 }, color: '#ff8f00' },
                    title: { display: true, text: 'V', color: '#ff8f00', font: { size: 10 } }
                },
                yCurr: {
                    type: 'linear', position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { font: { size: 10 }, color: '#2e7d32' },
                    title: { display: true, text: 'A', color: '#2e7d32', font: { size: 10 } }
                }
            }
        }
    });

    // ระดับน้ำ — จำนวนถังตามมุมมอง (ประวัติ 6 ถัง, ลัง1 5 ถัง, ลัง2 4 ถัง)
    c.water = new Chart(document.getElementById(elIds.water), {
        type: 'line',
        data: {
            labels: [],
            datasets: view.water.map(viewDataset)
        },
        options: {
            ...BASE_OPTS,
            scales: {
                x: BASE_OPTS.scales.x,
                y: {
                    ...BASE_OPTS.scales.y,
                    min: 0, max: 100,
                    title: { display: true, text: '%', font: { size: 10 } }
                }
            }
        }
    });

    return c;
}

function initCharts() {
    Object.assign(charts, buildCharts({
        tempHum: 'chart-temphum', light: 'chart-light', ph: 'chart-ph',
        power: 'chart-power', water: 'chart-water'
    }));
}

const reportCharts = {};
let   reportView   = TRAY_VIEW.all;   // มุมมองของรอบปลูกที่กำลังเปิดดูอยู่

function initReportCharts() {
    Object.assign(reportCharts, buildCharts({
        tempHum: 'chart-report-temphum', light: 'chart-report-light', ph: 'chart-report-ph',
        power: 'chart-report-power', water: 'chart-report-water'
    }));
}

// สลับมุมมองของกราฟตอน runtime — จำเป็นเพราะ buildCharts รันครั้งเดียวตอนโหลดหน้า
// แต่ลังจะรู้ก็ต่อเมื่อผู้ใช้เลือกรอบปลูกแล้ว
// เปลี่ยน datasets ในที่ (Chart.js รองรับ) ไม่ต้อง destroy/recreate ซึ่งจะยุ่งกับ
// canvas ที่อยู่ใน tab-pane ที่ถูกซ่อนอยู่
function applyChartView(chartsObj, view) {
    for (const key of ['ph', 'water']) {
        const chart = chartsObj[key];
        if (!chart) continue;
        chart.data.labels   = [];
        chart.data.datasets = view[key].map(viewDataset);
        chart.update('none');
    }
}

// ============================================================
//  โหลดประวัติและแสดงในกราฟ
// ============================================================

function formatLabel(isoString) {
    const d   = new Date(isoString);
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const hh  = String(d.getHours()).padStart(2, '0');
    const mm  = String(d.getMinutes()).padStart(2, '0');
    return [`${hh}:${mm}`, `${day}/${mon}`];
}

function loadAndRenderHistory() {
    fetch('/api/history')
        .then(r => r.json())
        .then(data => {
            const ok = renderAllCharts(data, charts);
            setText('history-count', ok ? `${data.length} รายการ` : 'ยังไม่มีข้อมูล (รอ 1 นาทีแรก)');
        })
        .catch(err => {
            console.error('[History] Load error:', err);
            setText('history-count', 'ไม่สามารถโหลดได้');
        });
}

// วาดข้อมูลลงกราฟ 5 อันของ chartsObj ที่ระบุ (ใช้ร่วมกันทั้งหน้าประวัติและหน้ารายงานรอบปลูก)
// view กำหนดว่าเส้น pH/ระดับน้ำ มีกี่เส้นและดึงค่าจากฟิลด์ไหน — หน้าประวัติไม่ส่งมา
// จึงได้ TRAY_VIEW.all ซึ่งให้ผลเหมือนโค้ดเดิมทุกประการ
function renderAllCharts(data, chartsObj, view = TRAY_VIEW.all) {
    if (!data || data.length === 0) return false;

    const labels = data.map(d => formatLabel(d.ts));

    chartsObj.tempHum.data.labels           = labels;
    chartsObj.tempHum.data.datasets[0].data = data.map(d => d.t);
    chartsObj.tempHum.data.datasets[1].data = data.map(d => d.h);
    chartsObj.tempHum.update('none');

    chartsObj.light.data.labels           = labels;
    chartsObj.light.data.datasets[0].data = data.map(d => d.l);
    chartsObj.light.update('none');

    chartsObj.ph.data.labels = labels;
    view.ph.forEach((spec, i) => {
        chartsObj.ph.data.datasets[i].data = data.map(r => spec.get(r));
    });
    chartsObj.ph.update('none');

    chartsObj.power.data.labels           = labels;
    chartsObj.power.data.datasets[0].data = data.map(d => d.v);
    chartsObj.power.data.datasets[1].data = data.map(d => d.c);
    chartsObj.power.update('none');

    chartsObj.water.data.labels = labels;
    view.water.forEach((spec, i) => {
        chartsObj.water.data.datasets[i].data = data.map(r => spec.get(r));
    });
    chartsObj.water.update('none');

    return true;
}

// เพิ่มจุดใหม่เข้ากราฟโดยไม่ต้องโหลดใหม่ทั้งหมด
function appendPointToCharts(point) {
    const label = formatLabel(point.ts);

    function push(chart, values) {
        chart.data.labels.push(label);
        values.forEach((val, i) => chart.data.datasets[i].data.push(val));

        // ตัดข้อมูลเก่าถ้าเกิน 1440 จุด
        if (chart.data.labels.length > MAX_CHART_POINTS) {
            chart.data.labels.shift();
            chart.data.datasets.forEach(ds => ds.data.shift());
        }
        chart.update('none');
    }

    // ผูกกับ TRAY_VIEW.all เสมอ — กราฟ live เป็นของหน้าประวัติเท่านั้น
    // ไม่เกี่ยวกับมุมมองรายลังของหน้ารายงาน และจำนวนเส้นจะไม่มีวันหลุดจาก buildCharts
    push(charts.tempHum, [point.t, point.h]);
    push(charts.light,   [point.l]);
    push(charts.ph,      TRAY_VIEW.all.ph.map(spec => spec.get(point)));
    push(charts.power,   [point.v, point.c]);
    push(charts.water,   TRAY_VIEW.all.water.map(spec => spec.get(point)));

    // อัปเดตจำนวน
    const countEl = document.getElementById('history-count');
    if (countEl) {
        const cur = parseInt(countEl.textContent) || 0;
        countEl.textContent = `${cur + 1} รายการ`;
    }
}

// ============================================================
//  รายงานรอบปลูก (Crop Cycle Report)
// ============================================================

// ชนิดผักตั้งต้นใน dropdown — ยังพิมพ์ชื่ออื่นเองได้เสมอ (ใช้ <datalist> ไม่ใช่ <select>)
const CROP_PRESETS = [
    'ผักกาดหอม', 'กรีนโอ๊ค', 'เรดโอ๊ค', 'คอส', 'ผักบุ้ง',
    'คะน้า', 'กวางตุ้ง', 'ผักโขม', 'ขึ้นฉ่าย', 'โหระพา'
];

const CROP_TRAYS = [1, 2];

let cropListCache    = [];
let activeCropByTray = { 1: null, 2: null };
let trayNamesCache   = { 1: 'ลังปลูกผัก 1', 2: 'ลังปลูกผัก 2' };

// รอบเก่าก่อนมีระบบแยกลังนับเป็นลัง 1 (server migrate ให้แล้ว นี่กันเหนียวฝั่ง client)
function trayOf(cycle) {
    return cycle && cycle.tray === 2 ? 2 : 1;
}

function loadCropList() {
    fetch('/api/crops')
        .then(checkSession)
        .then(r => r.json())
        .then(data => {
            cropListCache    = data.cycles || [];
            activeCropByTray = data.actives || { 1: null, 2: null };
            if (data.trayNames) trayNamesCache = data.trayNames;
            updateCropControlUI();
            populateCropPresets();
            populateCropSelect();
        })
        .catch(err => { if (err.message !== 'session_expired') console.error('[Crops] Load error:', err); });
}

// รายการใน datalist = ชนิดตั้งต้น + ชนิดที่เคยปลูกไปแล้ว (ผักที่เคยปลูกจะโผล่เองรอบหน้า)
function populateCropPresets() {
    const list = document.getElementById('crop-preset-list');
    if (!list) return;

    const names = [...new Set([...CROP_PRESETS, ...cropListCache.map(c => c.cropName)])]
        .filter(Boolean);

    list.innerHTML = '';
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        list.appendChild(opt);
    });
}

function updateCropControlUI() {
    for (const tray of CROP_TRAYS) {
        const statusEl   = document.getElementById(`crop-active-status-${tray}`);
        const startBtn   = document.getElementById(`btn-crop-start-${tray}`);
        const harvestBtn = document.getElementById(`btn-crop-harvest-${tray}`);
        if (!statusEl) continue;

        const active = activeCropByTray[tray];
        if (active) {
            const d = new Date(active.startTime);
            statusEl.innerHTML = `🟢 กำลังปลูก: <b>${escapeHtml(active.cropName)}</b> (เริ่ม ${d.toLocaleDateString('th-TH')})`;
            if (startBtn)   startBtn.disabled = true;
            if (harvestBtn) harvestBtn.disabled = false;
        } else {
            statusEl.textContent = 'ยังไม่มีรอบปลูกที่กำลังดำเนินอยู่';
            if (startBtn)   startBtn.disabled = false;
            if (harvestBtn) harvestBtn.disabled = true;
        }
    }
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function populateCropSelect() {
    const sel = document.getElementById('crop-select');
    if (!sel) return;

    const prevValue = sel.value;
    sel.innerHTML = '';

    if (cropListCache.length === 0) {
        sel.innerHTML = '<option value="">ยังไม่มีรอบปลูก</option>';
        renderCropReportEmpty();
        return;
    }

    // แยกกลุ่มตามลัง จะได้เห็นทันทีว่ารอบไหนเป็นของลังไหน
    for (const tray of CROP_TRAYS) {
        const list = cropListCache.filter(c => trayOf(c) === tray);
        if (!list.length) continue;

        const group = document.createElement('optgroup');
        group.label = trayNamesCache[tray] || `ลังปลูกผัก ${tray}`;
        list.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            const dateStr = new Date(c.startTime).toLocaleDateString('th-TH');
            opt.textContent = (c.status === 'active' ? '🟢 ' : '') + `${c.cropName} (เริ่ม ${dateStr})`;
            group.appendChild(opt);
        });
        sel.appendChild(group);
    }

    const toSelect = cropListCache.some(c => c.id === prevValue) ? prevValue : cropListCache[0].id;
    sel.value = toSelect;
    sel.onchange = () => loadCropReport(sel.value);
    loadCropReport(toSelect);
}

// จำนวนคอลัมน์ของตารางสรุปตามมุมมองที่ใช้อยู่ (ลัง1 = 37, ลัง2 = 34)
function summaryColspan(view) {
    return 1 + 3 * summaryColumns(view).length;
}

// ล้างเฉพาะ "ข้อมูล" ของรายงาน (กราฟ + ตาราง) โดยไม่แตะหัวรายงาน
// เดิมโค้ด return ออกไปเลยตอนไม่มี record ทำให้กราฟของรอบก่อนค้างอยู่บนจอ
function clearReportData() {
    const cov = document.getElementById('report-coverage');
    if (cov) { cov.className = 'report-alert'; cov.innerHTML = ''; }

    for (const chart of Object.values(reportCharts)) {
        if (!chart) continue;
        chart.data.labels = [];
        chart.data.datasets.forEach(ds => { ds.data = []; });
        chart.update('none');
    }

    const head = document.getElementById('daily-summary-head');
    if (head) head.innerHTML = '';

    const body = document.getElementById('daily-summary-body');
    if (body) {
        body.innerHTML = `<tr><td colspan="${summaryColspan(reportView)}" style="text-align:center;color:#aaa;">ยังไม่มีข้อมูลในรอบปลูกนี้</td></tr>`;
    }
}

function renderCropReportEmpty() {
    setText('report-tray-name', '-');
    setText('report-crop-name', '-');
    setText('report-start-date', '-');
    setText('report-harvest-date', '-');
    setText('report-duration', '-');
    clearReportData();

    const body = document.getElementById('daily-summary-body');
    if (body) {
        body.innerHTML = `<tr><td colspan="${summaryColspan(reportView)}" style="text-align:center;color:#aaa;">เลือกรอบปลูกเพื่อแสดงข้อมูล</td></tr>`;
    }
}

function loadCropReport(id) {
    if (!id) return;
    fetch(`/api/crops/${encodeURIComponent(id)}`)
        .then(checkSession)
        .then(r => r.json())
        .then(cycle => {
            if (cycle.error) return;
            renderCropReport(cycle);
        })
        .catch(err => { if (err.message !== 'session_expired') console.error('[Crops] Report load error:', err); });
}

// stride-based downsample เพื่อไม่ให้กราฟช้า/รกเกินไปเมื่อรอบปลูกมีข้อมูลนับหมื่นจุด
function downsampleForChart(records, maxPoints = MAX_CHART_POINTS) {
    if (records.length <= maxPoints) return records;
    const stride = Math.max(1, Math.ceil(records.length / maxPoints));
    return records.filter((_, i) => i % stride === 0);
}

function renderCropReport(cycle) {
    currentReportCycle = cycle;   // เก็บไว้ให้ exportReportPdf() ใช้ต่อ ไม่ต้องยิง API ซ้ำ

    // ตั้งมุมมองก่อนทุกอย่าง — ต้องอยู่เหนือทางออกกรณีไม่มี record ด้วย
    // ไม่งั้นรอบที่เพิ่งเริ่มจะยังโชว์เส้นกราฟของลังก่อนหน้าค้างไว้
    const tray = trayOf(cycle);
    reportView = TRAY_VIEW[tray] || TRAY_VIEW.all;
    applyChartView(reportCharts, reportView);

    setText('report-tray-name', trayNamesCache[tray] || `ลังปลูกผัก ${tray}`);
    setText('report-crop-name', cycle.cropName);
    setText('report-start-date', new Date(cycle.startTime).toLocaleString('th-TH'));
    setText('report-harvest-date', cycle.endTime ? new Date(cycle.endTime).toLocaleString('th-TH') : 'กำลังปลูกอยู่');

    const endMs = cycle.endTime || Date.now();
    const days = Math.max(1, Math.ceil((endMs - cycle.startTime) / 86400000));
    setText('report-duration', `${days} วัน`);

    const header = document.getElementById('report-print-header');
    if (header) {
        const trayName = trayNamesCache[tray] || `ลังปลูกผัก ${tray}`;
        header.textContent =
            `รายงานรอบปลูก (${trayName}): ${cycle.cropName} — เริ่ม ${new Date(cycle.startTime).toLocaleDateString('th-TH')}` +
            (cycle.endTime ? ` ถึง ${new Date(cycle.endTime).toLocaleDateString('th-TH')}` : ' (กำลังปลูกอยู่)');
    }

    const records = cycle.records || [];
    if (records.length === 0) {
        clearReportData();   // หัวรายงานด้านบนยังอยู่ ล้างเฉพาะกราฟกับตาราง
        // ต้องวาดแถบเตือนหลัง clearReportData เสมอ — มันล้าง #report-coverage ไปด้วย
        renderCoverage(coverageOf(hourlyRows([], cycle.startTime, endMs)));
        return;
    }

    renderAllCharts(downsampleForChart(records), reportCharts, reportView);
    renderDailySummary(records, reportView);

    // ความครบถ้วนคิดจากแถวรายชั่วโมงชุดเดียวกับที่ PDF ใช้ ตัวเลขบนจอกับในไฟล์จึงตรงกัน
    renderCoverage(coverageOf(hourlyRows(records, cycle.startTime, endMs)));
}

// คอลัมน์ของตารางสรุปรายวัน — ประกอบจาก TRAY_VIEW ตัวเดียวกับที่ขับกราฟ
// หัวตาราง แถวย่อย และข้อมูล จึงมาจากที่เดียวกันหมด ไม่มีทางเหลื่อมกันได้
function summaryColumns(view) {
    return [
        { label: 'อุณหภูมิ (°C)', digits: 1, get: r => r.t },
        { label: 'ความชื้น (%)',  digits: 1, get: r => r.h },
        { label: 'แสง (lux)',     digits: 0, get: r => r.l },
        ...view.ph.map(spec => ({ label: spec.label, digits: 2, get: spec.get })),
        { label: 'แรงดัน (V)', digits: 1, get: r => r.v },
        { label: 'กระแส (A)',  digits: 2, get: r => r.c },
        { label: 'กำลัง (W)',  digits: 1, get: r => r.pw },
        ...view.water.map(spec => ({ label: spec.label, digits: 1, get: spec.get, skipNegative: true }))
    ];
}

// ดึงค่าของคอลัมน์จาก record — คืน null ถ้าใช้ค่านั้นไม่ได้
// ระดับน้ำใช้ -1 แทน "เซ็นเซอร์ไม่ตอบ" ไม่ใช่ระดับน้ำ 0 ถ้าปล่อยให้ไปเฉลี่ยด้วย
// ค่าเฉลี่ยจะถูกดึงต่ำลงทั้งช่วงโดยไม่มีใครสังเกต
function columnValue(col, r) {
    const v = col.get(r);
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if (col.skipNegative && v < 0) return null;
    return v;
}

function summaryStats(arr) {
    if (!arr.length) return { avg: null, min: null, max: null };
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { avg, min: Math.min(...arr), max: Math.max(...arr) };
}

// รวมข้อมูลรายวัน (avg/min/max) จากข้อมูลดิบทั้งหมด — ไม่ใช่ข้อมูลที่ downsample ไปทำกราฟ
function computeDailySummary(records, columns) {
    const days = new Map(); // dateKey -> [ค่าของคอลัมน์ที่ 0, ที่ 1, ...]

    for (const r of records) {
        const dateKey = new Date(r.ts).toLocaleDateString('th-TH');
        if (!days.has(dateKey)) days.set(dateKey, columns.map(() => []));
        const bucket = days.get(dateKey);
        columns.forEach((col, i) => {
            const v = columnValue(col, r);
            if (v !== null) bucket[i].push(v);
        });
    }

    return [...days.entries()].map(([date, bucket]) => ({
        date,
        cells: bucket.map(summaryStats)
    }));
}

function fmt(v, digits = 1) {
    return v === null || v === undefined ? '-' : v.toFixed(digits);
}

function renderDailySummary(records, view) {
    const head = document.getElementById('daily-summary-head');
    const body = document.getElementById('daily-summary-body');
    if (!head || !body) return;

    const columns = summaryColumns(view);

    head.innerHTML =
        '<tr><th rowspan="2">วันที่</th>' +
        columns.map(c => `<th colspan="3">${escapeHtml(c.label)}</th>`).join('') +
        '</tr><tr>' +
        columns.map(() => '<th>เฉลี่ย</th><th>ต่ำสุด</th><th>สูงสุด</th>').join('') +
        '</tr>';

    const rows = computeDailySummary(records, columns);
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="${1 + 3 * columns.length}" style="text-align:center;color:#aaa;">ไม่มีข้อมูล</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(row =>
        `<tr><td>${row.date}</td>` +
        row.cells.map((m, i) => {
            const d = columns[i].digits;
            return `<td>${fmt(m.avg, d)}</td><td>${fmt(m.min, d)}</td><td>${fmt(m.max, d)}</td>`;
        }).join('') +
        '</tr>'
    ).join('');
}

// ============================================================
//  ส่งออก PDF (A4 แนวตั้ง) — เอกสารรวมทั้งฟาร์ม
//
//  หน้าจอเป็นมุมมองรายลัง แต่ PDF ต้องมีทั้ง 2 ลังในเอกสารเดียว จึงสร้าง
//  เอกสารแยกไว้ที่ #print-report แทนที่จะพิมพ์หน้าจอตรงๆ
//
//  ทำได้โดยไม่ต้องยิง API เพิ่ม เพราะ recordCropData เขียน record ตัวเดียวกัน
//  ลงทุกรอบที่ active อยู่ → record ของรอบใดรอบหนึ่งมีค่าของทั้งฟาร์มครบแล้ว
// ============================================================

let currentReportCycle = null;
const printCharts = {};

// 13 คอลัมน์ตามแบบที่ผู้ใช้กำหนด (วันที่ + เวลา + อีก 11 ค่า)
// ไม่มี กำลัง(pw), ถังสารA(w[0]), ถังน้ำวนลัง1(w[4]) — ตามแบบ
// "ระดับน้ำ PH" = w[1] (ถังสารB) ซึ่งจะเป็นถัง pH ถังเดียวที่เติมทั้ง 2 ลัง
// key = ชื่อฟิลด์ปลายทางเวลาแปลงค่าเฉลี่ยรายชั่วโมงกลับเป็น record เพื่อวาดกราฟ
// (`w3` = waterLevel index 3) — ต้องมี key เพราะถ้าอ้างด้วยลำดับคอลัมน์
// วันไหนมีคนสลับลำดับตาราง กราฟจะแมปค่าผิดแบบเงียบ ๆ
const EXPORT_COLUMNS = [
    { key: 't',  label: 'อุณหภูมิ',     digits: 1, get: r => r.t },
    { key: 'h',  label: 'ความชื้น',     digits: 1, get: r => r.h },
    { key: 'l',  label: 'แสงสว่าง',     digits: 0, get: r => r.l },
    { key: 'p',  label: 'PHลัง1',       digits: 2, get: r => r.p },
    { key: 'p2', label: 'PHลัง2',       digits: 2, get: r => r.p2 },
    { key: 'v',  label: 'แรงดัน',       digits: 2, get: r => r.v },
    { key: 'c',  label: 'กระแส',        digits: 3, get: r => r.c },
    { key: 'w3', label: 'ระดับน้ำลัง1', digits: 1, get: r => (r.w || [])[3], skipNegative: true },
    { key: 'w5', label: 'ระดับน้ำลัง2', digits: 1, get: r => (r.w || [])[5], skipNegative: true },
    { key: 'w2', label: 'ระดับน้ำเติม', digits: 1, get: r => (r.w || [])[2], skipNegative: true },
    { key: 'w1', label: 'ระดับน้ำ PH',  digits: 1, get: r => (r.w || [])[1], skipNegative: true }
];

const pad2 = n => String(n).padStart(2, '0');
// คีย์ของชั่วโมง อิงเวลาท้องถิ่น (ไม่ใช่ UTC) เพราะรายงานอ่านโดยคนที่หน้างาน
const hourKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}`;

// รวมค่าเป็นรายชั่วโมง แล้วเติมแถวให้ครบทุกชั่วโมงตั้งแต่ from ถึง to
// ชั่วโมงที่ไม่มีข้อมูลต้องมีแถวว่าง ไม่ใช่หายไป — ไม่งั้นช่วงที่ระบบล่มจะดูเหมือนไม่เคยเกิดขึ้น
function hourlyRows(records, fromMs, toMs) {
    const buckets = new Map();
    for (const r of records) {
        const key = hourKey(new Date(r.ts));
        if (!buckets.has(key)) buckets.set(key, EXPORT_COLUMNS.map(() => []));
        const bucket = buckets.get(key);
        EXPORT_COLUMNS.forEach((col, i) => {
            const v = columnValue(col, r);
            if (v !== null) bucket[i].push(v);
        });
    }

    const rows = [];
    const cursor = new Date(fromMs);
    cursor.setMinutes(0, 0, 0);
    const end = new Date(toMs);

    // กันลูปไม่รู้จบถ้าช่วงวันเพี้ยน (เช่น endTime < startTime จาก index ที่เสียหาย)
    for (let guard = 0; cursor <= end && guard < 24 * 400; guard++) {
        const bucket = buckets.get(hourKey(cursor));
        rows.push({
            // ต้อง clone — cursor ถูก mutate ทุกรอบ ถ้าเก็บ reference ทุกแถวจะกลายเป็นเวลาเดียวกันหมด
            date: new Date(cursor),
            cells: EXPORT_COLUMNS.map((col, i) => {
                const vals = bucket ? bucket[i] : [];
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            })
        });
        cursor.setHours(cursor.getHours() + 1);
    }
    return rows;
}

// ============================================================
//  ความครบถ้วนของข้อมูล
//
//  record ถูกบันทึกเฉพาะตอน ESP32 ยิง POST /api/data เข้ามา ชั่วโมงที่บอร์ดออฟไลน์จึง
//  ไม่มีข้อมูลเลย แล้วโผล่ในตารางเป็น "-" ทั้งแถว ซึ่งดูเหมือนโปรแกรมพัง ทั้งที่เป็น
//  ข้อเท็จจริงของข้อมูล — ต้องบอกผู้ใช้ตรง ๆ ว่าขาดไปเท่าไหร่และขาดช่วงไหน
//
//  ผลพลอยได้: ช่วงที่ขาด = ประวัติการออฟไลน์ของ ESP32 ที่เก็บถาวรอยู่แล้ว ไม่ต้องเพิ่ม
//  ที่เก็บข้อมูลใหม่ และรอด restart / spin down ของ Render
// ============================================================

const COVERAGE_OK_RATIO = 0.95;   // ถึงเท่านี้ถือว่าครบ ไม่ต้องเตือน
const MIN_GAP_HOURS     = 2;      // ช่วงที่ขาดสั้นกว่านี้ไม่ต้องรายงาน (ระบบสะดุดชั่วคราว)
const MAX_GAPS_SHOWN    = 5;

// รับ rows ตัวเดียวกับที่ renderPrintTable ใช้ — ห้ามคิดใหม่จาก record ดิบ ไม่งั้นตัวเลข
// "ครบ N ชั่วโมง" กับจำนวนแถวที่มีค่าจริงในตารางจะไม่ตรงกัน
function coverageOf(rows) {
    const total = rows.length;
    const gaps  = [];
    let filled = 0, lastFilled = null, gapStart = null;

    function closeGap(endIdx) {
        const hours = endIdx - gapStart + 1;
        if (hours >= MIN_GAP_HOURS) {
            gaps.push({ from: rows[gapStart].date, to: rows[endIdx].date, hours });
        }
        gapStart = null;
    }

    rows.forEach((row, i) => {
        if (row.cells.some(v => v !== null)) {
            filled++;
            lastFilled = row.date;
            if (gapStart !== null) closeGap(i - 1);
        } else if (gapStart === null) {
            gapStart = i;
        }
    });
    if (gapStart !== null) closeGap(rows.length - 1);

    return {
        total, filled,
        ratio: total ? filled / total : 0,
        lastFilled,
        gaps: gaps.sort((a, b) => b.hours - a.hours).slice(0, MAX_GAPS_SHOWN)
    };
}

// "7 ก.ย. 23:00" — ใช้กับหัวและท้ายของช่วงที่ขาดข้อมูล
function fmtHourLabel(d) {
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) +
           ' ' + pad2(d.getHours()) + ':00';
}

function renderCoverage(cov) {
    const el = document.getElementById('report-coverage');
    if (!el) return;

    if (!cov || !cov.total) { el.className = 'report-alert'; el.innerHTML = ''; return; }

    const pct = Math.round(cov.ratio * 100);

    if (cov.filled === 0) {
        el.className = 'report-alert bad';
        el.innerHTML =
            '<b>⚠️ รอบปลูกนี้ยังไม่มีข้อมูลเซ็นเซอร์เลย</b>' +
            '<div>ค่าในรายงานถูกบันทึกเฉพาะตอนที่ ESP32 ยิงข้อมูลเข้ามาที่เซิร์ฟเวอร์นี้ ' +
            'ถ้าบอร์ดออฟไลน์อยู่จะไม่มีอะไรถูกบันทึก</div>';
        return;
    }

    if (cov.ratio >= COVERAGE_OK_RATIO) {
        el.className = 'report-alert ok';
        el.innerHTML = '✓ ข้อมูลครบ ' + cov.filled + ' จาก ' + cov.total + ' ชั่วโมง (' + pct + '%)';
        return;
    }

    let html = '<b>⚠️ มีข้อมูลเซ็นเซอร์ ' + cov.filled + ' จาก ' + cov.total +
               ' ชั่วโมง (' + pct + '%)</b>';
    if (cov.lastFilled) {
        html += '<div>ข้อมูลล่าสุด: ' + fmtHourLabel(cov.lastFilled) + ' น.</div>';
    }
    if (cov.gaps.length) {
        html += '<div>ช่วงที่ไม่มีข้อมูล: ' + cov.gaps.map(g =>
            fmtHourLabel(g.from) + ' → ' + fmtHourLabel(g.to) + ' (' + g.hours + ' ชม.)'
        ).join(' · ') + '</div>';
    }
    html += '<div class="report-alert-hint">ชั่วโมงที่ไม่มีข้อมูลจะแสดงเป็น "-" ทั้งแถวในตารางของ PDF</div>';

    el.className = 'report-alert ' + (cov.ratio < 0.5 ? 'bad' : 'warn');
    el.innerHTML = html;
}

function renderPrintTable(rows) {
    const table = document.getElementById('print-hourly');
    if (!table) return;

    table.querySelector('thead').innerHTML =
        '<tr><th>วันที่</th><th>เวลา</th>' +
        EXPORT_COLUMNS.map(c => `<th>${escapeHtml(c.label)}</th>`).join('') +
        '</tr>';

    let lastDay = '';
    table.querySelector('tbody').innerHTML = rows.map(row => {
        const d = row.date;
        const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        // แสดงวันที่เฉพาะแถวแรกของแต่ละวัน ตามแบบที่ผู้ใช้กำหนด
        const dateCell = dayKey === lastDay
            ? ''
            : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
        lastDay = dayKey;

        const cells = row.cells
            .map((v, i) => `<td>${fmt(v, EXPORT_COLUMNS[i].digits)}</td>`).join('');
        return `<tr><td class="col-date">${dateCell}</td><td class="col-time">${d.getHours()}:00</td>${cells}</tr>`;
    }).join('');
}

// มุมมองกราฟของเอกสาร — เส้นตรงกับคอลัมน์ในตารางเป๊ะ ทั้งชนิดและลำดับ
// ระดับน้ำเหลือ 4 ถังตามตาราง (ตัดถังสารA w[0] กับ ถังน้ำวนลัง1 w[4] ที่ไม่ได้อยู่ในตารางออก)
// ใช้ label/สี จาก TRAY_VIEW.all ตัวเดิม จะได้นิยามที่เดียว
const PRINT_VIEW = (() => {
    const w = TRAY_VIEW.all.water;
    return { ph: TRAY_VIEW.all.ph, water: [w[3], w[5], w[2], w[1]] };
})();

// แปลงค่าเฉลี่ยรายชั่วโมงกลับเป็นรูป record มาตรฐาน เพื่อใช้ renderAllCharts เดิมได้เลย
// (มันอ่าน d.t / d.h / d.l / d.v / d.c ตรง ๆ มีแต่ pH กับระดับน้ำที่ผ่าน accessor ของ view)
function hourlyToRecords(rows) {
    return rows.map(row => {
        const rec = { ts: row.date.toISOString(), w: [null, null, null, null, null, null] };
        EXPORT_COLUMNS.forEach((col, i) => {
            const m = /^w(\d)$/.exec(col.key);
            if (m) rec.w[Number(m[1])] = row.cells[i];
            else   rec[col.key] = row.cells[i];
        });
        return rec;
    });
}

// กราฟในเอกสารวาดจาก "ค่าในตาราง" ชุดเดียวกัน ไม่ใช่ record ดิบ
// ทำให้ตัวเลขบนกราฟกับในตารางตรงกันโดยโครงสร้าง และแกน X ครอบคลุมตั้งแต่วันเริ่มปลูก
// ถึงวันเก็บเกี่ยว (hourlyRows สร้างแถวครบทุกชั่วโมงอยู่แล้ว) ชั่วโมงที่ไม่มีข้อมูลเป็น null
// Chart.js จะวาดเป็นเส้นขาด เห็นชัดว่าช่วงไหนระบบไม่ได้เก็บข้อมูล
// ============================================================
//  แกน X ของกราฟในเอกสาร
//
//  ทุกป้ายอยู่ "แถวเดียว" ไม่ใช่สองบรรทัด (เวลา/วันที่) แบบบนจอ เริ่มจากชั่วโมงที่
//  เริ่มปลูก และแทรกวันที่นำหน้าเฉพาะป้ายแรกกับป้ายที่ข้ามไปวันใหม่ — จะได้รู้ว่า
//  ชั่วโมงไหนอยู่วันไหนโดยไม่ต้องเขียนวันที่ซ้ำทุกป้าย
//
//  จำนวนชั่วโมงที่โชว์ได้ขึ้นกับที่ว่างจริง (ดู fitPrintXStride) รายงาน 1 วันได้
//  ชั่วโมงเว้นชั่วโมง เพราะป้ายที่มีวันที่กว้างเกินกว่าจะยัดครบ 24 ป้าย
// ============================================================

const PRINT_X_FONT_PX      = 7;
const PRINT_X_LABEL_GAP    = 6;     // ช่องว่างขั้นต่ำระหว่างป้าย
const PRINT_X_AXIS_RESERVE = 110;   // ความกว้างที่แกน Y ซ้าย+ขวากินไป ไม่ใช่ของแกน X

// ป้ายชุดเดียวกับที่จะวาดจริง — ป้ายที่ไม่ถึงคิวเป็น '' (ห้ามเป็น null:
// null ยังถูกนับเป็นป้ายที่กินที่อยู่)
//
// ทุกป้ายเป็นสตริงบรรทัดเดียวเสมอ วันที่ต่อหน้าเวลาไปเลย ("07/09 22:00")
// เคยลองแบบวางวันที่ไว้บรรทัดล่างเพื่อให้ป้ายแคบลงจนใส่ครบทุกชั่วโมงได้
// แต่ผู้ใช้เลือกแบบบรรทัดเดียวนี้ ยอมให้ชั่วโมงห่างขึ้นแทน — อย่าเอากลับมา
function buildPrintXLabels(points, stride) {
    const out = [];
    let lastDay = null;
    points.forEach((p, i) => {
        if (i % stride !== 0) { out.push(''); return; }
        const d      = new Date(p.ts);
        const dayKey = d.toDateString();
        const hh     = pad2(d.getHours()) + ':00';
        // วันที่โผล่เฉพาะตอนเปลี่ยนวัน — เทียบกับป้ายที่ "โชว์จริง" ป้ายก่อนหน้า
        // ไม่ใช่จุดข้อมูลก่อนหน้า ไม่งั้นตอน stride > 1 วันที่จะหายไปทั้งวัน
        out.push(dayKey === lastDay
            ? hh
            : pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + ' ' + hh);
        lastDay = dayKey;
    });
    return out;
}

// เลือกระยะห่างป้ายจาก "ความกว้างจริงของตัวอักษร" ไม่ใช่จำนวนป้ายตายตัว
//
// ⚠️ เกณฑ์ที่ถูกต้องคือ "คู่ที่กว้างที่สุด" ไม่ใช่ผลรวมความกว้างทั้งแถว — ป้ายถูกวาง
// กึ่งกลาง tick ระยะห่าง tick เท่ากันหมด ป้ายที่มีวันที่ (กว้างเกือบ 2 เท่าของป้าย
// ชั่วโมงเปล่า) จึงกินพื้นที่ของเพื่อนข้าง ๆ แม้ผลรวมทั้งแถวจะยังไม่เต็มแกน
// (เคยคิดจากผลรวม เลยผ่านทั้งที่ป้ายวันที่ทับป้ายถัดไป 0.3px)
//
// ป้ายวันที่กว้างเกือบ 2 เท่า รายงาน 1 วันจึงได้ชั่วโมงเว้นชั่วโมง ไม่ใช่ครบ 24 ชั่วโมง
// — เป็นราคาที่ยอมจ่ายเพื่อให้ทุกป้ายอยู่บรรทัดเดียว
function fitPrintXStride(points) {
    const n = points.length;
    if (n < 2) return { stride: 1, labels: buildPrintXLabels(points, 1) };

    const canvas = document.getElementById('chart-print-temphum');
    const axisPx = Math.max(200,
        (canvas ? canvas.getBoundingClientRect().width : 718) - PRINT_X_AXIS_RESERVE);

    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = PRINT_X_FONT_PX + 'px Helvetica, Arial, sans-serif';

    const fits = (labels, stride) => {
        const shown = labels.filter(l => l !== '');
        if (shown.length < 2) return true;
        let widest = 0;
        for (let i = 1; i < shown.length; i++) {
            widest = Math.max(widest,
                (ctx.measureText(shown[i - 1]).width + ctx.measureText(shown[i]).width) / 2);
        }
        return widest + PRINT_X_LABEL_GAP <= axisPx * stride / (n - 1);
    };

    for (let stride = 1; stride <= n; stride++) {
        const labels = buildPrintXLabels(points, stride);
        if (fits(labels, stride)) return { stride, labels };
    }
    return { stride: n, labels: buildPrintXLabels(points, n) };
}

// ต้องปิด autoSkip ไม่งั้น Chart.js จะข้ามป้ายซ้ำอีกชั้นจนไม่ครบทุกชั่วโมง
// การกันป้ายทับกันจึงเป็นหน้าที่ของ fitPrintXStride ทั้งหมด
function applyPrintXTicks(points) {
    if (!points.length) return;
    const { labels } = fitPrintXStride(points);
    for (const chart of Object.values(printCharts)) {
        chart.options.scales.x.ticks.callback = (v, i) => labels[i] ?? '';
    }
}

function renderPrintCharts(rows) {
    if (!printCharts.ph) {
        Object.assign(printCharts, buildCharts({
            tempHum: 'chart-print-temphum', light: 'chart-print-light', ph: 'chart-print-ph',
            power:   'chart-print-power',   water: 'chart-print-water'
        }, PRINT_VIEW));

        // ปิด animation — ถ้าพิมพ์ตอนกราฟยังวาดไม่จบจะได้เส้นครึ่งๆ ใน PDF
        for (const chart of Object.values(printCharts)) {
            chart.options.animation = false;
            chart.options.responsive = true;

            // ⚠️ ต้องสร้าง object ใหม่ ห้าม mutate ของเดิม — buildCharts ส่ง
            // BASE_OPTS.scales.x ตัวเดียวกันให้กราฟทุกตัวรวมถึงกราฟบนหน้าจอ
            // ถ้าแก้ทับลงไปตรง ๆ แกน X ของหน้าประวัติจะเปลี่ยนตามไปด้วย
            chart.options.scales.x = {
                ...chart.options.scales.x,
                ticks: {
                    ...chart.options.scales.x.ticks,
                    autoSkip: false, maxRotation: 0, minRotation: 0,
                    // ต้องเป็นตัวเดียวกับที่ fitPrintXStride ใช้วัดความกว้างป้าย
                    // ไม่งั้นการกันป้ายทับกันจะคำนวณจากขนาดตัวอักษรผิดตัว
                    font: { size: PRINT_X_FONT_PX }
                }
            };
        }
    }

    // downsample เป็นตัวกันเหนียว — 20 วัน = 480 จุด ยังห่างจากลิมิต 1,440 มาก
    // จะเริ่มถูกลดจุดก็ต่อเมื่อรอบปลูกยาวเกิน 60 วัน
    const points = downsampleForChart(hourlyToRecords(rows));
    applyPrintXTicks(points);   // ต้องมาก่อน update — renderAllCharts เรียก chart.update() ให้
    renderAllCharts(points, printCharts, PRINT_VIEW);
}

async function exportReportPdf() {
    const cycle = currentReportCycle;
    if (!cycle) { showToast('เลือกรอบปลูกก่อน'); return; }

    const records = cycle.records || [];
    if (!records.length) { showToast('รอบปลูกนี้ยังไม่มีข้อมูล'); return; }

    const fromMs = cycle.startTime;
    const toMs   = cycle.endTime || Date.now();
    const days   = Math.max(1, Math.ceil((toMs - fromMs) / 86400000));

    // ชื่อพืชของทั้ง 2 ลัง — รอบที่เลือกให้ได้ชื่อลังตัวเอง อีกลังดึงจากรายการรอบปลูก
    const trayCrop = {};
    for (const tray of CROP_TRAYS) {
        const match = cropListCache.find(c =>
            trayOf(c) === tray && c.startTime <= toMs && (c.endTime || Date.now()) >= fromMs);
        trayCrop[tray] = match ? match.cropName : '-';
    }

    // คำนวณครั้งเดียว ใช้ทั้งตาราง กราฟ และบรรทัดสรุปความครบถ้วน
    // — ตัวเลขทุกที่จึงตรงกันโดยโครงสร้าง ไม่ใช่ความบังเอิญ
    const rows = hourlyRows(records, fromMs, toMs);
    const cov  = coverageOf(rows);
    const pct  = Math.round(cov.ratio * 100);

    // ⚠️ ต้องถามให้จบก่อนใส่ class printing — ถ้า confirm() เด้งตอน body อยู่โหมดพิมพ์
    // หน้าจอจะกลายเป็นเอกสารพิมพ์ค้างไว้ระหว่างรอคำตอบ
    if (cov.filled === 0) {
        showToast('รอบปลูกนี้ไม่มีข้อมูลเซ็นเซอร์เลย — ยังส่งออกไม่ได้');
        return;
    }
    if (cov.ratio < 0.9 && !confirm(
            'มีข้อมูลจริงแค่ ' + cov.filled + ' จาก ' + cov.total + ' ชั่วโมง (' + pct + '%)\n' +
            'ชั่วโมงที่เหลือจะเป็น "-" ในตาราง\n\nต้องการส่งออกต่อหรือไม่?')) {
        return;
    }

    const dt = ms => new Date(ms).toLocaleDateString('th-TH');
    const meta = document.getElementById('print-meta');
    if (meta) {
        // บอกความครบถ้วนไว้ในตัวเอกสารด้วย คนที่ได้ไปแต่ไฟล์ PDF จะได้รู้ว่าทำไมตารางเป็น "-"
        const covLine = cov.ratio >= 1
            ? '<div><b>ความครบถ้วนของข้อมูล:</b> ครบทั้ง ' + cov.total + ' ชั่วโมง</div>'
            : '<div class="print-meta-warn"><b>ความครบถ้วนของข้อมูล:</b> มีข้อมูล ' +
              cov.filled + ' จาก ' + cov.total + ' ชั่วโมง (' + pct + '%) — ' +
              'ชั่วโมงที่ไม่มีข้อมูลแสดงเป็น "-"</div>';

        meta.innerHTML =
            `<div><b>ลังปลูกผัก 1:</b> ${escapeHtml(trayCrop[1])} &nbsp;&nbsp; ` +
            `<b>ลังปลูกผัก 2:</b> ${escapeHtml(trayCrop[2])}</div>` +
            `<div><b>ช่วงเวลา:</b> ${dt(fromMs)} ถึง ${cycle.endTime ? dt(toMs) : 'ปัจจุบัน (กำลังปลูกอยู่)'} ` +
            `— รวม ${days} วัน</div>` +
            `<div><b>ค่าในตาราง:</b> ค่าเฉลี่ยรายชั่วโมง (บันทึกทุก 5 นาที)</div>` +
            covLine +
            `<div><b>พิมพ์เมื่อ:</b> ${new Date().toLocaleString('th-TH')}</div>`;
    }

    renderPrintTable(rows);

    // @page ขอ A4 ไว้ แต่ Chrome ให้ค่าที่ผู้ใช้เลือกไว้ครั้งก่อนชนะเสมอ บังคับจาก CSS ไม่ได้
    // toast ตัวนี้ถูกซ่อนอยู่แล้วใน @media print จึงไม่ติดไปในไฟล์ที่พิมพ์
    showToast('ในหน้าต่างพิมพ์: เลือกขนาดกระดาษ A4 และเปิด "กราฟิกพื้นหลัง"');

    // ต้องโชว์ก่อนสร้างกราฟ — canvas ที่ display:none วัดขนาดไม่ได้ Chart.js จะวาดลงบน 0x0
    document.body.classList.add('printing');
    try {
        renderPrintCharts(rows);
        // รอ 2 frame ให้ browser จัด layout และ Chart.js วาดลง canvas จริงก่อนสั่งพิมพ์
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.print();
    } finally {
        document.body.classList.remove('printing');
    }
}

function startCropCycle(tray) {
    const input = document.getElementById(`crop-name-input-${tray}`);
    if (!input) return;

    const cropName = input.value.trim();
    if (!cropName) {
        showToast('กรุณาระบุชื่อพืช');
        return;
    }

    fetch('/api/crops/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropName, tray })
    })
    .then(r => r.json())
    .then(data => {
        if (data.ok) {
            showToast(`เริ่มปลูก "${cropName}" ที่${trayNamesCache[tray] || `ลัง ${tray}`}แล้ว`);
            input.value = '';
            loadCropList();
        } else {
            showToast(data.error || 'เกิดข้อผิดพลาด');
        }
    })
    .catch(() => showToast('เกิดข้อผิดพลาด'));
}

function harvestCropCycle(tray) {
    const active = activeCropByTray[tray];
    if (!active) return;

    const trayName = trayNamesCache[tray] || `ลัง ${tray}`;
    if (!confirm(`ต้องการเก็บเกี่ยว "${active.cropName}" ที่${trayName} และปิดรอบปลูกนี้หรือไม่?`)) return;

    fetch(`/api/crops/${encodeURIComponent(active.id)}/end`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
        if (data.ok) {
            showToast(`เก็บเกี่ยว${trayName}เรียบร้อย`);
            loadCropList();
        } else {
            showToast(data.error || 'เกิดข้อผิดพลาด');
        }
    })
    .catch(() => showToast('เกิดข้อผิดพลาด'));
}

// ============================================================
//  Socket.io Events
// ============================================================

socket.on('sensorData',  updateSensorUI);

socket.on('relayUpdate', (data) => {
    if (Array.isArray(data.relays)) updateRelayUI(data.relays);
});

// รับจุดประวัติใหม่จาก server (ทุก 1 นาที)
socket.on('historyPoint', appendPointToCharts);

socket.on('connect', () => {
    console.log('[Socket] Connected to server');
    serverDown = false;
    // restore settings กลับไปที่ server ทันทีที่ connect (กัน server restart ทำให้ค่าหาย)
    restoreAutoSettingsFromLocal();
});

socket.on('disconnect', () => {
    serverDown = true;
    refreshEspBadges();
});

// ============================================================
//  Auto Mode
// ============================================================

let countdownInterval     = null;
let trayCountdownInterval = null;
let trayData = [
    { phase: 'idle', phaseEndAt: 0, nextCycleAt: 0 },
    { phase: 'idle', phaseEndAt: 0, nextCycleAt: 0 }
];

const TRAY_PHASE_LABEL = {
    filling:  '💧 กำลังเติมน้ำ',
    soaking:  '⏸️ แช่น้ำอยู่',
    draining: '🔄 สูบน้ำออก',
    idle:     ''
};

function updateTrayStatusEl(idx) {
    const el = document.getElementById(`tray${idx + 1}-status`);
    if (!el) return;
    const td  = trayData[idx];
    const now = Date.now();
    const pre = `🌱 ลัง${idx + 1}: `;

    if (td.phase === 'filling') {
        el.textContent = `${pre}🚿 กำลังเติมน้ำ...`;
        el.className = 'tray-status active';
    } else if (td.phase === 'soaking') {
        const rem = Math.max(0, td.phaseEndAt - now);
        const m   = Math.floor(rem / 60000);
        const sec = String(Math.floor((rem % 60000) / 1000)).padStart(2, '0');
        el.textContent = `${pre}⏸️ แช่น้ำ — เหลือ ${m}:${sec} นาที`;
        el.className = 'tray-status soaking';
    } else if (td.phase === 'draining') {
        el.textContent = `${pre}🔄 สูบน้ำออก...`;
        el.className = 'tray-status active';
    } else {
        const rem = Math.max(0, td.nextCycleAt - now);
        if (rem > 0) {
            const h = Math.floor(rem / 3600000);
            const m = Math.floor((rem % 3600000) / 60000);
            el.textContent = `${pre}⏱️ รอบถัดไปในอีก ${h} ชม. ${m} นาที`;
        } else {
            el.textContent = `${pre}—`;
        }
        el.className = 'tray-status idle';
    }
}

const SENSOR_NAMES = ['ถังสารA', 'ถังสารB', 'ถังน้ำเติม',
                      'ลังปลูกผัก1', 'ถังน้ำวนลัง1',
                      'ลังปลูกผัก2'];

function buildRelayOptions(includeNone) {
    let html = includeNone ? '<option value="-1">— ไม่ใช้ —</option>' : '';
    for (let i = 0; i < 10; i++) {
        html += `<option value="${i}">R${i + 1} — ${RELAY_NAMES[i]}</option>`;
    }
    return html;
}

function buildSensorOptions() {
    return SENSOR_NAMES.map((name, i) => `<option value="${i}">${i} — ${name}</option>`).join('');
}

function initRelaySelects() {
    ['ph1-up-relay','ph1-down-relay','ph2-up-relay','ph2-down-relay',
     'tray1-fill-relay','tray1-drain-relay','tray2-fill-relay','tray2-drain-relay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = buildRelayOptions(true);
    });
    ['tray1-refill-relay','tray2-refill-relay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = buildRelayOptions(true);
    });
    ['tray1-sensor','tray2-sensor','tray1-refill-sensor','tray2-refill-sensor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = buildSensorOptions();
    });
}

function setMode(mode) {
    // อัปเดต UI ทันที (optimistic)
    const isAuto = mode === 'auto';
    document.getElementById('btn-auto').classList.toggle('active', isAuto);
    document.getElementById('btn-manual').classList.toggle('active', !isAuto);
    document.getElementById('auto-panel').style.display    = isAuto ? 'block' : 'none';
    document.getElementById('relay-section').style.display = isAuto ? 'none'  : 'block';

    fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
    }).catch(err => console.error('[Mode]', err));
}

function buildAutoSettingsPayload() {
    const getF = id => parseFloat(document.getElementById(id)?.value) || 0;
    const getI = id => { const v = parseInt(document.getElementById(id)?.value); return isNaN(v) ? -1 : v; };
    return {
        ph1Min:            getF('ph1-min')          || 5.5,
        ph1Max:            getF('ph1-max')          || 7.0,
        ph1UpRelay:        getI('ph1-up-relay'),
        ph1DownRelay:      getI('ph1-down-relay'),
        ph2Min:            getF('ph2-min')          || 5.5,
        ph2Max:            getF('ph2-max')          || 7.0,
        ph2UpRelay:        getI('ph2-up-relay'),
        ph2DownRelay:      getI('ph2-down-relay'),
        doseTime:          getF('dose-time')        || 3,
        tray1RefillRelay:  getI('tray1-refill-relay'),
        tray1RefillMin:    getF('tray1-refill-min') || 20,
        tray1RefillMax:    getF('tray1-refill-max') || 80,
        tray1RefillSensor: getI('tray1-refill-sensor'),
        tray2RefillRelay:  getI('tray2-refill-relay'),
        tray2RefillMin:    getF('tray2-refill-min') || 20,
        tray2RefillMax:    getF('tray2-refill-max') || 80,
        tray2RefillSensor: getI('tray2-refill-sensor'),
        tray1FillTarget:   getF('tray1-fill-target')  || 80,
        tray1SoakTime:     getF('tray1-soak-time')    || 30,
        tray1DrainTarget:  getF('tray1-drain-target') || 20,
        tray1CycleHours:   getF('tray1-cycle-hours')  || 6,
        tray1FillRelay:    getI('tray1-fill-relay'),
        tray1DrainRelay:   getI('tray1-drain-relay'),
        tray1Sensor:       getI('tray1-sensor'),
        tray2FillTarget:   getF('tray2-fill-target')  || 80,
        tray2SoakTime:     getF('tray2-soak-time')    || 30,
        tray2DrainTarget:  getF('tray2-drain-target') || 20,
        tray2CycleHours:   getF('tray2-cycle-hours')  || 6,
        tray2FillRelay:    getI('tray2-fill-relay'),
        tray2DrainRelay:   getI('tray2-drain-relay'),
        tray2Sensor:       getI('tray2-sensor')
    };
}

function pushAutoSettings(payload) {
    return fetch('/api/auto-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

function saveAutoSettings() {
    const payload = buildAutoSettingsPayload();
    pushAutoSettings(payload)
        .then(() => {
            // บันทึกลง localStorage ด้วย เพื่อ restore หลัง server restart
            localStorage.setItem('auto-settings', JSON.stringify(payload));
            const btn = document.querySelector('.btn-save-auto');
            if (!btn) return;
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fa fa-check"></i> บันทึกแล้ว!';
            setTimeout(() => { btn.innerHTML = orig; }, 1500);
        })
        .catch(err => console.error('[AutoSettings]', err));
}

function restoreAutoSettingsFromLocal() {
    try {
        const saved = localStorage.getItem('auto-settings');
        if (!saved) return;
        pushAutoSettings(JSON.parse(saved)).catch(() => {});
    } catch (e) {}
}

function updateAutoUI(data) {
    const isAuto = !!data.autoMode;
    document.getElementById('btn-auto').classList.toggle('active', isAuto);
    document.getElementById('btn-manual').classList.toggle('active', !isAuto);
    document.getElementById('auto-panel').style.display    = isAuto ? 'block' : 'none';
    document.getElementById('relay-section').style.display = isAuto ? 'none'  : 'block';

    const s = data.autoSettings;
    if (s) updateRunSettingsUI(s);
    if (s) {
        document.getElementById('ph1-min').value        = s.ph1Min;
        document.getElementById('ph1-max').value        = s.ph1Max;
        document.getElementById('ph1-up-relay').value   = s.ph1UpRelay;
        document.getElementById('ph1-down-relay').value = s.ph1DownRelay;
        document.getElementById('ph2-min').value        = s.ph2Min;
        document.getElementById('ph2-max').value        = s.ph2Max;
        document.getElementById('ph2-up-relay').value   = s.ph2UpRelay;
        document.getElementById('ph2-down-relay').value = s.ph2DownRelay;
        document.getElementById('dose-time').value           = s.doseTime;
        document.getElementById('tray1-refill-relay').value  = s.tray1RefillRelay ?? -1;
        document.getElementById('tray1-refill-min').value    = s.tray1RefillMin;
        document.getElementById('tray1-refill-max').value    = s.tray1RefillMax;
        document.getElementById('tray1-refill-sensor').value = s.tray1RefillSensor ?? 3;
        document.getElementById('tray2-refill-relay').value  = s.tray2RefillRelay ?? -1;
        document.getElementById('tray2-refill-min').value    = s.tray2RefillMin;
        document.getElementById('tray2-refill-max').value    = s.tray2RefillMax;
        document.getElementById('tray2-refill-sensor').value = s.tray2RefillSensor ?? 5;
        document.getElementById('tray1-fill-target').value  = s.tray1FillTarget;
        document.getElementById('tray1-soak-time').value    = s.tray1SoakTime;
        document.getElementById('tray1-drain-target').value = s.tray1DrainTarget;
        document.getElementById('tray1-cycle-hours').value  = s.tray1CycleHours;
        document.getElementById('tray1-fill-relay').value   = s.tray1FillRelay;
        document.getElementById('tray1-drain-relay').value  = s.tray1DrainRelay;
        document.getElementById('tray1-sensor').value       = s.tray1Sensor ?? 3;
        document.getElementById('tray2-fill-target').value  = s.tray2FillTarget;
        document.getElementById('tray2-soak-time').value    = s.tray2SoakTime;
        document.getElementById('tray2-drain-target').value = s.tray2DrainTarget;
        document.getElementById('tray2-cycle-hours').value  = s.tray2CycleHours;
        document.getElementById('tray2-fill-relay').value   = s.tray2FillRelay;
        document.getElementById('tray2-drain-relay').value  = s.tray2DrainRelay;
        document.getElementById('tray2-sensor').value       = s.tray2Sensor ?? 5;
    }

    // เก็บ tray end time เพื่อ countdown
    const now = Date.now();
    if (data.trayStatus) {
        data.trayStatus.forEach((st, i) => {
            trayData[i].phase       = st.phase;
            trayData[i].phaseEndAt  = now + (st.phaseEndsIn || 0);
            trayData[i].nextCycleAt = now + (st.nextCycleIn || 0);
        });
    }

    clearInterval(countdownInterval);
    clearInterval(trayCountdownInterval);
    const el = document.getElementById('auto-status-text');

    if (!isAuto) {
        el.textContent = '—';
        el.className   = 'auto-status-text';
        ['tray1-status','tray2-status'].forEach(id => {
            const te = document.getElementById(id);
            if (te) { te.textContent = ''; te.className = 'tray-status idle'; }
        });
        return;
    }

    trayCountdownInterval = setInterval(() => {
        updateTrayStatusEl(0);
        updateTrayStatusEl(1);
    }, 1000);
    updateTrayStatusEl(0);
    updateTrayStatusEl(1);

    if (data.doseLabel) {
        el.className   = 'auto-status-text dose-active';
        el.textContent = `🧪 กำลังเติมสาร: ${data.doseLabel}`;
    } else {
        el.textContent = '— ระบบ AUTO พร้อมทำงาน —';
        el.className   = 'auto-status-text';
    }
}

socket.on('autoStatus', updateAutoUI);

// ============================================================
//  Run Program Page
// ============================================================

let runState          = { running: false, startTime: null, mode: 'manual' };
let selectedRunMode   = 'auto';
let runTimerInterval  = null;

function applyRunModeBtns(mode) {
    document.getElementById('run-mode-auto')  ?.classList.toggle('active', mode === 'auto');
    document.getElementById('run-mode-manual')?.classList.toggle('active', mode === 'manual');
}

function selectRunMode(mode) {
    if (runState.running && mode === 'manual') {
        // กด MANUAL ขณะรัน = หยุดโปรแกรม (ต้องยืนยัน)
        if (!confirm('ต้องการหยุดโปรแกรม?\nRelay ทั้งหมดจะถูกปิด')) return;
        fetch('/api/program/stop', { method: 'POST' })
            .catch(e => console.error('[Program stop]', e));
        return;
    }
    selectedRunMode = mode;
    applyRunModeBtns(mode);
}

function toggleProgram() {
    const btn   = document.getElementById('btn-run-toggle');
    const icon  = document.getElementById('run-btn-icon');
    const label = document.getElementById('run-btn-label');

    if (runState.running) {
        if (!confirm('ต้องการหยุดโปรแกรม?\nRelay ทั้งหมดจะถูกปิด')) return;
        if (btn)   btn.disabled = true;
        if (label) label.textContent = 'กำลังหยุด...';
        fetch('/api/program/stop', { method: 'POST' })
            .then(checkSession)
            .then(r => r.json())
            .then(() => {
                if (btn) btn.disabled = false;
                runState.running = false;
                updateRunUI(runState);
            })
            .catch(e => {
                if (e.message === 'session_expired') return;
                console.error('[Program]', e);
                if (btn)   btn.disabled = false;
                if (label) label.textContent = 'STOP';
            });
    } else {
        if (btn)   btn.disabled = true;
        if (label) label.textContent = 'กำลังเริ่ม...';
        fetch('/api/program/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: selectedRunMode })
        })
        .then(checkSession)
        .then(r => r.json())
        .then(data => {
            if (!data.ok) throw new Error('server error');
            if (btn)   btn.disabled = false;
            // อัปเดต UI ทันทีโดยไม่ต้องรอ Socket.io
            runState.running = true;
            runState.mode    = selectedRunMode;
            updateRunUI(runState);
        })
        .catch(e => {
            if (e.message === 'session_expired') return;
            console.error('[Program]', e);
            if (btn)   btn.disabled = false;
            if (label) label.textContent = 'START';
        });
    }
}

function updateRunUI(data) {
    runState = data;
    const running    = data.running;
    const btn        = document.getElementById('btn-run-toggle');
    const icon       = document.getElementById('run-btn-icon');
    const label      = document.getElementById('run-btn-label');
    const timerLabel = document.getElementById('run-timer-label');
    const badge      = document.getElementById('run-mode-badge');

    if (running) {
        btn?.classList.add('running');
        if (icon)       icon.className    = 'fa fa-stop';
        if (label)      label.textContent = 'STOP';
        if (timerLabel) timerLabel.textContent = 'รันมาแล้ว';
        if (badge) {
            badge.textContent = data.mode === 'auto' ? 'AUTO MODE' : 'MANUAL MODE';
            badge.className   = 'run-mode-badge ' + (data.mode === 'auto' ? 'badge-auto' : 'badge-manual');
        }
        applyRunModeBtns(data.mode);
        selectedRunMode = data.mode;
        clearInterval(runTimerInterval);
        runTimerInterval = setInterval(() => {
            updateRunTimer(data.startTime);
            updateRunChips(data);
        }, 1000);
        updateRunTimer(data.startTime);
        updateRunChips(data);
        updateLockHint(data.mode);
    } else {
        btn?.classList.remove('running');
        if (icon)       icon.className    = 'fa fa-play';
        if (label)      label.textContent = 'START';
        if (timerLabel) timerLabel.textContent = 'ยังไม่ได้เริ่ม';
        if (badge) { badge.textContent = ''; badge.className = 'run-mode-badge'; }
        clearInterval(runTimerInterval);
        const t = document.getElementById('run-timer');
        if (t) t.textContent = '00:00:00';
        ['run-chip-desk', 'run-chip-mobile'].forEach(id => {
            const c = document.getElementById(id);
            if (c) c.classList.add('hidden');
        });
        updateLockHint(null);
    }
}

function updateRunChips(data) {
    if (!data.running || !data.startTime) return;
    const elapsed = Math.floor((Date.now() - data.startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const timeStr = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    const modeLabel = data.mode === 'auto' ? 'AUTO' : 'MANUAL';
    const html = `<i class="fa fa-play-circle"></i> ${modeLabel} ${timeStr}`;
    ['run-chip-desk', 'run-chip-mobile'].forEach(id => {
        const c = document.getElementById(id);
        if (c) {
            c.innerHTML = html;
            c.className = 'run-chip ' + (data.mode === 'auto' ? 'chip-auto' : 'chip-manual');
        }
    });
}

function updateRunTimer(startTime) {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const t = document.getElementById('run-timer');
    if (t) t.textContent =
        String(h).padStart(2,'0') + ':' +
        String(m).padStart(2,'0') + ':' +
        String(s).padStart(2,'0');
}

function updateRunSensorUI(data) {
    const sv = (id, val, dp = 1) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (typeof val === 'number') ? val.toFixed(dp) : '--';
    };
    sv('run-val-temp',  data.temperature, 1);
    sv('run-val-hum',   data.humidity,    0);
    sv('run-val-light', data.light,       0);
    sv('run-val-ph',    data.ph,          1);
    sv('run-val-ph2',   data.ph2,         1);
    sv('run-val-volt',  data.voltage,     2);
    sv('run-val-curr',  data.current,     3);

    const grid = document.getElementById('run-water-grid');
    if (grid && Array.isArray(data.waterLevel)) {
        grid.innerHTML = data.waterLevel.map((w, i) => `
            <div class="run-water-item">
                <div class="run-wi-name">${SENSOR_NAMES[i]}</div>
                <div class="run-wi-bar-wrap"><div class="run-wi-bar" style="width:${Math.max(0, Math.min(100, w || 0))}%"></div></div>
                <div class="run-wi-val">${w >= 0 ? Math.round(w) + '%' : '—'}</div>
            </div>
        `).join('');
    }
}

function updateRunSettingsUI(s) {
    const body = document.getElementById('run-settings-body');
    if (!body || !s) return;
    const rl = i => (i >= 0 && i <= 9) ? `R${i+1} ${RELAY_NAMES[i]}` : '— ไม่ใช้';
    body.innerHTML = `
        <div class="run-set-group">
            <div class="run-set-head">ทั่วไป</div>
            <div class="run-set-row"><span>เวลา Dose</span><b>${s.doseTime} วินาที</b></div>
        </div>
        <div class="run-set-group tray1">
            <div class="run-set-head">ลัง 1</div>
            <div class="run-set-row"><span>น้ำเติม Relay</span><b>${rl(s.tray1RefillRelay)}</b></div>
            <div class="run-set-row"><span>เติมเมื่อต่ำกว่า</span><b>${s.tray1RefillMin}%&nbsp;→&nbsp;หยุดที่ ${s.tray1RefillMax}%</b></div>
            <div class="run-set-row"><span>pH ช่วง</span><b>${s.ph1Min} – ${s.ph1Max}</b></div>
            <div class="run-set-row"><span>pH+ / pH−</span><b>${rl(s.ph1UpRelay)} / ${rl(s.ph1DownRelay)}</b></div>
            <div class="run-set-row"><span>เติมน้ำถึง</span><b>${s.tray1FillTarget}%</b></div>
            <div class="run-set-row"><span>แช่นาน</span><b>${s.tray1SoakTime} นาที</b></div>
            <div class="run-set-row"><span>สูบออกถึง</span><b>${s.tray1DrainTarget}%</b></div>
            <div class="run-set-row"><span>ทำซ้ำทุก</span><b>${s.tray1CycleHours} ชม.</b></div>
        </div>
        <div class="run-set-group tray2">
            <div class="run-set-head">ลัง 2</div>
            <div class="run-set-row"><span>น้ำเติม Relay</span><b>${rl(s.tray2RefillRelay)}</b></div>
            <div class="run-set-row"><span>เติมเมื่อต่ำกว่า</span><b>${s.tray2RefillMin}%&nbsp;→&nbsp;หยุดที่ ${s.tray2RefillMax}%</b></div>
            <div class="run-set-row"><span>pH ช่วง</span><b>${s.ph2Min} – ${s.ph2Max}</b></div>
            <div class="run-set-row"><span>pH+ / pH−</span><b>${rl(s.ph2UpRelay)} / ${rl(s.ph2DownRelay)}</b></div>
            <div class="run-set-row"><span>เติมน้ำถึง</span><b>${s.tray2FillTarget}%</b></div>
            <div class="run-set-row"><span>แช่นาน</span><b>${s.tray2SoakTime} นาที</b></div>
            <div class="run-set-row"><span>สูบออกถึง</span><b>${s.tray2DrainTarget}%</b></div>
            <div class="run-set-row"><span>ทำซ้ำทุก</span><b>${s.tray2CycleHours} ชม.</b></div>
        </div>
    `;
}

let toastTimeout = null;
function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.classList.add('hidden'), 300);
    }, 2500);
}

function updateLockHint(mode) {
    const h = document.getElementById('run-lock-hint');
    if (!h) return;
    if (mode === 'auto') {
        h.classList.remove('hidden');
    } else {
        h.classList.add('hidden');
    }
}

function flashLockHint() {
    const h = document.getElementById('run-lock-hint');
    if (!h) return;
    h.classList.add('flash');
    setTimeout(() => h.classList.remove('flash'), 800);
}

socket.on('programStatus', updateRunUI);

// ============================================================
//  Nav Drag-and-Drop Reorder
// ============================================================

function initNavReorder() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    let dragSrc = null;

    nav.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('dragstart', e => {
            dragSrc = item;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => item.classList.add('nav-dragging'), 0);
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('nav-dragging');
            nav.querySelectorAll('.nav-item').forEach(i => i.classList.remove('nav-drag-over'));
            saveNavOrder();
            syncBottomNav();
        });

        item.addEventListener('dragover', e => {
            e.preventDefault();
            if (!dragSrc || dragSrc === item) return;
            nav.querySelectorAll('.nav-item').forEach(i => i.classList.remove('nav-drag-over'));
            item.classList.add('nav-drag-over');
            const rect = item.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                nav.insertBefore(dragSrc, item);
            } else {
                nav.insertBefore(dragSrc, item.nextSibling);
            }
        });
    });
}

function saveNavOrder() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    const order = [...nav.querySelectorAll('.nav-item')].map(el => el.dataset.page);
    localStorage.setItem('nav-order', JSON.stringify(order));
}

function loadNavOrder() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    try {
        const saved = localStorage.getItem('nav-order');
        if (!saved) return;
        JSON.parse(saved).forEach(page => {
            const item = nav.querySelector(`[data-page="${page}"]`);
            if (item) nav.appendChild(item);
        });
    } catch (e) {}
}

function syncBottomNav() {
    const nav = document.getElementById('main-nav');
    const bottom = document.getElementById('bottom-nav');
    if (!nav || !bottom) return;
    [...nav.querySelectorAll('.nav-item')].forEach(sItem => {
        const bItem = bottom.querySelector(`[data-page="${sItem.dataset.page}"]`);
        if (bItem) bottom.appendChild(bItem);
    });
}

// ============================================================
//  เริ่มต้นหน้าเว็บ
// ============================================================

loadMe();
initRelaySelects();
initCharts();
loadAndRenderHistory();
initReportCharts();
loadCropList();
startClock();
updateThemeUI(document.body.classList.contains('dark'));
loadNavOrder();
initNavReorder();
syncBottomNav();

// ============================================================
//  Dark / Light Theme
// ============================================================

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
}

function updateThemeUI(isDark) {
    const sidebarIcon  = document.getElementById('theme-icon-sidebar');
    const sidebarLabel = document.getElementById('theme-label-sidebar');
    const topbarIcon   = document.getElementById('theme-icon-topbar');

    if (isDark) {
        if (sidebarIcon)  sidebarIcon.className  = 'fa fa-sun';
        if (sidebarLabel) sidebarLabel.textContent = 'โหมดสว่าง';
        if (topbarIcon)   topbarIcon.className   = 'fa fa-sun';
    } else {
        if (sidebarIcon)  sidebarIcon.className  = 'fa fa-moon';
        if (sidebarLabel) sidebarLabel.textContent = 'โหมดมืด';
        if (topbarIcon)   topbarIcon.className   = 'fa fa-moon';
    }
}

// ============================================================
//  Clock
// ============================================================

function startClock() {
    function tick() {
        const now = new Date();
        const dateEl = document.getElementById('clock-date');
        const timeEl = document.getElementById('clock-time');
        if (dateEl) dateEl.textContent = now.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        if (timeEl) timeEl.textContent = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        // ตัวนับ "ออฟไลน์มานานแค่ไหน" ต้องเดินเองทุกวินาที ไม่งั้นค้างที่ค่าตอนหลุดครั้งแรก
        refreshEspBadges();
    }
    tick();
    setInterval(tick, 1000);
}

// ============================================================
//  User Management (admin only)
// ============================================================

function loadUsers() {
    fetch('/api/users')
        .then(r => r.json())
        .then(users => renderUserTable(users))
        .catch(err => console.error('[Users]', err));
}

function renderUserTable(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#aaa;">ยังไม่มีผู้ใช้</td></tr>';
        return;
    }
    tbody.innerHTML = users.map(u => `
        <tr>
            <td class="user-td-name">
                <i class="fa fa-user"></i> ${u.username}
            </td>
            <td>
                <span class="role-tag ${u.role === 'admin' ? 'role-admin' : 'role-viewer'}">
                    ${u.role === 'admin' ? 'Admin' : 'Viewer'}
                </span>
            </td>
            <td>
                <button class="btn-del-user" onclick="deleteUser('${u.username}')">
                    <i class="fa fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function addUser() {
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const role     = document.getElementById('new-role').value;
    const msgEl    = document.getElementById('user-form-msg');

    if (!username || !password) {
        showUserMsg('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'error');
        return;
    }

    fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
    })
    .then(r => r.json())
    .then(data => {
        if (data.ok) {
            showUserMsg(`เพิ่ม "${username}" สำเร็จ`, 'success');
            document.getElementById('new-username').value = '';
            document.getElementById('new-password').value = '';
            loadUsers();
        } else {
            showUserMsg(data.error || 'เกิดข้อผิดพลาด', 'error');
        }
    })
    .catch(() => showUserMsg('เกิดข้อผิดพลาด', 'error'));
}

function deleteUser(username) {
    if (!confirm(`ลบผู้ใช้ "${username}" ใช่ไหม?`)) return;

    fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(data => {
        if (data.ok) {
            showUserMsg(`ลบ "${username}" แล้ว`, 'success');
            loadUsers();
        } else {
            showUserMsg(data.error || 'เกิดข้อผิดพลาด', 'error');
        }
    })
    .catch(() => showUserMsg('เกิดข้อผิดพลาด', 'error'));
}

function showUserMsg(msg, type) {
    const el = document.getElementById('user-form-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = `user-form-msg ${type}`;
    setTimeout(() => { el.textContent = ''; el.className = 'user-form-msg'; }, 3000);
}
