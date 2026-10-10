// postMessage bridge to the React page, ghost targets, joints socket.
//
// Part of robot-viewer.html. Loads after Three.js and its loaders, and before the files listed below it. robot-viewer.html pulls these in as plain classic scripts in this exact order because the original was one linear script: several top-level calls here run functions declared earlier in an earlier file.

// ===== 6. Expose joint control & ghost control to parent React app via postMessage =====
function _setLinkRotations(r) {
    link1.rotation.y = r[0];
    link2.rotation.z = r[1];
    link3.rotation.z = r[2];
    link4.rotation.z = r[3];
    link5.rotation.y = r[4]; link5.rotation.x = 0; link5.rotation.z = 0;
    link6.rotation.z = r[5]; link6.rotation.x = 0; link6.rotation.y = 0;
}

// ── Ghost Targets ───────────────────────────────────────────────
// Keep the real robot model normal. Each Snap creates a separate
// translucent snapshot at the exact current WORLD transform of every
// robot mesh, so the ghost stays behind while the real arm moves.
const _ghostTargetMat = new THREE.MeshStandardMaterial({
    color: 0x808080,
    roughness: 0.55,
    metalness: 0.1,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
});

const _ghostTargets = [];

function createGhostTarget() {
    // Make sure every link/mesh has its current world matrix.
    robotBase.updateMatrixWorld(true);

    const ghostGroup = new THREE.Group();
    ghostGroup.name = 'GhostTarget';
    ghostGroup.renderOrder = 10;

    robotBase.traverse((child) => {
        if (!child.isMesh) return;

        // Clone only the visible robot meshes. Do NOT clone the
        // robot hierarchy, gizmos, cameras, projector or hit helpers.
        let p = child;
        let isCameraOrHelper = false;
        while (p && p !== robotBase) {
            if ((typeof endEffector !== 'undefined' && p === endEffector) ||
                (typeof projectorMount !== 'undefined' && p === projectorMount) ||
                (typeof cam1Marker !== 'undefined' && p === cam1Marker)) {
                isCameraOrHelper = true;
                break;
            }
            if (/cam|projector|gizmo|helper/i.test(p.name || '')) {
                isCameraOrHelper = true;
                break;
            }
            p = p.parent;
        }
        if (isCameraOrHelper) return;

        const ghostMesh = child.clone(false);
        ghostMesh.name = 'Ghost_' + (child.name || 'Mesh');

        // Use one translucent material for the whole ghost.
        ghostMesh.material = _ghostTargetMat;

        // child.matrixWorld is the exact pose at the moment of Snap.
        ghostMesh.matrixAutoUpdate = false;
        ghostMesh.matrix.copy(child.matrixWorld);
        ghostMesh.matrixWorld.copy(child.matrixWorld);
        ghostMesh.matrixWorldNeedsUpdate = false;

        ghostGroup.add(ghostMesh);
    });

    scene.add(ghostGroup);
    _ghostTargets.push(ghostGroup);
}

function clearGhostTargets() {
    for (const ghost of _ghostTargets) {
        ghost.traverse((child) => {
            if (child.isMesh) {
                child.geometry = child.geometry; // keep shared geometry
            }
        });
        scene.remove(ghost);
    }
    _ghostTargets.length = 0;
}

function deleteGhostTarget(index) {
    if (index < 0 || index >= _ghostTargets.length) return;
    const ghost = _ghostTargets.splice(index, 1)[0];
    if (ghost) scene.remove(ghost);
}

// Target link rotations (radians) the render loop eases toward. Real
// robot status only arrives a few times/sec, so applying setJoints
// directly made the arm teleport between updates instead of moving.
let jointTarget = null;
let jointSynced = false;

window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'setJoints') {
        const j = e.data.joints; // array [j1..j6] in degrees
        if (!Array.isArray(j) || j.length < 6) return;
        if (Array.isArray(e.data.realPose) && e.data.realPose.length >= 6) latestRealPose = e.data.realPose.slice(0, 6);
        latestRealJoints = j.slice(0, 6);
        const tgt = [deg(j[0]), deg(j[1]), deg(j[2]), deg(j[3]), deg(j[4]), deg(j[5])];
        if (!jointSynced) {
            _setLinkRotations(tgt);
            link1.updateMatrixWorld(true);
            syncTargetToTip();
            jointSynced = true;
            jointTarget = null;
        } else {
            jointTarget = tgt;
        }
        ikMode = false;
    } else if (e.data.type === 'snapPos') {
        // Snap + leave a translucent target behind.
        syncTargetToTip();
        createGhostTarget();
        _postTargetPose();

    } else if (e.data.type === 'snapGhost') {
        // Same behavior for the explicit ghost command.
        syncTargetToTip();
        createGhostTarget();
        _postTargetPose();

    } else if (e.data.type === 'clearGhost' || e.data.type === 'clearAllGhosts') {
        clearGhostTargets();
    } else if (e.data.type === 'deleteGhostTarget') {
        deleteGhostTarget(e.data.index);

    } else if (e.data.type === 'getPosState') {
        camLockByGetPos = !e.data.enabled;
    }
});

// High-rate joint feed over WebSocket (~20 Hz) so the arm glides instead
// of stepping at the HTTP poll cadence. The render loop still eases
// (jointTarget) on top of this.
let jointsWs = null;
let jointsWsTimer = null;
function connectJointsWs() {
    const token = localStorage.getItem('access_token') || '';
    if (!token) { jointsWsTimer = setTimeout(connectJointsWs, 2000); return; }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
        jointsWs = new WebSocket(proto + '//' + location.host + '/ws/joints?token=' + encodeURIComponent(token));
    } catch (err) {
        jointsWsTimer = setTimeout(connectJointsWs, 2000);
        return;
    }
    jointsWs.onmessage = (ev) => {
        let d;
        try { d = JSON.parse(ev.data); } catch (err) { return; }
        if (Array.isArray(d.pose) && d.pose.length >= 6) latestRealPose = d.pose.slice(0, 6);
        if (camLockByGetPos) return;
        const j = d && d.angles;
        if (!Array.isArray(j) || j.length < 6) return;
        latestRealJoints = j.slice(0, 6);
        const tgt = [deg(j[0]), deg(j[1]), deg(j[2]), deg(j[3]), deg(j[4]), deg(j[5])];
        if (!jointSynced) {
            _setLinkRotations(tgt);
            link1.updateMatrixWorld(true);
            syncTargetToTip();
            jointSynced = true;
            jointTarget = null;
        } else {
            jointTarget = tgt;
        }
    };
    jointsWs.onclose = () => {
        jointsWs = null;
        jointsWsTimer = setTimeout(connectJointsWs, 1000);
    };
}
connectJointsWs();

// Snap target to tip once after first render
let firstFrame = true;
