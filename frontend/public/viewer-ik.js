// CCD inverse kinematics and the model-to-robot frame conversion.
//
// Part of robot-viewer.html. Loads after Three.js and its loaders, and before the files listed below it. robot-viewer.html pulls these in as plain classic scripts in this exact order because the original was one linear script: several top-level calls here run functions declared earlier in an earlier file.

// ===== 5. CCD Inverse Kinematics =====
// Matches joint hierarchy of Dobot CR5 (J1..J6)
const ikJoints = [
    { seg: link1, axis: 'y', min: deg(-180), max: deg(180), weight: 1.0 },
    { seg: link2, axis: 'z', min: deg(-90), max: deg(90), weight: 1.0 },
    { seg: link3, axis: 'z', min: deg(-150), max: deg(150), weight: 1.0 },
    { seg: link4, axis: 'z', min: deg(-180), max: deg(180), weight: 0.2 },
    { seg: link5, axis: 'y', min: deg(-180), max: deg(180), weight: 0.8 },
    { seg: link6, axis: 'z', min: deg(-180), max: deg(180), weight: 0.7 },
];

const _effPos = new THREE.Vector3();
const _jointPos = new THREE.Vector3();
const _parentQ = new THREE.Quaternion();
const _worldAxis = new THREE.Vector3();
const _toEff = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _effProj = new THREE.Vector3();
const _targetProj = new THREE.Vector3();
const _cross = new THREE.Vector3();

function _ccdStep(seg, axis, min, max, weight, target, TOLERANCE, DAMPING) {
    gizmoTip.getWorldPosition(_effPos);
    if (_effPos.distanceTo(target) < TOLERANCE) return false;
    seg.getWorldPosition(_jointPos);
    _toEff.subVectors(_effPos, _jointPos);
    _toTarget.subVectors(target, _jointPos);
    const localAxis = axis === 'x' ? new THREE.Vector3(1, 0, 0)
        : axis === 'y' ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);
    if (seg.parent) seg.parent.getWorldQuaternion(_parentQ);
    else _parentQ.identity();
    _worldAxis.copy(localAxis).applyQuaternion(_parentQ).normalize();
    const effDot = _toEff.dot(_worldAxis);
    const targetDot = _toTarget.dot(_worldAxis);
    _effProj.copy(_toEff).addScaledVector(_worldAxis, -effDot);
    _targetProj.copy(_toTarget).addScaledVector(_worldAxis, -targetDot);
    const effLen = _effProj.length();
    const targetLen = _targetProj.length();
    if (effLen < 0.001 || targetLen < 0.001) return true;
    _effProj.divideScalar(effLen);
    _targetProj.divideScalar(targetLen);
    const dot = THREE.MathUtils.clamp(_effProj.dot(_targetProj), -1, 1);
    let angle = Math.acos(dot) * DAMPING * (weight || 1.0);
    _cross.crossVectors(_effProj, _targetProj);
    if (_cross.dot(_worldAxis) < 0) angle = -angle;
    if (Math.abs(angle) > 0.0001) {
        const curAngle = seg.rotation[axis];
        const nextAngle = THREE.MathUtils.clamp(curAngle + angle, min, max);
        seg.rotation[axis] = nextAngle;
        if (axis !== 'x') seg.rotation.x = 0;
        if (axis !== 'y') seg.rotation.y = 0;
        if (axis !== 'z') seg.rotation.z = 0;
        seg.updateMatrixWorld(true);
    }
    return true;
}

function solveIK(targetPos, iterations = 35) {
    // Solve using J1..J4. J5 and J6 remain fixed during IK Move XYZ.
    // J4 and J5 are rotated separately in 'Wrist J4/J5' mode (shortcut E).
    // Clamp first: the tip must not be asked to go below the working floor,
    // or CCD happily drives it through the workpiece and the robot follows.
    if (tipMinZ !== null) targetPos.z = Math.max(targetPos.z, tipMinZ);
    const IK_ARM_JOINTS = 4; // J1 (0) through J4 (3)
    const ITERATIONS = iterations;
    const TOLERANCE = 0.0015;
    const DAMPING = 0.70;
    for (let iter = 0; iter < ITERATIONS; iter++) {
        gizmoTip.getWorldPosition(_effPos);
        if (_effPos.distanceTo(targetPos) < TOLERANCE) break;
        for (let i = IK_ARM_JOINTS - 1; i >= 0; i--) {
            const { seg, axis, min, max, weight } = ikJoints[i];
            _ccdStep(seg, axis, min, max, weight, targetPos, TOLERANCE, DAMPING);
        }
    }
}

// (solveIKWithOrientation removed — wrist is now handled by wristControls delta)

// Sync target sphere to end-effector tip on first load / drag release
function syncTargetToTip() {
    if (isDisplayOnly) return;
    const p = new THREE.Vector3();
    gizmoTip.getWorldPosition(p);
    targetMesh.position.copy(p);
    targetMesh.quaternion.copy(robotGizmoQuaternion);
    targetMesh.updateMatrixWorld(true);
    if (transformControls) transformControls.updateMatrixWorld();
    ikMode = false;
    _updateCurvedArrows();
}

// ── Model (Three.js, Y-up) → robot (Dobot, Z-up) frame conversion ──
// The .dae arm is assembled Y-up (link offsets along +Y, base spins on
// link1.rotation.y), while the Dobot base frame is Z-up. Without this
// remap the "Get Pos: OFF" readout reported model coords, so height
// landed in Y and depth in Z. Measured against the live robot:
//   robotX = modelX, robotY = -modelZ, robotZ = modelY
// (residual offsets come from .dae link lengths ≠ real arm; re-measured
// 2026-10-04 at Home against the live robot after the link4 re-tune —
// ON and OFF readouts now agree at that pose).
const MODEL_TO_ROBOT_OFFSET = { x: -0.54, y: -17.61, z: -10.48 };
function _modelToRobot(mx, my, mz) {
    return {
        x: mx + MODEL_TO_ROBOT_OFFSET.x,
        y: -mz + MODEL_TO_ROBOT_OFFSET.y,
        z: my + MODEL_TO_ROBOT_OFFSET.z,
    };
}

// Orientation: same Y-up→Z-up basis change as position, followed by a
// constant 180° tool flip about the robot Z. Measured against the live
// robot: model euler (89.5,-0.1,3.1) ↔ robot (-177.5,0.2,177.0).
const _BASIS_M = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const _TOOL_FIX = new THREE.Matrix4().makeRotationZ(Math.PI);
const _orientMtx = new THREE.Matrix4();
const _orientEuler = new THREE.Euler();
// Residual between the model's FK orientation and the robot's real
// GetPose() (measured 2026-10-04: model RY=-0.10 vs robot +0.21,
// model RZ=176.90 vs robot 177.04) — added so the "Get Pos: OFF"
// readout (model FK) matches the "ON" readout (robot).
const _ORIENT_FIX = { rx: 0.01, ry: 0.27, rz: 0.11 };
function _modelOrientToRobot(quat) {
    _orientMtx.makeRotationFromQuaternion(quat);
    _orientMtx.premultiply(_BASIS_M);
    _orientMtx.multiply(_TOOL_FIX);
    // The Dobot reports RX/RY/RZ in ZYX order, so extract with the same
    // convention or the numbers differ by a sign/axis branch even though
    // the physical orientation is identical.
    _orientEuler.setFromRotationMatrix(_orientMtx, 'ZYX');
    return {
        rx: _rad2degFn(_orientEuler.x) + _ORIENT_FIX.rx,
        ry: _rad2degFn(_orientEuler.y) + _ORIENT_FIX.ry,
        rz: _rad2degFn(_orientEuler.z) + _ORIENT_FIX.rz,
    };
}

// ── Send current target pose to parent React app ──
const _rad2degFn = THREE.MathUtils.radToDeg;
const _tpEuler = new THREE.Euler();
const _tpQuat = new THREE.Quaternion();

function _postTargetPose() {
    // Send the FLANGE (endEffector) pose, NOT the tip. The model's IK
    // already solved so the tip reaches the dragged point, leaving the
    // flange one tool-offset back — so commanding the robot's flange to
    // this pose puts the physical TIP exactly on the dragged point.
    endEffector.getWorldPosition(_tcpPos);
    endEffector.getWorldQuaternion(_tpQuat);
    _tpEuler.setFromQuaternion(_tpQuat);

    const safeCoord = (val, fb = 0) => {
        const n = Number(val);
        return (!isNaN(n) && isFinite(n)) ? +n.toFixed(1) : fb;
    };

    const rp = _modelToRobot(_tcpPos.x * 1000, _tcpPos.y * 1000, _tcpPos.z * 1000);
    const mmX = safeCoord(rp.x);
    const mmY = safeCoord(rp.y);
    const mmZ = safeCoord(rp.z);
    const ro = _modelOrientToRobot(_tpQuat);
    const rx = safeCoord(ro.rx);
    const ry = safeCoord(ro.ry);
    const rz = safeCoord(ro.rz);

    const joints = [
        safeCoord(_rad2degFn(link1.rotation.y)),
        safeCoord(_rad2degFn(link2.rotation.z)),
        safeCoord(_rad2degFn(link3.rotation.z)),
        safeCoord(_rad2degFn(link4.rotation.z)),
        safeCoord(_rad2degFn(link5.rotation.y)),
        safeCoord(_rad2degFn(link6.rotation.z)),
    ];

    window.parent.postMessage({
        type: 'targetPoseUpdate',
        x: mmX, y: mmY, z: mmZ,
        rx, ry, rz,
        joints,
    }, '*');
}

// Cache latest real robot pose & joints passed from parent
let latestRealPose = null;
let latestRealJoints = null;
