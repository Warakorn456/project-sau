// ============================================================
//  Smart Farm Dashboard - Frontend JavaScript
// ============================================================

const socket = io();

// ============================================================
//  Page Navigation
// ============================================================

function goPage(name) {
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

function loadMe() {
    fetch('/api/me')
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
        .catch(err => console.error('[Me] Error:', err));
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

function updateSensorUI(data) {
    const online = !!data.connected;
    setStatusBadge('esp-status',      online, online ? 'Online' : 'Offline');
    setStatusBadge('esp-status-desk', online, 'ESP32: ' + (online ? 'Online' : 'Offline'));

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
    setText('val-ph',  data.ph.toFixed(1));
    setText('sub-ph',  phLabel(data.ph));
    setText('val-ph2', (data.ph2 ?? 0).toFixed(1));
    setText('sub-ph2', phLabel(data.ph2 ?? 0));

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

function initCharts() {
    // อุณหภูมิ & ความชื้น (แกน Y คู่)
    charts.tempHum = new Chart(document.getElementById('chart-temphum'), {
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
    charts.light = new Chart(document.getElementById('chart-light'), {
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

    // pH (2 เส้น)
    charts.ph = new Chart(document.getElementById('chart-ph'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'pH ลัง1',
                    data: [],
                    borderColor: '#7b1fa2',
                    backgroundColor: 'rgba(123,31,162,0.07)',
                    fill: true
                },
                {
                    label: 'pH ลัง2',
                    data: [],
                    borderColor: '#d81b60',
                    backgroundColor: 'rgba(216,27,96,0.07)',
                    fill: true
                }
            ]
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
    charts.power = new Chart(document.getElementById('chart-power'), {
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

    // ระดับน้ำ 7 ถัง
    const waterNames  = ['ถังสารA', 'ถังสารB', 'ถังน้ำเติม',
                         'ลังปลูกผัก1', 'ถังน้ำวนลัง1',
                         'ลังปลูกผัก2', 'ถังน้ำวนลัง2'];
    const waterColors = ['#1565c0', '#2e7d32', '#00838f',
                         '#558b2f', '#e65100', '#6a1b9a', '#c62828'];
    charts.water = new Chart(document.getElementById('chart-water'), {
        type: 'line',
        data: {
            labels: [],
            datasets: waterNames.map((name, i) => ({
                label: `${name} (%)`,
                data: [],
                borderColor: waterColors[i],
                backgroundColor: waterColors[i] + '12',
                fill: false
            }))
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
            renderAllCharts(data);
            setText('history-count', `${data.length} รายการ`);
        })
        .catch(err => {
            console.error('[History] Load error:', err);
            setText('history-count', 'ไม่สามารถโหลดได้');
        });
}

function renderAllCharts(data) {
    if (!data || data.length === 0) {
        setText('history-count', 'ยังไม่มีข้อมูล (รอ 1 นาทีแรก)');
        return;
    }

    const labels = data.map(d => formatLabel(d.ts));

    charts.tempHum.data.labels              = labels;
    charts.tempHum.data.datasets[0].data    = data.map(d => d.t);
    charts.tempHum.data.datasets[1].data    = data.map(d => d.h);
    charts.tempHum.update('none');

    charts.light.data.labels             = labels;
    charts.light.data.datasets[0].data   = data.map(d => d.l);
    charts.light.update('none');

    charts.ph.data.labels            = labels;
    charts.ph.data.datasets[0].data  = data.map(d => d.p);
    charts.ph.data.datasets[1].data  = data.map(d => d.p2 ?? null);
    charts.ph.update('none');

    charts.power.data.labels             = labels;
    charts.power.data.datasets[0].data   = data.map(d => d.v);
    charts.power.data.datasets[1].data   = data.map(d => d.c);
    charts.power.update('none');

    charts.water.data.labels = labels;
    for (let i = 0; i < 7; i++) {
        charts.water.data.datasets[i].data = data.map(d => (d.w || [])[i] ?? null);
    }
    charts.water.update('none');

    setText('history-count', `${data.length} รายการ`);
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

    push(charts.tempHum, [point.t, point.h]);
    push(charts.light,   [point.l]);
    push(charts.ph,      [point.p, point.p2 ?? null]);
    push(charts.power,   [point.v, point.c]);
    push(charts.water,   point.w);

    // อัปเดตจำนวน
    const countEl = document.getElementById('history-count');
    if (countEl) {
        const cur = parseInt(countEl.textContent) || 0;
        countEl.textContent = `${cur + 1} รายการ`;
    }
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
});

socket.on('disconnect', () => {
    setStatusBadge('esp-status',      false, 'Offline');
    setStatusBadge('esp-status-desk', false, 'Server: Offline');
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
                      'ลังปลูกผัก2', 'ถังน้ำวนลัง2'];

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

function saveAutoSettings() {
    const getF = id => parseFloat(document.getElementById(id).value);
    const getI = id => parseInt(document.getElementById(id).value);
    fetch('/api/auto-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ph1Min:       getF('ph1-min')        || 5.5,
            ph1Max:       getF('ph1-max')        || 7.0,
            ph1UpRelay:   getI('ph1-up-relay'),
            ph1DownRelay: getI('ph1-down-relay'),
            ph2Min:       getF('ph2-min')        || 5.5,
            ph2Max:       getF('ph2-max')        || 7.0,
            ph2UpRelay:   getI('ph2-up-relay'),
            ph2DownRelay: getI('ph2-down-relay'),
            doseTime:           getF('dose-time')            || 3,
            tray1RefillRelay:   getI('tray1-refill-relay'),
            tray1RefillMin:     getF('tray1-refill-min')    || 20,
            tray1RefillMax:     getF('tray1-refill-max')    || 80,
            tray1RefillSensor:  getI('tray1-refill-sensor'),
            tray2RefillRelay:   getI('tray2-refill-relay'),
            tray2RefillMin:     getF('tray2-refill-min')    || 20,
            tray2RefillMax:     getF('tray2-refill-max')    || 80,
            tray2RefillSensor:  getI('tray2-refill-sensor'),
            tray1FillTarget:  getF('tray1-fill-target')  || 80,
            tray1SoakTime:     getF('tray1-soak-time')    || 30,
            tray1DrainTarget:  getF('tray1-drain-target') || 20,
            tray1CycleHours:  getF('tray1-cycle-hours')  || 6,
            tray1FillRelay:  getI('tray1-fill-relay'),
            tray1DrainRelay: getI('tray1-drain-relay'),
            tray1Sensor:     getI('tray1-sensor'),
            tray2FillTarget:  getF('tray2-fill-target')  || 80,
            tray2SoakTime:     getF('tray2-soak-time')    || 30,
            tray2DrainTarget:  getF('tray2-drain-target') || 20,
            tray2CycleHours:  getF('tray2-cycle-hours')  || 6,
            tray2FillRelay:   getI('tray2-fill-relay'),
            tray2DrainRelay:  getI('tray2-drain-relay'),
            tray2Sensor:      getI('tray2-sensor')
        })
    }).then(() => {
        const btn = document.querySelector('.btn-save-auto');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa fa-check"></i> บันทึกแล้ว!';
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
    }).catch(err => console.error('[AutoSettings]', err));
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

function selectRunMode(mode) {
    selectedRunMode = mode;
    document.getElementById('run-mode-auto')  ?.classList.toggle('active', mode === 'auto');
    document.getElementById('run-mode-manual')?.classList.toggle('active', mode === 'manual');
}

function toggleProgram() {
    if (runState.running) {
        if (!confirm('ต้องการหยุดโปรแกรม?\nRelay ทั้งหมดจะถูกปิด')) return;
        fetch('/api/program/stop', { method: 'POST' })
            .catch(e => console.error('[Program]', e));
    } else {
        fetch('/api/program/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: selectedRunMode })
        }).catch(e => console.error('[Program]', e));
    }
}

function updateRunUI(data) {
    runState = data;
    const running        = data.running;
    const btn            = document.getElementById('btn-run-toggle');
    const icon           = document.getElementById('run-btn-icon');
    const label          = document.getElementById('run-btn-label');
    const timerLabel     = document.getElementById('run-timer-label');
    const badge          = document.getElementById('run-mode-badge');

    if (running) {
        btn?.classList.add('running');
        if (icon)  icon.className    = 'fa fa-stop';
        if (label) label.textContent = 'STOP';
        if (timerLabel) timerLabel.textContent = 'รันมาแล้ว';
        if (badge) {
            badge.textContent = data.mode === 'auto' ? 'AUTO MODE' : 'MANUAL MODE';
            badge.className   = 'run-mode-badge ' + (data.mode === 'auto' ? 'badge-auto' : 'badge-manual');
        }
        selectRunMode(data.mode);
        clearInterval(runTimerInterval);
        runTimerInterval = setInterval(() => updateRunTimer(data.startTime), 1000);
        updateRunTimer(data.startTime);
    } else {
        btn?.classList.remove('running');
        if (icon)  icon.className    = 'fa fa-play';
        if (label) label.textContent = 'START';
        if (timerLabel) timerLabel.textContent = 'ยังไม่ได้เริ่ม';
        if (badge) { badge.textContent = ''; badge.className = 'run-mode-badge'; }
        clearInterval(runTimerInterval);
        const t = document.getElementById('run-timer');
        if (t) t.textContent = '00:00:00';
    }
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

socket.on('programStatus', updateRunUI);

// ============================================================
//  เริ่มต้นหน้าเว็บ
// ============================================================

loadMe();
initRelaySelects();
initCharts();
loadAndRenderHistory();
startClock();
updateThemeUI(document.body.classList.contains('dark'));

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
