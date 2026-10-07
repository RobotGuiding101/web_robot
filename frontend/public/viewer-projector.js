// End-effector marker, projector mount, point clouds and depth meshes.
//
// Part of robot-viewer.html. Loads after Three.js and its loaders, and before the files listed below it. robot-viewer.html pulls these in as plain classic scripts in this exact order because the original was one linear script: several top-level calls here run functions declared earlier in an earlier file.

// ===== 4. End-Effector marker + IK Target sphere =====
const endEffector = new THREE.Group();
link6.add(endEffector);
// The draggable gizmo sits at the model's physical tool tip, but the
// robot's TCP reference (endEffector) must stay at link6's origin:
// shifting endEffector also moves the reported Dobot X/Y/Z, the
// MODEL_TO_ROBOT calibration and cam1's mount (projectorMount child).
// Tool tip offset in link6's local frame (metres), measured from tool 2.
// viewer-boot.js derives the tip from model geometry only when this is
// null. Reported robot-frame tip = Rz(180) of this value.
const TOOL_TIP_MEASURED = [0.098626, 0.010095, 0.070022];
const gizmoTip = new THREE.Group();
gizmoTip.position.set(0.0899, 0.0077, 0.0686);
if (TOOL_TIP_MEASURED) gizmoTip.position.fromArray(TOOL_TIP_MEASURED);
endEffector.add(gizmoTip);

const CAM_MOUNT_POS = new THREE.Vector3(0.061, 0.05, -0.017);
const CAM_MOUNT_ROT = new THREE.Euler(-178 * Math.PI / 180, 0, 180 * Math.PI / 180);
const PROJ_ROLL = Math.PI / 2;
const projRollMat = new THREE.Matrix4().makeRotationZ(PROJ_ROLL);
const projectorMount = new THREE.Object3D();
projectorMount.position.copy(CAM_MOUNT_POS);
projectorMount.rotation.copy(CAM_MOUNT_ROT);
endEffector.add(projectorMount);

const projBias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1);
const projCam = new THREE.PerspectiveCamera(58, 848 / 480, 0.02, 50);

function updateProjector() {
    projectorMount.updateWorldMatrix(true, false);
    projCam.matrixWorld.copy(projectorMount.matrixWorld);
    projCam.matrixWorld.multiply(projRollMat);
    projCam.matrixWorldInverse.copy(projCam.matrixWorld).invert();
    projCam.updateProjectionMatrix();
    texMatrix.multiplyMatrices(projBias, projCam.projectionMatrix)
        .multiply(projCam.matrixWorldInverse);
}

const MAX_PTS = 100000;
const cloudPos = new Float32Array(MAX_PTS * 3);
const cloudCol = new Float32Array(MAX_PTS * 3);
const cloudGeo = new THREE.BufferGeometry();
const cloudPosAttr = new THREE.BufferAttribute(cloudPos, 3);
cloudPosAttr.setUsage(THREE.DynamicDrawUsage);
const cloudColAttr = new THREE.BufferAttribute(cloudCol, 3);
cloudColAttr.setUsage(THREE.DynamicDrawUsage);
cloudGeo.setAttribute('position', cloudPosAttr);
cloudGeo.setAttribute('color', cloudColAttr);
cloudGeo.setDrawRange(0, 0);
const discCanvas = document.createElement('canvas');
discCanvas.width = 64;
discCanvas.height = 64;
const discCtx = discCanvas.getContext('2d');
const discGrad = discCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
discGrad.addColorStop(0.0, 'rgba(255,255,255,1)');
discGrad.addColorStop(0.7, 'rgba(255,255,255,1)');
discGrad.addColorStop(1.0, 'rgba(255,255,255,0)');
discCtx.fillStyle = discGrad;
discCtx.beginPath();
discCtx.arc(32, 32, 32, 0, Math.PI * 2);
discCtx.fill();
const discTex = new THREE.CanvasTexture(discCanvas);

const cloudMatSensor = new THREE.PointsMaterial({
    size: 0.004,
    sizeAttenuation: true,
    vertexColors: true,
    map: discTex,
    transparent: true,
    alphaTest: 0.5,
    clippingPlanes: [floorPlane],
});

const cloudMatVideo = new THREE.ShaderMaterial({
    uniforms: {
        map: { value: camTexture },
        texMatrix: { value: texMatrix },
        flipX: { value: FLIP_X },
        flipY: { value: FLIP_Y },
        pointSize: { value: 0.003 },
        sizeFactor: { value: 800.0 },
    },
    vertexShader: [
        'uniform mat4 texMatrix;',
        'uniform float pointSize;',
        'uniform float sizeFactor;',
        'varying vec4 vProj;',
        'varying float vWorldY;',
        'void main() {',
        '  vProj = texMatrix * modelMatrix * vec4(position, 1.0);',
        '  vWorldY = (modelMatrix * vec4(position, 1.0)).y;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = clamp(pointSize * sizeFactor / max(-mv.z, 0.05), 1.0, 16.0);',
        '}',
    ].join('\n'),
    fragmentShader: [
        'uniform sampler2D map;',
        'uniform float flipX;',
        'uniform float flipY;',
        'varying vec4 vProj;',
        'varying float vWorldY;',
        'void main() {',
        '  if (vWorldY < 0.0) discard;',
        '  vec2 pc = gl_PointCoord - 0.5;',
        '  if (dot(pc, pc) > 0.25) discard;',
        '  vec2 uv = vProj.xy / vProj.w;',
        '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;',
        '  if (flipX > 0.5) uv.x = 1.0 - uv.x;',
        '  if (flipY > 0.5) uv.y = 1.0 - uv.y;',
        '  gl_FragColor = texture2D(map, uv);',
        '}',
    ].join('\n'),
    transparent: true,
});

const cloudMat = cloudMatVideo;
const depthPoints = new THREE.Points(cloudGeo, cloudMat);
depthPoints.rotation.z = Math.PI / 2;
depthPoints.frustumCulled = false;
projectorMount.add(depthPoints);

let camIntr = { fx: 426.0, fy: 425.5, cx: 426.0, cy: 243.8, w: 848, h: 480 };

const MESH_W = 212;
const MESH_H = 120;
const meshPos = new Float32Array(MESH_W * MESH_H * 3);
const meshUv = new Float32Array(MESH_W * MESH_H * 2);
const meshIndices = [];
for (let j = 0; j < MESH_H; j++) {
    for (let i = 0; i < MESH_W; i++) {
        const k = j * MESH_W + i;
        meshUv[k * 2] = i / (MESH_W - 1);
        meshUv[k * 2 + 1] = 1.0 - j / (MESH_H - 1);
    }
}
for (let j = 0; j < MESH_H - 1; j++) {
    for (let i = 0; i < MESH_W - 1; i++) {
        const a = j * MESH_W + i;
        const b = a + 1;
        const c = a + MESH_W;
        const e = c + 1;
        meshIndices.push(a, c, b, b, c, e);
    }
}
const meshValid = new Float32Array(MESH_W * MESH_H);
const meshGeo = new THREE.BufferGeometry();
const meshPosAttr = new THREE.BufferAttribute(meshPos, 3);
meshPosAttr.setUsage(THREE.DynamicDrawUsage);
meshGeo.setAttribute('position', meshPosAttr);
meshGeo.setAttribute('uv', new THREE.BufferAttribute(meshUv, 2));
const meshValAttr = new THREE.BufferAttribute(meshValid, 1);
meshValAttr.setUsage(THREE.DynamicDrawUsage);
meshGeo.setAttribute('aValid', meshValAttr);
meshGeo.setIndex(meshIndices);
const meshMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: camTexture } },
    vertexShader: [
        'attribute float aValid;',
        'varying float vValid;',
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  vValid = aValid;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
    ].join('\n'),
    fragmentShader: [
        'uniform sampler2D map;',
        'varying float vValid;',
        'varying vec2 vUv;',
        'void main() {',
        '  if (vValid < 0.99) discard;',
        '  gl_FragColor = texture2D(map, vUv);',
        '}',
    ].join('\n'),
    side: THREE.DoubleSide,
});
const depthMesh = new THREE.Mesh(meshGeo, meshMat);
depthMesh.rotation.z = Math.PI / 2;
depthMesh.frustumCulled = false;
projectorMount.add(depthMesh);

function readDepthGrid() {
    if (!cloudVisible('chk-mesh1')) { setTimeout(readDepthGrid, 500); return; }
    const token = localStorage.getItem('access_token') || '';
    if (!token) { setTimeout(readDepthGrid, 2000); return; }
    fetch('/api/map/depth_grid?_t=' + Date.now(), {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
    }).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => {
            if (!ab || ab.byteLength < 4) return;
            const dv = new DataView(ab);
            const w = dv.getUint16(0, true);
            const h = dv.getUint16(2, true);
            if (w !== MESH_W || h !== MESH_H) return;
            const d = new Uint16Array(ab, 4, w * h);
            const MAXMM = 1200;
            const JUMP = 80;
            const fx = camIntr.fx, fy = camIntr.fy, cx = camIntr.cx, cy = camIntr.cy;
            const iw = camIntr.w, ih = camIntr.h;
            for (let j = 0; j < h; j++) {
                for (let i = 0; i < w; i++) {
                    const k = j * w + i;
                    const zmm = d[k];
                    let ok = zmm > 0 && zmm < MAXMM;
                    if (ok && i > 0 && d[k - 1] > 0 && Math.abs(zmm - d[k - 1]) > JUMP) ok = false;
                    if (ok && j > 0 && d[k - w] > 0 && Math.abs(zmm - d[k - w]) > JUMP) ok = false;
                    if (ok && i < w - 1 && d[k + 1] > 0 && Math.abs(zmm - d[k + 1]) > JUMP) ok = false;
                    if (ok && j < h - 1 && d[k + w] > 0 && Math.abs(zmm - d[k + w]) > JUMP) ok = false;
                    const z = (ok ? zmm : 500) / 1000.0;
                    const px = ((i + 0.5) / w) * iw;
                    const py = ((j + 0.5) / h) * ih;
                    meshPos[k * 3] = (px - cx) / fx * z;
                    meshPos[k * 3 + 1] = -((py - cy) / fy * z);
                    meshPos[k * 3 + 2] = -z;
                    meshValid[k] = ok ? 1 : 0;
                }
            }
            meshPosAttr.needsUpdate = true;
            meshValAttr.needsUpdate = true;
        })
        .catch(() => { })
        .finally(() => { setTimeout(readDepthGrid, 200); });
}
readDepthGrid();

let manualMode = 'auto';
let camMode1 = 'rgb';
let camMode2 = 'rgb';
let colorSrc = 'video';

function effMode(cam) {
    return manualMode === 'auto' ? (cam === 2 ? camMode2 : camMode1) : manualMode;
}

function turboColor(t) {
    const r = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3)));
    const g = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2)));
    const b = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1)));
    return [r, g, b];
}

function setCloudColors(colArr, posArr, count, rgb, mode) {
    if (mode === 'gray') {
        for (let i = 0; i < count; i++) {
            const j = i * 3;
            const l = (0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2]) / 255;
            colArr[j] = l; colArr[j + 1] = l; colArr[j + 2] = l;
        }
        return;
    }
    if (mode === 'depth') {
        let dmin = Infinity, dmax = -Infinity;
        for (let i = 0; i < count; i++) {
            const d = -posArr[i * 3 + 2];
            if (d < dmin) dmin = d;
            if (d > dmax) dmax = d;
        }
        const span = Math.max(dmax - dmin, 0.05);
        for (let i = 0; i < count; i++) {
            const t = Math.min(1, Math.max(0, (-posArr[i * 3 + 2] - dmin) / span));
            const c = turboColor(t);
            colArr[i * 3] = c[0]; colArr[i * 3 + 1] = c[1]; colArr[i * 3 + 2] = c[2];
        }
        return;
    }
    for (let i = 0; i < count; i++) {
        const j = i * 3;
        colArr[j] = rgb[j] / 255;
        colArr[j + 1] = rgb[j + 1] / 255;
        colArr[j + 2] = rgb[j + 2] / 255;
    }
}

async function fetchCloudBinary(url, maxPts) {
    const token = localStorage.getItem('access_token') || '';
    const extra = maxPts ? ('&max=' + maxPts) : '';
    const res = await fetch(url + '?_t=' + Date.now() + extra, {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
    });
    if (!res.ok) throw new Error('cloud ' + res.status);
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 4) throw new Error('empty cloud');
    const n = new DataView(ab).getUint32(0, true);
    if (!n) throw new Error('zero points');
    return {
        n,
        mm: new Int16Array(ab, 4, n * 3),
        rgb: new Uint8Array(ab, 4 + n * 6, n * 3),
    };
}

function fillCloudPositions(dst, mm, count) {
    for (let i = 0; i < count; i++) {
        const j = i * 3;
        dst[j] = mm[j] / 1000.0;
        dst[j + 1] = -mm[j + 1] / 1000.0;
        dst[j + 2] = -mm[j + 2] / 1000.0;
    }
}

// Full-resolution clouds are only pulled while their display toggle is
// on. Auto-align no longer depends on these loops — it fetches its own
// downsampled clouds on demand (see runIcpAlign).
function readPointCloud() {
    if (!cloudVisible('chk-cloud1')) return;
    fetchCloudBinary('/api/map/pointcloud', 0)
        .then(({ n, mm, rgb }) => {
            if (!n) return;
            const count = Math.min(n, MAX_PTS);
            fillCloudPositions(cloudPos, mm, count);
            setCloudColors(cloudCol, cloudPos, count, rgb, effMode(1));
            cloudGeo.setDrawRange(0, count);
            cloudPosAttr.needsUpdate = true;
            cloudColAttr.needsUpdate = true;
        })
        .catch(() => { })
        .finally(() => { setTimeout(readPointCloud, 700); });
}
readPointCloud();

const cam2Mount = new THREE.Object3D();
scene.add(cam2Mount);

const texMatrix2 = new THREE.Matrix4();
const projCam2 = new THREE.PerspectiveCamera(58, 848 / 480, 0.02, 50);

function updateProjector2() {
    cam2Mount.updateWorldMatrix(true, false);
    projCam2.matrixWorld.copy(cam2Mount.matrixWorld);
    projCam2.matrixWorldInverse.copy(projCam2.matrixWorld).invert();
    projCam2.updateProjectionMatrix();
    texMatrix2.multiplyMatrices(projBias, projCam2.projectionMatrix)
        .multiply(projCam2.matrixWorldInverse);
}

const CAM2_MAX_PTS = 100000;
const cam2Pos = new Float32Array(CAM2_MAX_PTS * 3);
const cam2Col = new Float32Array(CAM2_MAX_PTS * 3);
const cam2Geo = new THREE.BufferGeometry();
const cam2PosAttr = new THREE.BufferAttribute(cam2Pos, 3);
cam2PosAttr.setUsage(THREE.DynamicDrawUsage);
const cam2ColAttr = new THREE.BufferAttribute(cam2Col, 3);
cam2ColAttr.setUsage(THREE.DynamicDrawUsage);
cam2Geo.setAttribute('position', cam2PosAttr);
cam2Geo.setAttribute('color', cam2ColAttr);
cam2Geo.setDrawRange(0, 0);
const cam2MatSensor = new THREE.PointsMaterial({
    size: 0.004,
    sizeAttenuation: true,
    vertexColors: true,
    map: discTex,
    transparent: true,
    alphaTest: 0.5,
    clippingPlanes: [floorPlane],
});

const cam2MatVideo = new THREE.ShaderMaterial({
    uniforms: {
        map: { value: cam2Texture },
        texMatrix: { value: texMatrix2 },
        pointSize: { value: 0.003 },
        sizeFactor: { value: 800.0 },
    },
    vertexShader: [
        'uniform mat4 texMatrix;',
        'uniform float pointSize;',
        'uniform float sizeFactor;',
        'varying vec4 vProj;',
        'varying float vWorldY;',
        'void main() {',
        '  vProj = texMatrix * modelMatrix * vec4(position, 1.0);',
        '  vWorldY = (modelMatrix * vec4(position, 1.0)).y;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = clamp(pointSize * sizeFactor / max(-mv.z, 0.05), 1.0, 16.0);',
        '}',
    ].join('\n'),
    fragmentShader: [
        'uniform sampler2D map;',
        'varying vec4 vProj;',
        'varying float vWorldY;',
        'void main() {',
        '  if (vWorldY < 0.0) discard;',
        '  vec2 pc = gl_PointCoord - 0.5;',
        '  if (dot(pc, pc) > 0.25) discard;',
        '  vec2 uv = vProj.xy / vProj.w;',
        '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;',
        '  gl_FragColor = texture2D(map, uv);',
        '}',
    ].join('\n'),
    transparent: true,
});

const cam2Mat = cam2MatVideo;
const cam2Points = new THREE.Points(cam2Geo, cam2Mat);
cam2Points.frustumCulled = false;
cam2Mount.add(cam2Points);

const MESH2_W = 212;
const MESH2_H = 120;
const mesh2Pos = new Float32Array(MESH2_W * MESH2_H * 3);
const mesh2Uv = new Float32Array(MESH2_W * MESH2_H * 2);
const mesh2Valid = new Float32Array(MESH2_W * MESH2_H);
const mesh2Indices = [];
for (let j = 0; j < MESH2_H; j++) {
    for (let i = 0; i < MESH2_W; i++) {
        const k = j * MESH2_W + i;
        mesh2Uv[k * 2] = i / (MESH2_W - 1);
        mesh2Uv[k * 2 + 1] = 1.0 - j / (MESH2_H - 1);
    }
}
for (let j = 0; j < MESH2_H - 1; j++) {
    for (let i = 0; i < MESH2_W - 1; i++) {
        const a = j * MESH2_W + i;
        const b = a + 1;
        const c = a + MESH2_W;
        const e = c + 1;
        mesh2Indices.push(a, c, b, b, c, e);
    }
}
const mesh2Geo = new THREE.BufferGeometry();
const mesh2PosAttr = new THREE.BufferAttribute(mesh2Pos, 3);
mesh2PosAttr.setUsage(THREE.DynamicDrawUsage);
mesh2Geo.setAttribute('position', mesh2PosAttr);
mesh2Geo.setAttribute('uv', new THREE.BufferAttribute(mesh2Uv, 2));
const mesh2ValAttr = new THREE.BufferAttribute(mesh2Valid, 1);
mesh2ValAttr.setUsage(THREE.DynamicDrawUsage);
mesh2Geo.setAttribute('aValid', mesh2ValAttr);
mesh2Geo.setIndex(mesh2Indices);
const mesh2Mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: cam2Texture } },
    vertexShader: [
        'attribute float aValid;',
        'varying float vValid;',
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  vValid = aValid;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
    ].join('\n'),
    fragmentShader: [
        'uniform sampler2D map;',
        'varying float vValid;',
        'varying vec2 vUv;',
        'void main() {',
        '  if (vValid < 0.99) discard;',
        '  gl_FragColor = texture2D(map, vUv);',
        '}',
    ].join('\n'),
    side: THREE.DoubleSide,
});
const depthMesh2 = new THREE.Mesh(mesh2Geo, mesh2Mat);
depthMesh2.frustumCulled = false;
cam2Mount.add(depthMesh2);

function readDepthGrid2() {
    if (!cloudVisible('chk-mesh2')) { setTimeout(readDepthGrid2, 500); return; }
    const token = localStorage.getItem('access_token') || '';
    if (!token) { setTimeout(readDepthGrid2, 2000); return; }
    fetch('/api/camera/depth_grid2?_t=' + Date.now(), {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
    }).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => {
            if (!ab || ab.byteLength < 4) return;
            const dv = new DataView(ab);
            const w = dv.getUint16(0, true);
            const h = dv.getUint16(2, true);
            if (w !== MESH2_W || h !== MESH2_H) return;
            const d = new Uint16Array(ab, 4, w * h);
            const MAXMM = 1200;
            const JUMP = 80;
            const fx = camIntr.fx, fy = camIntr.fy, cx = camIntr.cx, cy = camIntr.cy;
            const iw = camIntr.w, ih = camIntr.h;
            for (let j = 0; j < h; j++) {
                for (let i = 0; i < w; i++) {
                    const k = j * w + i;
                    const zmm = d[k];
                    let ok = zmm > 0 && zmm < MAXMM;
                    if (ok && i > 0 && d[k - 1] > 0 && Math.abs(zmm - d[k - 1]) > JUMP) ok = false;
                    if (ok && j > 0 && d[k - w] > 0 && Math.abs(zmm - d[k - w]) > JUMP) ok = false;
                    if (ok && i < w - 1 && d[k + 1] > 0 && Math.abs(zmm - d[k + 1]) > JUMP) ok = false;
                    if (ok && j < h - 1 && d[k + w] > 0 && Math.abs(zmm - d[k + w]) > JUMP) ok = false;
                    const z = (ok ? zmm : 500) / 1000.0;
                    const px = ((i + 0.5) / w) * iw;
                    const py = ((j + 0.5) / h) * ih;
                    mesh2Pos[k * 3] = (px - cx) / fx * z;
                    mesh2Pos[k * 3 + 1] = -((py - cy) / fy * z);
                    mesh2Pos[k * 3 + 2] = -z;
                    mesh2Valid[k] = ok ? 1 : 0;
                }
            }
            mesh2PosAttr.needsUpdate = true;
            mesh2ValAttr.needsUpdate = true;
        })
        .catch(() => { })
        .finally(() => { setTimeout(readDepthGrid2, 100); });
}
readDepthGrid2();

const cam2MarkerMat = new THREE.MeshStandardMaterial({
    color: 0xff5522,
    emissive: 0xaa2200,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.5,
});
const cam2Marker = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 16), cam2MarkerMat);
cam2Marker.rotation.x = -Math.PI / 2;
cam2Mount.add(cam2Marker);

const cam2LabelCanvas = document.createElement('canvas');
cam2LabelCanvas.width = 256;
cam2LabelCanvas.height = 128;
const cam2LabelCtx = cam2LabelCanvas.getContext('2d');
cam2LabelCtx.fillStyle = '#ff5522';
cam2LabelCtx.font = 'bold 72px system-ui, sans-serif';
cam2LabelCtx.textAlign = 'center';
cam2LabelCtx.textBaseline = 'middle';
cam2LabelCtx.fillText('cam2', 128, 64);
const cam2Label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cam2LabelCanvas),
    transparent: true,
    depthTest: false,
}));
cam2Label.scale.set(0.22, 0.11, 1);
cam2Label.renderOrder = 999;
scene.add(cam2Label);

// cam1 lives on the arm tip (projectorMount is a child of endEffector),
// so give it the same cone+label marker cam2 has — otherwise only cam2
// is visible and cam1's position can't be seen in the scene.
const cam1Marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.1, 16),
    new THREE.MeshStandardMaterial({
        color: 0x2fa8ff, emissive: 0x1166cc,
        emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.5
    }));
cam1Marker.rotation.x = -Math.PI / 2;
projectorMount.add(cam1Marker);

const cam1LabelCanvas = document.createElement('canvas');
cam1LabelCanvas.width = 256;
cam1LabelCanvas.height = 128;
const cam1LabelCtx = cam1LabelCanvas.getContext('2d');
cam1LabelCtx.fillStyle = '#2fa8ff';
cam1LabelCtx.font = 'bold 72px system-ui, sans-serif';
cam1LabelCtx.textAlign = 'center';
cam1LabelCtx.textBaseline = 'middle';
cam1LabelCtx.fillText('cam1', 128, 64);
const cam1Label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cam1LabelCanvas),
    transparent: true,
    depthTest: false,
}));
cam1Label.scale.set(0.22, 0.11, 1);
cam1Label.renderOrder = 999;
scene.add(cam1Label);

function readPointCloud2() {
    if (!cloudVisible('chk-cloud2')) return;
    fetchCloudBinary('/api/camera/pointcloud2', 0)
        .then(({ n, mm, rgb }) => {
            if (!n) return;
            const count = Math.min(n, CAM2_MAX_PTS);
            fillCloudPositions(cam2Pos, mm, count);
            setCloudColors(cam2Col, cam2Pos, count, rgb, effMode(2));
            cam2Geo.setDrawRange(0, count);
            cam2PosAttr.needsUpdate = true;
            cam2ColAttr.needsUpdate = true;
        })
        .catch(() => { })
        .finally(() => { setTimeout(readPointCloud2, 800); });
}
readPointCloud2();
