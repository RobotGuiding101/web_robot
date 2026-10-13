// Scan/fuse, cam2 extrinsic tuning, auto-align socket, calibration UI.
//
// Part of robot-viewer.html. Loads after Three.js and its loaders, and before the files listed below it. robot-viewer.html pulls these in as plain classic scripts in this exact order because the original was one linear script: several top-level calls here run functions declared earlier in an earlier file.

// ===== Scan / Fuse (cam2 static + cam1 multi-view) =====
const SCAN_MAX_PTS = 40000;
const scanPos = new Float32Array(SCAN_MAX_PTS * 3);
const scanCol = new Float32Array(SCAN_MAX_PTS * 3);
const scanGeo = new THREE.BufferGeometry();
const scanPosAttr = new THREE.BufferAttribute(scanPos, 3);
scanPosAttr.setUsage(THREE.DynamicDrawUsage);
const scanColAttr = new THREE.BufferAttribute(scanCol, 3);
scanColAttr.setUsage(THREE.DynamicDrawUsage);
scanGeo.setAttribute('position', scanPosAttr);
scanGeo.setAttribute('color', scanColAttr);
const scanMat = new THREE.PointsMaterial({ size: 0.006, vertexColors: true });
const scanPoints = new THREE.Points(scanGeo, scanMat);
scanPoints.visible = false;
scene.add(scanPoints);

function fillScanCloud(mm, rgb, count) {
    for (let i = 0; i < count; i++) {
        const j = i * 3;
        scanPos[j] = mm[j] / 1000.0;
        scanPos[j + 1] = -mm[j + 1] / 1000.0;
        scanPos[j + 2] = -mm[j + 2] / 1000.0;
        scanCol[j] = rgb[j] / 255.0;
        scanCol[j + 1] = rgb[j + 1] / 255.0;
        scanCol[j + 2] = rgb[j + 2] / 255.0;
    }
    scanGeo.setDrawRange(0, count);
    scanPosAttr.needsUpdate = true;
    scanColAttr.needsUpdate = true;
}

function parseScanCloud(ab) {
    if (ab.byteLength < 4) return null;
    const n = new DataView(ab).getUint32(0, true);
    if (!n) return null;
    return {
        n, mm: new Int16Array(ab, 4, n * 3),
        rgb: new Uint8Array(ab, 4 + n * 6, n * 3),
    };
}

let scanWs = null;
function connectScanLive() {
    const token = localStorage.getItem('access_token') || '';
    if (!token) { setTimeout(connectScanLive, 2000); return; }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    scanWs = new WebSocket(proto + '//' + location.host + '/api/scan/ws?token=' + encodeURIComponent(token));
    scanWs.binaryType = 'arraybuffer';
    scanWs.onmessage = (ev) => {
        const c = parseScanCloud(ev.data);
        if (!c) return;
        const count = Math.min(c.n, SCAN_MAX_PTS);
        fillScanCloud(c.mm, c.rgb, count);
    };
    scanWs.onclose = () => {
        scanWs = null;
        if (document.getElementById('chk-scanlive')?.checked) setTimeout(connectScanLive, 1000);
    };
}

const scanAuth = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('access_token') || '') });

async function scanRefreshCount() {
    try {
        const r = await fetch('/api/scan/views', { headers: scanAuth() });
        const d = await r.json();
        const el = document.getElementById('scan-count');
        if (el) el.textContent = 'views: ' + (d.views ? d.views.length : 0) + (d.fused ? ' · fused' : '') + (d.map_n ? ' · map: ' + d.map_n : '');
    } catch { /* ignore */ }
}

document.getElementById('chk-scanlive')?.addEventListener('change', (e) => {
    scanPoints.visible = e.target.checked;
    if (e.target.checked) connectScanLive();
    else if (scanWs) { scanWs.close(); scanWs = null; }
});

async function scanCapture(cam) {
    try {
        const r = await fetch('/api/scan/capture', {
            method: 'POST', headers: { ...scanAuth(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ cam }),
        });
        if (cam) { scanRefreshCount(); return; }
        const d = await r.json().catch(() => null);
        const failed = (d?.captures || []).filter((c) => !c.ok);
        if (failed.length) {
            const el = document.getElementById('scan-count');
            if (el) {
                el.textContent = `snap: cam${failed.map((c) => c.cam).join(', ')} ไม่ได้`;
            }
        }
        scanRefreshCount();
    } catch { /* ignore */ }
}
document.getElementById('btn-cap')?.addEventListener('click', () => scanCapture(0));

document.getElementById('btn-fuse')?.addEventListener('click', async () => {
    try {
        await fetch('/api/scan/fuse', { method: 'POST', headers: scanAuth() });
        const r = await fetch('/api/scan/cloud', { headers: scanAuth() });
        if (!r.ok) return;
        const c = parseScanCloud(await r.arrayBuffer());
        if (c) { fillScanCloud(c.mm, c.rgb, Math.min(c.n, SCAN_MAX_PTS)); scanPoints.visible = true; document.getElementById('chk-scanlive').checked = false; }
        scanRefreshCount();
    } catch { /* ignore */ }
});

document.getElementById('btn-clear')?.addEventListener('click', async () => {
    try { await fetch('/api/scan/views/clear', { method: 'POST', headers: scanAuth() }); scanRefreshCount(); } catch { /* ignore */ }
});

document.getElementById('btn-save')?.addEventListener('click', async () => {
    try {
        const r = await fetch('/api/scan/save', { method: 'POST', headers: { ...scanAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        const d = await r.json();
        scanLoadSessions();
    } catch { /* ignore */ }
});

async function scanLoadSessions() {
    try {
        const r = await fetch('/api/scan/sessions', { headers: scanAuth() });
        const d = await r.json();
        const sel = document.getElementById('sel-session');
        if (!sel) return;
        sel.innerHTML = (d.sessions || []).map((s) =>
            `<option value="${s.session}">${s.name || s.session} (${s.n})</option>`).join('');
    } catch { /* ignore */ }
}

document.getElementById('btn-load')?.addEventListener('click', async () => {
    const sel = document.getElementById('sel-session');
    if (!sel || !sel.value) return;
    try {
        await fetch('/api/scan/load/' + encodeURIComponent(sel.value), { method: 'POST', headers: scanAuth() });
        const r = await fetch('/api/scan/cloud', { headers: scanAuth() });
        if (!r.ok) return;
        const c = parseScanCloud(await r.arrayBuffer());
        if (c) { fillScanCloud(c.mm, c.rgb, Math.min(c.n, SCAN_MAX_PTS)); scanPoints.visible = true; document.getElementById('chk-scanlive').checked = false; }
    } catch { /* ignore */ }
});

scanRefreshCount();
scanLoadSessions();

function bindTunePair(prefix, id) {
    const slider = document.getElementById(prefix + id);
    const num = document.getElementById(prefix + id + '-n');
    if (!slider || !num) return;
    slider.addEventListener('input', () => { num.value = slider.value; });
    num.addEventListener('input', () => {
        const v = parseFloat(num.value);
        if (Number.isFinite(v)) slider.value = String(v);
    });
}

function bindCam2Tune() {
    const ids = ['px', 'py', 'pz', 'rx', 'ry', 'rz'];
    const get = (id) => document.getElementById('c2-' + id);
    let saveTimer = null;
    const apply = () => {
        const rad = Math.PI / 180;
        cam2Mount.position.set(+get('px').value, +get('py').value, +get('pz').value);
        cam2Mount.rotation.set(
            +get('rx').value * rad,
            +get('ry').value * rad,
            +get('rz').value * rad);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCam2Extrinsic, 400);
    };
    ids.forEach((id) => {
        bindTunePair('c2-', id);
        const el = get(id);
        if (el) el.addEventListener('input', apply);
        const num = document.getElementById('c2-' + id + '-n');
        if (num) num.addEventListener('input', apply);
    });
    apply();
}
bindCam2Tune();

// Persist the viewer's cam2 mount tune to /api/scan/extrinsics so fuse
// and the live fused stream use the same transform the operator tuned.
async function saveCam2Extrinsic() {
    const get = (id) => document.getElementById('c2-' + id);
    const body = {
        cam2_to_base: {
            xyz: [+get('px').value, +get('py').value, +get('pz').value],
            rpy: [+get('rx').value, +get('ry').value, +get('rz').value],
        }
    };
    try {
        await fetch('/api/scan/extrinsics', {
            method: 'POST', headers: { ...scanAuth(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const el = document.getElementById('ext-status');
        if (el) el.textContent = 'cam2 extrinsic: saved ✓';
    } catch { /* ignore */ }
}

async function loadCam2Extrinsic() {
    try {
        const r = await fetch('/api/scan/extrinsics', { headers: scanAuth() });
        const d = await r.json();
        const ex = d.extrinsics && d.extrinsics.cam2_to_base;
        if (!ex || !ex.xyz || !ex.rpy) return;
        const set = (id, v) => {
            const el = document.getElementById('c2-' + id);
            if (el) el.value = String(Number(v).toFixed(3));
            const num = document.getElementById('c2-' + id + '-n');
            if (num) num.value = String(Number(v).toFixed(3));
        };
        set('px', ex.xyz[0]); set('py', ex.xyz[1]); set('pz', ex.xyz[2]);
        set('rx', ex.rpy[0]); set('ry', ex.rpy[1]); set('rz', ex.rpy[2]);
        const rad = Math.PI / 180;
        cam2Mount.position.set(+ex.xyz[0], +ex.xyz[1], +ex.xyz[2]);
        cam2Mount.rotation.set(+ex.rpy[0] * rad, +ex.rpy[1] * rad, +ex.rpy[2] * rad);
        const el = document.getElementById('ext-status');
        if (el) el.textContent = 'cam2 extrinsic: loaded';
    } catch { /* ignore */ }
}
loadCam2Extrinsic();

function worldCloud(obj, localArr, count, stride) {
    obj.updateWorldMatrix(true, false);
    const m = obj.matrixWorld;
    const v = new THREE.Vector3();
    const out = [];
    for (let i = 0; i < count; i += stride) {
        v.set(localArr[i * 3], localArr[i * 3 + 1], localArr[i * 3 + 2]).applyMatrix4(m);
        out.push([v.x, v.y, v.z]);
    }
    return out;
}

function syncMountSliders(mount, prefix) {
    const deg = (r) => (r * 180) / Math.PI;
    const vals = {
        px: mount.position.x, py: mount.position.y, pz: mount.position.z,
        rx: deg(mount.rotation.x), ry: deg(mount.rotation.y), rz: deg(mount.rotation.z),
    };
    Object.keys(vals).forEach((id) => {
        const el = document.getElementById(prefix + id);
        if (!el) return;
        const v = String(Math.round(vals[id] * 1000) / 1000);
        el.value = v;
        const num = document.getElementById(prefix + id + '-n');
        if (num) num.value = v;
    });
}

let icpBusy = false;
let alignGoalP = null;
let alignGoalQ = null;
let alignStable = 0;
const ARM_STILL_MS = 1200;
const _lastParentWorld = new THREE.Matrix4();
let _lastParentMove = performance.now();

function trackArmStill() {
    const p = projectorMount.parent;
    if (!p) return;
    p.updateWorldMatrix(true, false);
    const a = p.matrixWorld.elements;
    const b = _lastParentWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-6) { moved = true; break; }
    }
    if (moved) {
        _lastParentMove = performance.now();
        _lastParentWorld.copy(p.matrixWorld);
    }
}

function matClose(m, ref, eps) {
    const a = m.elements;
    const b = ref.elements;
    for (let i = 0; i < 16; i++) {
        if (Math.abs(a[i] - b[i]) > eps) return false;
    }
    return true;
}

function applyAlignTarget() {
    if (alignGoalP === null) return;
    projectorMount.position.lerp(alignGoalP, 0.12);
    projectorMount.quaternion.slerp(alignGoalQ, 0.12);
    projectorMount.updateMatrixWorld(true);
    const dp = projectorMount.position.distanceTo(alignGoalP);
    const dq = 1 - Math.abs(projectorMount.quaternion.dot(alignGoalQ));
    if (dp < 0.0005 && dq < 1e-6) {
        projectorMount.position.copy(alignGoalP);
        projectorMount.quaternion.copy(alignGoalQ);
        projectorMount.updateMatrixWorld(true);
        alignGoalP = null;
        alignGoalQ = null;
        syncMountSliders(projectorMount, 'mt-');
    }
}
// Server-side auto-align: the backend runs ICP continuously (cam2->base)
// and pushes the result over /ws/align — this page only applies what
// arrives, no per-tick HTTP. The result updates cam2Mount directly
// (it IS cam2_to_base), syncs the tune sliders and persists it.
let alignWs = null;
let alignWsTimer = null;
let alignLastP = null;
let alignLastQ = null;
let cam2GoalP = null;
let cam2GoalQ = null;

function applyAlignMsg(d) {
    if (!d || d.fitness == null || d.fitness < 0.5 || d.rmse > 0.02) return;
    const rad = Math.PI / 180;
    const p = new THREE.Vector3(d.xyz[0], d.xyz[1], d.xyz[2]);
    const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(d.rpy[0] * rad, d.rpy[1] * rad, d.rpy[2] * rad));
    if (alignLastP) {
        const dp = alignLastP.distanceTo(p);
        const dq = 1 - Math.abs(alignLastQ.dot(q));
        if (dp < 0.008 && dq < 2e-4) {
            alignStable++;
            if (alignStable >= 3) {
                alignStable = 0;
                if (autoChk && autoChk.checked) autoChk.checked = false;
                setAuto(false);
            }
            return;
        }
        alignStable = 0;
    }
    alignLastP = p.clone();
    alignLastQ = q.clone();
    cam2GoalP = p;
    cam2GoalQ = q;
}

function glideCam2Align() {
    if (cam2GoalP === null) return;
    cam2Mount.position.lerp(cam2GoalP, 0.12);
    cam2Mount.quaternion.slerp(cam2GoalQ, 0.12);
    const dp = cam2Mount.position.distanceTo(cam2GoalP);
    const dq = 1 - Math.abs(cam2Mount.quaternion.dot(cam2GoalQ));
    if (dp < 0.0005 && dq < 1e-6) {
        cam2Mount.position.copy(cam2GoalP);
        cam2Mount.quaternion.copy(cam2GoalQ);
        cam2GoalP = null;
        cam2GoalQ = null;
        syncMountSliders(cam2Mount, 'c2-');
        saveCam2Extrinsic();
    }
}

function connectAlignWs() {
    const token = localStorage.getItem('access_token') || '';
    if (!token) { alignWsTimer = setTimeout(connectAlignWs, 2000); return; }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
        alignWs = new WebSocket(proto + '//' + location.host + '/api/scan/ws/align?token=' + encodeURIComponent(token));
    } catch (err) {
        alignWsTimer = setTimeout(connectAlignWs, 2000);
        return;
    }
    alignWs.onmessage = (ev) => {
        let d = null;
        try { d = JSON.parse(ev.data); } catch (err) { return; }
        applyAlignMsg(d);
    };
    alignWs.onclose = () => {
        alignWs = null;
        if (autoChk && autoChk.checked) alignWsTimer = setTimeout(connectAlignWs, 1000);
    };
}

const icpBtn = document.getElementById('btn-icp');
if (icpBtn) icpBtn.addEventListener('click', () => setAuto(true));

function setAuto(on) {
    if (alignWs) { alignWs.close(); alignWs = null; }
    if (alignWsTimer) { clearTimeout(alignWsTimer); alignWsTimer = null; }
    alignLastP = null; alignLastQ = null; alignStable = 0;
    cam2GoalP = null; cam2GoalQ = null;
    if (on) connectAlignWs();
}
const autoChk = document.getElementById('chk-auto');
if (autoChk) {
    autoChk.addEventListener('change', () => setAuto(autoChk.checked));
    setAuto(autoChk.checked);
}

const mark2Chk = document.getElementById('chk-mark2');
if (mark2Chk) mark2Chk.addEventListener('change', () => {
    cam2Marker.visible = mark2Chk.checked;
    cam2Label.visible = mark2Chk.checked;
});
const mark1Chk = document.getElementById('chk-mark1');
const applyMark1 = (on) => {
    cam1Marker.visible = on;
    cam1Label.visible = on;
};
if (mark1Chk) {
    mark1Chk.addEventListener('change', () => applyMark1(mark1Chk.checked));
    applyMark1(mark1Chk.checked);
}
const cloud1Chk = document.getElementById('chk-cloud1');
if (cloud1Chk) cloud1Chk.addEventListener('change', () => {
    depthPoints.visible = cloud1Chk.checked;
    if (cloud1Chk.checked) readPointCloud();
});
const cloud2Chk = document.getElementById('chk-cloud2');
if (cloud2Chk) cloud2Chk.addEventListener('change', () => {
    cam2Points.visible = cloud2Chk.checked;
    if (cloud2Chk.checked) readPointCloud2();
});
const mesh1Chk = document.getElementById('chk-mesh1');
if (mesh1Chk) mesh1Chk.addEventListener('change', () => {
    depthMesh.visible = mesh1Chk.checked;
    if (mesh1Chk.checked) { readDepthGrid(); readDepthFrame(); }
});
const mesh2Chk = document.getElementById('chk-mesh2');
if (mesh2Chk) mesh2Chk.addEventListener('change', () => {
    depthMesh2.visible = mesh2Chk.checked;
    if (mesh2Chk.checked) readDepthGrid2();
});
if (mark2Chk) { cam2Marker.visible = cam2Label.visible = mark2Chk.checked; }
if (cloud1Chk) { depthPoints.visible = cloud1Chk.checked; }
if (cloud2Chk) { cam2Points.visible = cloud2Chk.checked; }
if (mesh1Chk) { depthMesh.visible = mesh1Chk.checked; }
if (mesh2Chk) { depthMesh2.visible = mesh2Chk.checked; }

// Display-only mode (the Drawing page's floating pose preview) has no
// camera-projected layer to show, so hiding them keeps readCamStream/
// readCam2Stream off entirely instead of pulling ~15 Mbps of MJPEG for
// a texture nothing displays.
if (isDisplayOnly) {
    depthMesh.visible = false;
    depthMesh2.visible = false;
    depthPoints.visible = false;
    cam2Points.visible = false;
}

// ⚙ Tune toggles BOTH the Cam1 mount and Cam2 extrinsic panels together.
function toggleTunePanels() {
    const c1 = document.getElementById('mount-tune');
    const c2 = document.getElementById('cam2-tune');
    const show = !(c2 && c2.style.display === 'flex');
    [c1, c2].forEach((el) => { if (el) el.style.display = show ? 'flex' : ''; });
}

const panelsBtn = document.getElementById('btn-panels');
if (panelsBtn) panelsBtn.addEventListener('click', toggleTunePanels);

const cam1TuneBtn = document.getElementById('btn-tune-cam1');
if (cam1TuneBtn) cam1TuneBtn.addEventListener('click', toggleTunePanels);

function applyCloudColor() {
    const v1 = colorSrc === 'video' && effMode(1) === 'rgb';
    const v2 = colorSrc === 'video' && effMode(2) === 'rgb';
    depthPoints.material = v1 ? cloudMatVideo : cloudMatSensor;
    cam2Points.material = v2 ? cam2MatVideo : cam2MatSensor;
    const b = document.getElementById('btn-color');
    if (b) b.textContent = 'Color: ' + (colorSrc === 'video' ? 'Video' : 'Sensor');
}
const colorBtn = document.getElementById('btn-color');
if (colorBtn) colorBtn.addEventListener('click', () => {
    colorSrc = colorSrc === 'video' ? 'sensor' : 'video';
    applyCloudColor();
});

const areaBtn = document.getElementById('btn-area');
if (areaBtn) areaBtn.addEventListener('click', () => {
    const out = document.getElementById('area-result');
    const camSel = document.getElementById('sel-area-cam');
    const camN = camSel ? camSel.value : '1';
    const token = localStorage.getItem('access_token') || '';
    if (out) out.textContent = 'กำลังวัด…';
    fetch('/api/map/object_area', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ cam: Number(camN) }),
    })
        .then((r) => r.json())
        .then((d) => {
            if (!out) return;
            if (!d || d.ok === false) { out.textContent = 'ผิดพลาด: ' + ((d && d.error) || 'unknown'); return; }
            if (!d.count) { out.textContent = 'ไม่พบวัตถุ (ปรับ above_mm หรือหันกล้อง)'; return; }
            const lines = d.objects.map((o, i) => `#${i + 1}  ${o.area_cm2} cm²`);
            out.textContent = `cam${d.cam}: ${d.count} ชิ้น\n` + lines.join('\n') + `\nรวม ${d.total_cm2} cm²`;
        })
        .catch(() => { if (out) out.textContent = 'ผิดพลาด: เชื่อมต่อไม่ได้'; });
});

const calibImg = document.getElementById('calib-img');
const calibStatus = document.getElementById('calib-status');
const areaHOut = document.getElementById('area-h-result');
const calibCam = () => {
    const s = document.getElementById('sel-area-cam');
    return s ? Number(s.value) : 2;
};
const authHeaders = (json) => {
    const h = { Authorization: 'Bearer ' + (localStorage.getItem('access_token') || '') };
    if (json) h['Content-Type'] = 'application/json';
    return h;
};
const refreshCalibFrame = () => {
    if (calibImg) calibImg.src = `/api/map/color_frame?cam=${calibCam()}&_t=${Date.now()}`;
};
const refreshCalibStatus = () => {
    fetch('/api/map/floorcalib', { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
            if (!calibStatus) return;
            const rmse = d.rmse_mm == null ? '-' : d.rmse_mm.toFixed(1) + ' mm';
            calibStatus.textContent = `จุด ${d.count}/${d.min_points}  rmse ${rmse}`;
        })
        .catch(() => { });
};
const cr = document.getElementById('btn-calib-refresh');
if (cr) cr.addEventListener('click', () => { refreshCalibFrame(); refreshCalibStatus(); });
const creset = document.getElementById('btn-calib-reset');
if (creset) creset.addEventListener('click', () => {
    fetch('/api/map/floorcalib/reset', { method: 'POST', headers: authHeaders() })
        .then((r) => r.json()).then(() => refreshCalibStatus()).catch(() => { });
});
if (calibImg) calibImg.addEventListener('click', (e) => {
    const rect = calibImg.getBoundingClientRect();
    const nw = calibImg.naturalWidth || rect.width;
    const nh = calibImg.naturalHeight || rect.height;
    const u = (e.clientX - rect.left) * nw / rect.width;
    const v = (e.clientY - rect.top) * nh / rect.height;
    fetch('/api/map/floorcalib/point', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ u, v }),
    })
        .then((r) => r.json())
        .then((d) => {
            if (!calibStatus) return;
            if (d.ok === false) { calibStatus.textContent = 'ผิดพลาด: ' + (d.error || ''); return; }
            const rmse = d.rmse_mm == null ? '-' : d.rmse_mm.toFixed(1) + ' mm';
            calibStatus.textContent = `จุด ${d.count}/${d.min_points}  rmse ${rmse}`;
        })
        .catch(() => { });
});
const bgBtn = document.getElementById('btn-bg');
if (bgBtn) bgBtn.addEventListener('click', () => {
    fetch('/api/map/plane_background', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ cam: calibCam() }),
    })
        .then((r) => r.json())
        .then((d) => { if (areaHOut) areaHOut.textContent = d.ok ? `เก็บพื้นหลัง cam${d.cam} แล้ว (${d.width}x${d.height})` : 'ผิดพลาด: ' + d.error; })
        .catch(() => { });
});
const areaHBtn = document.getElementById('btn-area-h');
if (areaHBtn) areaHBtn.addEventListener('click', () => {
    if (areaHOut) areaHOut.textContent = 'กำลังวัด…';
    fetch('/api/map/area_plane', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ cam: calibCam() }),
    })
        .then((r) => r.json())
        .then((d) => {
            if (!areaHOut) return;
            if (d.ok === false) { areaHOut.textContent = 'ผิดพลาด: ' + d.error; return; }
            if (!d.count) { areaHOut.textContent = 'ไม่พบวัตถุ (ปรับ thr / เก็บ BG ใหม่)'; return; }
            const rmse = d.rmse_mm == null ? '-' : d.rmse_mm.toFixed(0);
            areaHOut.textContent = `${d.count} ชิ้น (rmse ${rmse}mm)\n`
                + d.objects.map((o, i) => `#${i + 1} ${o.area_cm2} cm²`).join('\n')
                + `\nรวม ${d.total_cm2} cm²`;
        })
        .catch(() => { });
});
refreshCalibStatus();

const selMode = document.getElementById('sel-mode');
if (selMode) selMode.addEventListener('change', () => {
    manualMode = selMode.value;
    applyCloudColor();
});

function pollCameraModes() {
    const token = localStorage.getItem('access_token') || '';
    if (!token) { setTimeout(pollCameraModes, 2000); return; }
    fetch('/api/camera/mode', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.mode !== undefined) camMode1 = d.mode; })
        .catch(() => { });
    fetch('/api/camera/mode2', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.mode !== undefined) camMode2 = d.mode; })
        .catch(() => { });
    setTimeout(pollCameraModes, 1500);
}
pollCameraModes();
applyCloudColor();

(function loadIntrinsics() {
    const token = localStorage.getItem('access_token') || '';
    if (!token) { setTimeout(loadIntrinsics, 2000); return; }
    fetch('/api/map/camera_intrinsics', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
    }).then((r) => (r.ok ? r.json() : null))
        .then((d) => {
            if (!d || !d.fx || !d.fy) return;
            camIntr = { fx: d.fx, fy: d.fy, cx: d.cx, cy: d.cy, w: d.w, h: d.h };
            projCam.aspect = d.w / d.h;
            projCam.fov = (2 * Math.atan(d.h / (2 * d.fy)) * 180) / Math.PI;
            projCam.updateProjectionMatrix();
            projCam2.aspect = d.w / d.h;
            projCam2.fov = (2 * Math.atan(d.h / (2 * d.fy)) * 180) / Math.PI;
            projCam2.updateProjectionMatrix();
        })
        .catch(() => { });
})();

function bindMountTune() {
    const ids = ['px', 'py', 'pz', 'rx', 'ry', 'rz'];
    const get = (id) => document.getElementById('mt-' + id);
    const apply = () => {
        const rad = Math.PI / 180;
        projectorMount.position.set(
            +get('px').value,
            +get('py').value,
            +get('pz').value);
        projectorMount.rotation.set(
            +get('rx').value * rad,
            +get('ry').value * rad,
            +get('rz').value * rad);
    };
    ids.forEach((id) => {
        bindTunePair('mt-', id);
        const el = get(id);
        if (el) el.addEventListener('input', apply);
        const num = document.getElementById('mt-' + id + '-n');
        if (num) num.addEventListener('input', apply);
    });
    apply();
}
bindMountTune();

// Orange target sphere (draggable)
const targetMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 24, 24),
    new THREE.MeshPhongMaterial({ color: 0xff6b35, emissive: 0xff3300, emissiveIntensity: 0.35, shininess: 90, transparent: true, opacity: 0 })
);
targetMesh.visible = false;
// Ring around it for visibility
const ringGeo = new THREE.TorusGeometry(0.042, 0.005, 12, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0 });
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.visible = false;
targetMesh.add(ring);

let transformControls = null;
const robotGizmoQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
