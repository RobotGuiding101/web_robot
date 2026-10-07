// Scene, camera feeds, robot hierarchy and .dae loading.
//
// Part of robot-viewer.html. Loads after Three.js and its loaders, and before the files listed below it. robot-viewer.html pulls these in as plain classic scripts in this exact order because the original was one linear script: several top-level calls here run functions declared earlier in an earlier file.


// Check view/display mode from URL query (?mode=display or ?display=1)
const urlParams = new URLSearchParams(window.location.search);
const isDisplayOnly = urlParams.get('mode') === 'display' || urlParams.has('display') || urlParams.has('minimal') || urlParams.has('viewonly');
if (isDisplayOnly) {
    document.body.classList.add('display-only');
}

// ===== 1. Scene, Camera, Renderer =====
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f5);

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.set(1.8, 1.8, 2.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true;
container.appendChild(renderer.domElement);
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.0);

const cameraControls = new THREE.OrbitControls(camera, renderer.domElement);
cameraControls.enableDamping = true;
cameraControls.dampingFactor = 0.05;
cameraControls.target.set(0, 0.4, 0);

// Lighting
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8e0ea, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(3, 6, 4);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 20;
dirLight.shadow.camera.left = -2;
dirLight.shadow.camera.right = 2;
dirLight.shadow.camera.top = 2;
dirLight.shadow.camera.bottom = -2;
dirLight.shadow.bias = -0.0005;
dirLight.shadow.radius = 3;
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.5);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const pmrem = new THREE.PMREMGenerator(renderer);
const envCanvas = document.createElement('canvas');
envCanvas.width = 256; envCanvas.height = 128;
const envCtx = envCanvas.getContext('2d');
const envGrad = envCtx.createLinearGradient(0, 0, 0, 128);
envGrad.addColorStop(0.0, '#ffffff');
envGrad.addColorStop(0.5, '#eaeff5');
envGrad.addColorStop(1.0, '#b6c1cc');
envCtx.fillStyle = envGrad;
envCtx.fillRect(0, 0, 256, 128);
const envTex = new THREE.CanvasTexture(envCanvas);
envTex.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = pmrem.fromEquirectangular(envTex).texture;
envTex.dispose();
pmrem.dispose();

// Grid + soft shadow catcher
const gridHelper = new THREE.GridHelper(3, 15, 0xbbbbbb, 0xdddddd);
scene.add(gridHelper);
const axesHelper = new THREE.AxesHelper(0.4);
scene.add(axesHelper);
const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.ShadowMaterial({ opacity: 0.22 }));
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// ===== Camera Feed Ground Plane =====
const camCanvas = document.createElement('canvas');
camCanvas.width = 640;
camCanvas.height = 360;
const camCtx = camCanvas.getContext('2d');
const camTexture = new THREE.CanvasTexture(camCanvas);
camTexture.minFilter = THREE.LinearFilter;
camTexture.magFilter = THREE.LinearFilter;

const cam2Canvas = document.createElement('canvas');
cam2Canvas.width = 640;
cam2Canvas.height = 360;
const cam2Ctx = cam2Canvas.getContext('2d');
const cam2Texture = new THREE.CanvasTexture(cam2Canvas);
cam2Texture.minFilter = THREE.LinearFilter;
cam2Texture.magFilter = THREE.LinearFilter;

const depthCanvas = document.createElement('canvas');
depthCanvas.width = 160;
depthCanvas.height = 90;
const depthCtx = depthCanvas.getContext('2d');
const depthTexture = new THREE.CanvasTexture(depthCanvas);
depthTexture.minFilter = THREE.LinearFilter;
depthTexture.magFilter = THREE.LinearFilter;

// Toggle check for the per-layer cloud visibility switches. Declared here,
// not next to the clouds, because readDepthFrame() below calls it while this
// file is still evaluating and a function from a later <script> is not
// in scope yet.
function cloudVisible(id) {
    const el = document.getElementById(id);
    return !!(el && el.checked);
}

function readDepthFrame() {
    if (!cloudVisible('chk-mesh1')) { setTimeout(readDepthFrame, 500); return; }
    const token = localStorage.getItem('access_token') || '';
    if (!token) { setTimeout(readDepthFrame, 2000); return; }
    fetch('/api/map/depth_frame?_t=' + Date.now(), {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
    }).then((res) => { if (!res.ok) throw 0; return res.blob(); })
        .then((blob) => createImageBitmap(blob))
        .then((bmp) => {
            depthCtx.drawImage(bmp, 0, 0, depthCanvas.width, depthCanvas.height);
            bmp.close();
            depthTexture.needsUpdate = true;
        })
        .catch(() => { })
        .finally(() => { setTimeout(readDepthFrame, 120); });
}
readDepthFrame();

function findSeq(buf, seq, from) {
    const n = seq.length;
    for (let i = from; i <= buf.length - n; i++) {
        let ok = true;
        for (let j = 0; j < n; j++) { if (buf[i + j] !== seq[j]) { ok = false; break; } }
        if (ok) return i;
    }
    return -1;
}

function catBuf(a, b) {
    if (a.length === 0) return b;
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
}

function drawJpeg(jpeg) {
    createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' })).then((bmp) => {
        if (camCanvas.width !== bmp.width || camCanvas.height !== bmp.height) {
            camCanvas.width = bmp.width; camCanvas.height = bmp.height;
        }
        camCtx.drawImage(bmp, 0, 0);
        bmp.close();
        camTexture.needsUpdate = true;
    }).catch(() => { });
}

function readCamStream() {
    const token = localStorage.getItem('access_token') || '';
    if (!token) {
        console.warn('[readCamStream] No access_token in localStorage, retrying in 2s...');
        setTimeout(readCamStream, 2000);
        return;
    }
    fetch('/api/map/video_feed?_t=' + Date.now(), {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
    }).then((res) => {
        if (!res.ok || !res.body) throw new Error('stream ' + res.status);
        const reader = res.body.getReader();
        let buf = new Uint8Array(0);
        const pump = () => reader.read().then(({ value, done }) => {
            if (done) {
                console.warn('[readCamStream] Stream finished/closed, reconnecting in 1s...');
                setTimeout(readCamStream, 1000);
                return;
            }
            buf = catBuf(buf, value);
            // Real-time: keep ONLY the last complete JPEG in this batch
            // and drop the older ones. Drawing every buffered frame made
            // the texture replay stale frames, so lag grew the longer a
            // stream ran (TCP buffer + decode backlog).
            let pos = 0, last = null;
            for (; ;) {
                const soi = findSeq(buf, [0xff, 0xd8], pos);
                if (soi < 0) { pos = Math.max(0, buf.length - 1); break; }
                const eoi = findSeq(buf, [0xff, 0xd9], soi + 2);
                if (eoi < 0) { pos = soi; break; }
                last = buf.subarray(soi, eoi + 2);
                pos = eoi + 2;
            }
            if (last) drawJpeg(last);
            if (pos > 0) buf = buf.subarray(pos);
            return pump();
        });
        return pump();
    }).catch((err) => {
        console.warn('[readCamStream] Error reading stream, retrying in 1s:', err);
        setTimeout(readCamStream, 1000);
    });
}
readCamStream();

function drawJpeg2(jpeg) {
    createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' })).then((bmp) => {
        if (cam2Canvas.width !== bmp.width || cam2Canvas.height !== bmp.height) {
            cam2Canvas.width = bmp.width; cam2Canvas.height = bmp.height;
        }
        cam2Ctx.drawImage(bmp, 0, 0);
        bmp.close();
        cam2Texture.needsUpdate = true;
    }).catch(() => { });
}

function readCam2Stream() {
    const token = localStorage.getItem('access_token') || '';
    if (!token) {
        console.warn('[readCam2Stream] No access_token in localStorage, retrying in 2s...');
        setTimeout(readCam2Stream, 2000);
        return;
    }
    fetch('/api/camera/stream2?_t=' + Date.now(), {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
    }).then((res) => {
        if (!res.ok || !res.body) throw new Error('stream2 ' + res.status);
        const reader = res.body.getReader();
        let buf = new Uint8Array(0);
        const pump = () => reader.read().then(({ value, done }) => {
            if (done) {
                console.warn('[readCam2Stream] Stream finished/closed, reconnecting in 1s...');
                setTimeout(readCam2Stream, 1000);
                return;
            }
            buf = catBuf(buf, value);
            let pos = 0, last = null;
            for (; ;) {
                const soi = findSeq(buf, [0xff, 0xd8], pos);
                if (soi < 0) { pos = Math.max(0, buf.length - 1); break; }
                const eoi = findSeq(buf, [0xff, 0xd9], soi + 2);
                if (eoi < 0) { pos = soi; break; }
                last = buf.subarray(soi, eoi + 2);
                pos = eoi + 2;
            }
            if (last) drawJpeg2(last);
            if (pos > 0) buf = buf.subarray(pos);
            return pump();
        });
        return pump();
    }).catch((err) => {
        console.warn('[readCam2Stream] Error reading stream2, retrying in 1s:', err);
        setTimeout(readCam2Stream, 1000);
    });
}
readCam2Stream();

const texMatrix = new THREE.Matrix4();
const FLIP_X = 0.0;
const FLIP_Y = 0.0;
const DISP_SCALE = 0.0;
const DISP_REF = 0.22;
const groundGeo = new THREE.PlaneGeometry(1.2, 0.68, 24, 24);
const groundMat = new THREE.ShaderMaterial({
    uniforms: {
        map: { value: camTexture },
        depthMap: { value: depthTexture },
        texMatrix: { value: texMatrix },
        opacity: { value: 0.92 },
        flipX: { value: FLIP_X },
        flipY: { value: FLIP_Y },
        dispScale: { value: DISP_SCALE },
        dispRef: { value: DISP_REF },
    },
    vertexShader: [
        'uniform mat4 texMatrix;',
        'uniform sampler2D depthMap;',
        'uniform float dispScale;',
        'uniform float dispRef;',
        'varying vec4 vProj;',
        'void main() {',
        '  vProj = texMatrix * modelMatrix * vec4(position, 1.0);',
        '  vec4 p = vProj;',
        '  p.xyz /= p.w;',
        '  float d = dispRef;',
        '  if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {',
        '    d = texture2D(depthMap, p.xy).r;',
        '  }',
        '  vec3 pos = position;',
        '  pos.z += (dispRef - d) * dispScale;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
        '}',
    ].join('\n'),
    fragmentShader: [
        'uniform sampler2D map;',
        'uniform float opacity;',
        'uniform float flipX;',
        'uniform float flipY;',
        'varying vec4 vProj;',
        'void main() {',
        '  vec4 pr = vProj;',
        '  pr.xyz /= pr.w;',
        '  vec2 uv = pr.xy;',
        '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;',
        '  if (flipX > 0.5) uv.x = 1.0 - uv.x;',
        '  if (flipY > 0.5) uv.y = 1.0 - uv.y;',
        '  gl_FragColor = texture2D(map, uv);',
        '  gl_FragColor.a *= opacity;',
        '}',
    ].join('\n'),
    transparent: true,
    side: THREE.DoubleSide,
});
const groundPlane = new THREE.Mesh(groundGeo, groundMat);
groundPlane.renderOrder = -1;

// ===== 2. Robot Hierarchy =====
const robotBase = new THREE.Group();
const link1 = new THREE.Group();
const link2 = new THREE.Group();
const link3 = new THREE.Group();
const link4 = new THREE.Group();
const link5 = new THREE.Group();
const link6 = new THREE.Group();

scene.add(robotBase);
robotBase.add(link1);
link1.add(link2);
link2.add(link3);
link3.add(link4);
link4.add(link5);
link5.add(link6);

link1.position.set(0, 0.147, 0);
link2.position.set(0, 0, 0);
link3.position.set(0, 0.43, 0);
link4.position.set(0, 0.357, 0.14);
link5.position.set(0, 0.1, 0);
link6.position.set(0, 0, 0.105);

// ===== 3. Load .dae Models =====
const loader = new THREE.ColladaLoader();
const deg = (d) => THREE.MathUtils.degToRad(d);

let loadedCount = 0;
const totalModels = 7;

function onModelLoaded() {
    loadedCount++;
    if (loadedCount >= totalModels) {
        scene.traverse((o) => {
            if (o.isMesh && o !== shadowPlane) {
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });
        const overlay = document.getElementById('loading-overlay');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 400);
    }
}

loader.load('models/base_link.dae', (c) => {
    c.scene.rotation.set(deg(-90), deg(0), deg(0));
    robotBase.add(c.scene); onModelLoaded();
}, undefined, onModelLoaded);

loader.load('models/Link1.dae', (c) => {
    c.scene.rotation.set(deg(-90), deg(0), deg(0));
    link1.add(c.scene); onModelLoaded();
}, undefined, onModelLoaded);

loader.load('models/Link2.dae', (c) => {
    c.scene.rotation.set(deg(0), deg(0), deg(-90));
    link2.add(c.scene); onModelLoaded();
}, undefined, onModelLoaded);

loader.load('models/Link3.dae', (c) => {
    c.scene.rotation.set(deg(0), deg(0), deg(-90));
    link3.add(c.scene); onModelLoaded();
}, undefined, onModelLoaded);

loader.load('models/Link4.dae', (c) => {
    c.scene.rotation.set(deg(0), deg(0), deg(-180));
    link4.add(c.scene); onModelLoaded();
}, undefined, onModelLoaded);

loader.load('models/Link5.dae', (c) => {
    c.scene.rotation.set(deg(-90), deg(0), deg(180));
    link5.add(c.scene); onModelLoaded();
}, undefined, onModelLoaded);

loader.load('models/Link6_S.dae', (c) => {
    c.scene.rotation.set(deg(180), deg(0), deg(180));
    c.scene.traverse((child) => {
        if (child.isMesh) {
            child.material = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                side: THREE.DoubleSide,
            });
        } else if (child.isLight || child.isCamera) {
            // The Blender export embeds 14 blue point lights + cameras —
            // disable them so they don't wash out the model's color.
            child.visible = false;
        }
    });
    link6.add(c.scene);
    // Place the draggable gizmo on the model's physical tip: the vertex
    // of the "Cylinder_nip" mesh farthest from the flange (link6
    // origin). A bounding-box corner overshoots by the tool radius, so
    // walk the actual vertices instead.
    try {
        link6.updateWorldMatrix(true, true);
        const invLink6 = new THREE.Matrix4().copy(link6.matrixWorld).invert();
        const v = new THREE.Vector3();
        let best = null;
        let bestD = -1;
        const matched = [];
        c.scene.traverse((o) => {
            if (o.isMesh && /Cylinder_nip/i.test(o.name || '')) {
                matched.push(o.name);
                const pos = o.geometry.attributes.position;
                if (!pos) return;
                const m = new THREE.Matrix4().multiplyMatrices(invLink6, o.matrixWorld);
                for (let i = 0; i < pos.count; i++) {
                    v.fromBufferAttribute(pos, i).applyMatrix4(m);
                    const d = v.lengthSq();
                    if (d > bestD) { bestD = d; best = v.clone(); }
                }
            }
        });
        if (best) {
            gizmoTip.position.copy(best);
        }
    } catch (e) { /* ignore */ }
    onModelLoaded();
}, undefined, onModelLoaded);
