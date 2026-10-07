// Drag gizmo: XYZ move plus the curved J4/J5 rotation arrows.
//
// Part of robot-viewer.html. Loads after Three.js and its loaders, and before the files listed below it. robot-viewer.html pulls these in as plain classic scripts in this exact order because the original was one linear script: several top-level calls here run functions declared earlier in an earlier file.

// ── 5. Unified End-Effector Gizmo: XYZ Move + Curved Arrows for J4/J5 ──
// Container group for curved rotation arrows (J4 Red, J5 Green)
const curvedGizmoGroup = new THREE.Group();
scene.add(curvedGizmoGroup);

// Helper to construct a 3D curved rotation arrow (Torus arc + Cone arrowhead + invisible pick torus)
// coneAtStart=true  → arrowhead at angle=0 (start of arc), pointing into arc
// coneAtStart=false → arrowhead at arcAngle (end of arc), pointing out
function createCurvedArrow(radius, arcAngle, colorHex, coneAtStart = false) {
    const group = new THREE.Group();
    const tubeRadius = 0.0075; // Thicker, richer line

    // 1. Visible Torus arc with 100% solid, bright vibrant color (no lighting shading)
    const torusGeo = new THREE.TorusGeometry(radius, tubeRadius, 20, 64, arcAngle);
    const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        depthTest: false,
        depthWrite: false,
    });
    const torusMesh = new THREE.Mesh(torusGeo, mat);
    torusMesh.renderOrder = 999;
    group.add(torusMesh);

    // 2. Cone arrowhead — position/direction depends on coneAtStart
    const coneRadius = tubeRadius * 2.8;
    const coneHeight = 0.028;
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 20);
    const coneAngle = coneAtStart ? 0 : arcAngle;
    const tangent = coneAtStart
        ? new THREE.Vector3(0, -1, 0)   // start: point into arc
        : new THREE.Vector3(-Math.sin(arcAngle), Math.cos(arcAngle), 0).normalize(); // end: tangent out
    const coneMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        depthTest: false,
        depthWrite: false,
    });
    const coneMesh = new THREE.Mesh(coneGeo, coneMat);
    coneMesh.renderOrder = 999;
    coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    coneMesh.position.set(radius * Math.cos(coneAngle), radius * Math.sin(coneAngle), 0);
    group.add(coneMesh);

    // 3. Invisible thick hit mesh for easy mouse raycasting
    const hitGeo = new THREE.TorusGeometry(radius, 0.026, 8, 32, arcAngle);
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    group.add(hitMesh);

    return { group, torusMesh, coneMesh, hitMesh, mat, coneMat };
}

// Red curved arrow for J4 (Pitch/Tilt) - coneAtStart=true → arrowhead at start of arc
const j4ArrowData = createCurvedArrow(0.105, Math.PI * 0.78, 0xff0044, true);
const j4ArrowGroup = j4ArrowData.group;
const j4HitMesh = j4ArrowData.hitMesh;
const j4Mat = j4ArrowData.mat;
const j4ConeMat = j4ArrowData.coneMat;
curvedGizmoGroup.add(j4ArrowGroup);

// Green curved arrow for J5 (Roll/Yaw) - radius 0.125m, vivid emerald green
const j5ArrowData = createCurvedArrow(0.125, Math.PI * 0.78, 0x00e676);
const j5ArrowGroup = j5ArrowData.group;
const j5HitMesh = j5ArrowData.hitMesh;
const j5Mat = j5ArrowData.mat;
const j5ConeMat = j5ArrowData.coneMat;
curvedGizmoGroup.add(j5ArrowGroup);

const _q4Tmp = new THREE.Quaternion();
const _q5Tmp = new THREE.Quaternion();
const _zAxis4 = new THREE.Vector3();
const _yAxis5 = new THREE.Vector3();
const _unitZ = new THREE.Vector3(0, 0, 1);

function _updateCurvedArrows() {
    if (isDisplayOnly || !curvedGizmoGroup) return;

    // Follow targetMesh position (center of XYZ gizmo)
    targetMesh.getWorldPosition(curvedGizmoGroup.position);

    // J4 (Red): normal is link4's local Z axis transformed to world space
    link4.getWorldQuaternion(_q4Tmp);
    _zAxis4.set(0, 0, 1).applyQuaternion(_q4Tmp).normalize();
    j4ArrowGroup.quaternion.setFromUnitVectors(_unitZ, _zAxis4);

    // J5 (Green): normal is link5's local Y axis transformed to world space
    link5.getWorldQuaternion(_q5Tmp);
    _yAxis5.set(0, 1, 0).applyQuaternion(_q5Tmp).normalize();
    j5ArrowGroup.quaternion.setFromUnitVectors(_unitZ, _yAxis5);
}

let ikMode = false;
let isDragging = false;
let activeDragJoint = null;
const ikGoal = new THREE.Vector3();
const _ikTarget = new THREE.Vector3();
let camLocked = false;
let camLockByGetPos = false;
const _lockedCamWorld = new THREE.Matrix4();
const _camLocalInv = new THREE.Matrix4();
let dragStartAngle = 0;
let dragStartPointerAngle = 0;
const _centerScreenPx = new THREE.Vector2();
const _tipWorldPos = new THREE.Vector3();
const _tipNdc = new THREE.Vector3();
const _curvedRaycaster = new THREE.Raycaster();
const _curvedMouse = new THREE.Vector2();

const _ttEl = document.getElementById('joint-tooltip');
function _showJointTooltip(text, x, y) {
    if (!_ttEl) return;
    _ttEl.textContent = text;
    _ttEl.style.display = 'block';
    _ttEl.style.left = (x + 14) + 'px';
    _ttEl.style.top = (y + 14) + 'px';
}
function _hideJointTooltip() {
    if (_ttEl) _ttEl.style.display = 'none';
}

function _calcCenterScreenPx() {
    targetMesh.getWorldPosition(_tipWorldPos);
    _tipNdc.copy(_tipWorldPos).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    _centerScreenPx.x = ((_tipNdc.x + 1) * 0.5) * rect.width + rect.left;
    _centerScreenPx.y = ((-_tipNdc.y + 1) * 0.5) * rect.height + rect.top;
}

function onCurvedPointerDown(e) {
    if (e.button !== 0 || isDisplayOnly) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _curvedMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _curvedMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    _curvedRaycaster.setFromCamera(_curvedMouse, camera);
    const hits = _curvedRaycaster.intersectObjects([j4HitMesh, j5HitMesh], false);
    if (hits.length > 0) {
        const hitObj = hits[0].object;
        activeDragJoint = (hitObj === j4HitMesh) ? 'j4' : 'j5';
        cameraControls.enabled = false;
        if (transformControls) transformControls.enabled = false;

        _calcCenterScreenPx();
        dragStartPointerAngle = Math.atan2(e.clientY - _centerScreenPx.y, e.clientX - _centerScreenPx.x);
        dragStartAngle = (activeDragJoint === 'j4') ? link4.rotation.z : link5.rotation.y;

        renderer.domElement.style.cursor = 'grabbing';
        window.parent.postMessage({ type: 'gizmoDragStart' }, '*');

        e.stopImmediatePropagation();
        e.preventDefault();
    }
}

function onCurvedPointerMove(e) {
    if (activeDragJoint) {
        const curAngle = Math.atan2(e.clientY - _centerScreenPx.y, e.clientX - _centerScreenPx.x);
        let delta = curAngle - dragStartPointerAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);

        if (activeDragJoint === 'j4') {
            link4.getWorldQuaternion(_q4Tmp);
            _zAxis4.set(0, 0, 1).applyQuaternion(_q4Tmp).normalize();
            const sign = (_zAxis4.dot(camDir) > 0) ? -1 : 1;
            const { min, max } = ikJoints[3];
            const nextAng = THREE.MathUtils.clamp(dragStartAngle + delta * sign, min, max);
            link4.rotation.z = nextAng;
            link4.rotation.x = 0; link4.rotation.y = 0;
            link4.updateMatrixWorld(true);

            const degVal = THREE.MathUtils.radToDeg(nextAng).toFixed(1);
            _showJointTooltip(`J4 (แดง): ${degVal}°`, e.clientX, e.clientY);
        } else if (activeDragJoint === 'j5') {
            link5.getWorldQuaternion(_q5Tmp);
            _yAxis5.set(0, 1, 0).applyQuaternion(_q5Tmp).normalize();
            const sign = (_yAxis5.dot(camDir) > 0) ? -1 : 1;
            const { min, max } = ikJoints[4];
            const nextAng = THREE.MathUtils.clamp(dragStartAngle + delta * sign, min, max);
            link5.rotation.y = nextAng;
            link5.rotation.x = 0; link5.rotation.z = 0;
            link5.updateMatrixWorld(true);

            const degVal = THREE.MathUtils.radToDeg(nextAng).toFixed(1);
            _showJointTooltip(`J5 (เขียว): ${degVal}°`, e.clientX, e.clientY);
        }

        // Snap targetMesh position to new end-effector tip position
        endEffector.getWorldPosition(targetMesh.position);
        targetMesh.updateMatrixWorld(true);
        if (transformControls) transformControls.updateMatrixWorld();

        _updateCurvedArrows();
        _postTargetPose();
        e.preventDefault();
        return;
    }

    if (isDisplayOnly) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _curvedMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _curvedMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    _curvedRaycaster.setFromCamera(_curvedMouse, camera);
    const hits = _curvedRaycaster.intersectObjects([j4HitMesh, j5HitMesh], false);
    if (hits.length > 0) {
        const hitObj = hits[0].object;
        if (hitObj === j4HitMesh) {
            j4Mat.color.setHex(0xff5277);
            j4ConeMat.color.setHex(0xff5277);
            j5Mat.color.setHex(0x00e676);
            j5ConeMat.color.setHex(0x00e676);
            renderer.domElement.style.cursor = 'grab';
            const deg = THREE.MathUtils.radToDeg(link4.rotation.z).toFixed(1);
            _showJointTooltip(`หมุน J4: ${deg}°`, e.clientX, e.clientY);
        } else {
            j5Mat.color.setHex(0x69f0ae);
            j5ConeMat.color.setHex(0x69f0ae);
            j4Mat.color.setHex(0xff0044);
            j4ConeMat.color.setHex(0xff0044);
            renderer.domElement.style.cursor = 'grab';
            const deg = THREE.MathUtils.radToDeg(link5.rotation.y).toFixed(1);
            _showJointTooltip(`หมุน J5: ${deg}°`, e.clientX, e.clientY);
        }
    } else {
        j4Mat.color.setHex(0xff0044);
        j4ConeMat.color.setHex(0xff0044);
        j5Mat.color.setHex(0x00e676);
        j5ConeMat.color.setHex(0x00e676);
        _hideJointTooltip();
        if (!transformControls || !transformControls.dragging) {
            renderer.domElement.style.cursor = '';
        }
    }
}

function onCurvedPointerUp(e) {
    if (activeDragJoint) {
        activeDragJoint = null;
        cameraControls.enabled = true;
        if (transformControls) transformControls.enabled = true;
        renderer.domElement.style.cursor = '';
        _hideJointTooltip();
        syncTargetToTip();
        _updateCurvedArrows();
        _postTargetPose();
    }
}

if (!isDisplayOnly) {
    // Position sphere at end-effector
    scene.add(targetMesh);

    // ── Main TransformControls (Robot-frame XYZ translate IK) ──
    transformControls = new THREE.TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSpace('local');
    transformControls.setSize(0.75);
    targetMesh.quaternion.copy(robotGizmoQuaternion);
    transformControls.attach(targetMesh);
    scene.add(transformControls);

    transformControls.addEventListener('dragging-changed', (e) => {
        cameraControls.enabled = !e.value;
        isDragging = e.value;
        if (e.value) {
            ikMode = true;
            jointTarget = null;
            ikGoal.copy(targetMesh.position);
            _ikTarget.copy(targetMesh.position);
            window.parent.postMessage({ type: 'gizmoDragStart' }, '*');
        } else {
            ikMode = false;
            solveIK(ikGoal);
            syncTargetToTip();
            _postTargetPose();
            _updateCurvedArrows();
        }
    });

    transformControls.addEventListener('change', () => {
        if (!transformControls.dragging) return;
        ikGoal.copy(targetMesh.position);
    });

    // Pointer event listeners on canvas for the curved rotation arrows
    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onCurvedPointerDown, true);
    window.addEventListener('pointermove', onCurvedPointerMove, { passive: false });
    window.addEventListener('pointerup', onCurvedPointerUp, { passive: false });
    window.addEventListener('pointercancel', onCurvedPointerUp, { passive: false });


}
