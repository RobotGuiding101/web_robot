// Render loop.
//
// Part of robot-viewer.html. Loads after Three.js and its loaders, and before the files listed below it. robot-viewer.html pulls these in as plain classic scripts in this exact order because the original was one linear script: several top-level calls here run functions declared earlier in an earlier file.

// ===== 7. Render Loop =====
// Cache TCP display elements
const _tcpPos = new THREE.Vector3();
const _cam1World = new THREE.Vector3();
const camPosEl = document.getElementById('cam-pos');
const _tcpQuat = new THREE.Quaternion();
const _tcpEuler = new THREE.Euler();
const _rad2deg = THREE.MathUtils.radToDeg;
let _lastPostMs = 0;
// Tip display from the REAL robot pose (when Get Pos is ON): the model's
// FK drifts from the arm (link lengths differ), so tip = flange +
// R(robot euler) * (TOOLFIX^-1 * gizmoTip_local) instead.
const _tipEuler = new THREE.Euler();
const _tipMat = new THREE.Matrix4();
const _tipOff = new THREE.Vector3();
const _tipOffLocal = gizmoTip.position.clone()
    .applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI).invert());

function animate() {
    requestAnimationFrame(animate);
    cameraControls.update();

    if (firstFrame && loadedCount >= totalModels) {
        if (!isDisplayOnly) syncTargetToTip();
        firstFrame = false;
    }

    // Ring billboard & curved arrows follow gizmo
    if (!isDisplayOnly) {
        ring.lookAt(camera.position);
        _updateCurvedArrows();
    }

    // Ease the model toward the real robot's joints (see jointTarget) so
    // the arm glides between status updates instead of teleporting.
    if (jointTarget && !ikMode && !activeDragJoint) {
        const cur = [link1.rotation.y, link2.rotation.z, link3.rotation.z,
        link4.rotation.z, link5.rotation.y, link6.rotation.z];
        let settled = true;
        const next = cur.map((c, i) => {
            const d = jointTarget[i] - c;
            if (Math.abs(d) > 2e-4) settled = false;
            return c + d * 0.2;
        });
        _setLinkRotations(next);
        link1.updateMatrixWorld(true);
        syncTargetToTip();
        if (settled) jointTarget = null;
    }

    if (isDragging) {
        _ikTarget.lerp(ikGoal, 0.45);
        solveIK(_ikTarget, 8);
    }

    // Hide the camera helpers and depth clouds while the arm is being
    // dragged. They are fixed in world space, so the moving model looks like
    // it drives straight through them and the arm is hard to read.
    const _helpersHidden = isDragging || !!activeDragJoint;
    for (const o of [depthPoints, depthMesh, cam1Marker,
                     cam2Points, depthMesh2, cam2Marker]) {
        if (o) o.visible = !_helpersHidden;
    }

    // While dragging (get-pos OFF) the real robot has not moved, so pin
    // cam1's mount to its current world transform — otherwise the camera
    // marker/mesh swing around with the dragged model.
    const _lockNow = camLockByGetPos || isDragging || !!activeDragJoint;
    if (_lockNow && !camLocked) {
        projectorMount.updateWorldMatrix(true, false);
        _lockedCamWorld.copy(projectorMount.matrixWorld);
        camLocked = true;
        projectorMount.matrixAutoUpdate = false;
    } else if (!_lockNow && camLocked) {
        camLocked = false;
        projectorMount.matrixAutoUpdate = true;
    }
    if (camLocked && projectorMount.parent) {
        projectorMount.parent.updateWorldMatrix(true, false);
        _camLocalInv.copy(projectorMount.parent.matrixWorld).invert();
        projectorMount.matrix.copy(_camLocalInv).multiply(_lockedCamWorld);
    }

    // Read TCP position (metres → mm) and send to parent React app ~10x/sec
    endEffector.getWorldPosition(_tcpPos);
    const _rp = _modelToRobot(_tcpPos.x * 1000, _tcpPos.y * 1000, _tcpPos.z * 1000);
    const mmX = +_rp.x.toFixed(2);
    const mmY = +_rp.y.toFixed(2);
    const mmZ = +_rp.z.toFixed(2);

    const now = performance.now();
    if (now - _lastPostMs > 100) {
        _lastPostMs = now;

        // End-effector world orientation → robot-frame Euler (degrees)
        endEffector.getWorldQuaternion(_tcpQuat);
        const _ro = _modelOrientToRobot(_tcpQuat);
        const rx = +_ro.rx.toFixed(2);
        const ry = +_ro.ry.toFixed(2);
        const rz = +_ro.rz.toFixed(2);

        // Joint angles (degrees) from each link's rotation axis
        const joints = [
            +_rad2deg(link1.rotation.y).toFixed(2),
            +_rad2deg(link2.rotation.z).toFixed(2),
            +_rad2deg(link3.rotation.z).toFixed(2),
            +_rad2deg(link4.rotation.z).toFixed(2),
            +_rad2deg(link5.rotation.y).toFixed(2),
            +_rad2deg(link6.rotation.z).toFixed(2),
        ];

        // Physical tool tip. Compute it from the robot's own pose
        // whenever the model is following the real arm (Get Pos ON, or
        // OFF while not dragging) so it doesn't inherit the model's FK
        // drift; only while free-dragging the model use the model tip.
        let tipX, tipY, tipZ;
        if (latestRealPose && !isDragging && !activeDragJoint) {
            _tipEuler.set(deg(latestRealPose[3]), deg(latestRealPose[4]), deg(latestRealPose[5]), 'ZYX');
            _tipMat.makeRotationFromEuler(_tipEuler);
            _tipOff.copy(_tipOffLocal).applyMatrix4(_tipMat).multiplyScalar(1000);
            tipX = +(latestRealPose[0] + _tipOff.x).toFixed(2);
            tipY = +(latestRealPose[1] + _tipOff.y).toFixed(2);
            tipZ = +(latestRealPose[2] + _tipOff.z).toFixed(2);
        } else {
            gizmoTip.getWorldPosition(_tcpPos);
            const _tpr = _modelToRobot(_tcpPos.x * 1000, _tcpPos.y * 1000, _tcpPos.z * 1000);
            tipX = +_tpr.x.toFixed(2);
            tipY = +_tpr.y.toFixed(2);
            tipZ = +_tpr.z.toFixed(2);
        }

        window.parent.postMessage({
            type: 'tcpUpdate',
            x: mmX, y: mmY, z: mmZ,
            rx, ry, rz,
            tipX, tipY, tipZ,
            joints,
        }, '*');
    }

    updateProjector();
    updateProjector2();
    trackArmStill();
    applyAlignTarget();
    glideCam2Align();
    cam2Mount.updateWorldMatrix(true, false);
    cam2Label.position.copy(cam2Mount.position);
    cam2Label.position.y += 0.18;
    projectorMount.updateWorldMatrix(true, false);
    _cam1World.setFromMatrixPosition(projectorMount.matrixWorld);
    cam1Label.position.copy(_cam1World);
    cam1Label.position.y += 0.18;
    if (camPosEl) {
        camPosEl.textContent =
            `cam1: ${(_cam1World.x * 1000).toFixed(0)}, ${(_cam1World.y * 1000).toFixed(0)}, ${(_cam1World.z * 1000).toFixed(0)} mm\n` +
            `cam2: ${(cam2Mount.position.x * 1000).toFixed(0)}, ${(cam2Mount.position.y * 1000).toFixed(0)}, ${(cam2Mount.position.z * 1000).toFixed(0)} mm`;
    }
    cloudMatVideo.uniforms.sizeFactor.value = renderer.domElement.height;
    cam2MatVideo.uniforms.sizeFactor.value = renderer.domElement.height;
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});
