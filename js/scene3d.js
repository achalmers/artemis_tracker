// scene3d.js — Three.js 3D scene for ARTEMIS TRACKER
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 1 scene unit = 1 Earth radius = 6371 km
const KM_TO_UNIT = 1 / 6371;

export class Scene3D {
  constructor(canvas, trajectory) {
    this.canvas      = canvas;
    this.trajectory  = trajectory;

    // three.js objects
    this.renderer   = null;
    this.scene      = null;
    this.camera     = null;
    this.controls   = null;

    // Mesh references
    this.earthMesh  = null;
    this.moonMesh   = null;
    this.scMesh     = null;          // model spacecraft (amber, time-slider driven)
    this.scGlow     = null;
    this.trackFull  = null;          // cyan — intended future track (model)
    this.trackDone  = null;          // red  — model-based flown track (fallback when no live data)

    // Live data objects (created on first fix)
    this.liveTrackLine = null;       // red  — actual flown track (live GPS fixes)
    this.liveDot       = null;       // red sphere at current live position
    this.liveGlow      = null;       // additive glow sprite on liveDot
    this._hasLiveData  = false;

    // Labels
    this.earthLabel = null;
    this.moonLabel  = null;
    this.scLabel    = null;
    this.liveLabel  = null;
    this._labelRoot = null;

    // State flags
    this.showGrid      = false;
    this.showLabels    = true;
    this.showOrbit     = true;
    this.followSC      = false;
    this._gridHelper   = null;
    this._orbitHelpers = [];

    // Internal
    this._totalPoints  = trajectory.trajectoryPoints.length;
    this._prevIndex    = -1;
    this._pulseT       = 0;          // animation clock for live dot pulse
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  init() {
    this._setupRenderer();
    this._setupCamera();
    this._setupControls();
    this._setupLighting();
    this._createStars();
    this._createEarth();
    this._createMoon();
    this._createTrajectoryLines();
    this._createSpacecraft();
    this._createLabels();
    this._createOrbitalGrid();
    this._handleResize();
  }

  // ── Per-frame update ──────────────────────────────────────────────────────
  update(met) {
    const S = KM_TO_UNIT;

    // Moon
    const mp = this.trajectory.getMoonPosition(met);
    this.moonMesh.position.set(mp.x * S, mp.y * S, mp.z * S);

    // Spacecraft position — computed from the same trajectory as the blue line
    const sp = this.trajectory.getSpacecraftPosition(met);
    const sv = new THREE.Vector3(sp.x * S, sp.y * S, sp.z * S);
    this.scMesh.position.copy(sv);
    if (this.scGlow) this.scGlow.position.copy(sv);

    // Pulse animation for the model spacecraft circle
    this._pulseT += 0.04;
    const pulse = 0.5 + 0.5 * Math.sin(this._pulseT);
    if (this.scGlow) {
      this.scGlow.material.opacity = 0.15 + 0.20 * pulse;
      this.scGlow.scale.setScalar(0.65 + 0.20 * pulse);
    }

    // Slow Earth rotation
    this.earthMesh.rotation.y += 0.0003;

    // Labels
    if (this.showLabels) this._updateLabels(met, mp, sp);

    // Camera follow — always track the model spacecraft (red circle on the blue line)
    if (this.followSC) {
      this.controls.target.lerp(sv, 0.05);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ── Live data update (called by LiveTracker callbacks) ────────────────────
  updateLiveData(history, currentFix, launchDate) {
    const S = KM_TO_UNIT;
    this._hasLiveData = true;

    // Hide the model-based flown track — live track replaces it
    if (this.trackDone) this.trackDone.visible = false;

    // Always show the FULL intended (blue) trajectory — never trimmed
    this.trackFull.geometry.setDrawRange(0, this._totalPoints);

    // ── The red circle (scMesh) is the primary spacecraft position marker.
    //       It is driven by getSpacecraftPosition(liveMET) in update(), which
    //       uses the same Catmull-Rom interpolation as the blue trajectory line,
    //       so it always sits exactly on the blue line.
    //       No separate liveDot is created — it would sit off the intended track
    //       and cause visual confusion.
  }

  // ── Camera presets ────────────────────────────────────────────────────────
  setCameraView(view) {
    this.followSC = false;
    const dur = 0;
    switch (view) {
      case 'top':
        this.camera.position.set(0, 120, 0.01);
        this.controls.target.set(0, 0, 0);
        break;
      case 'side':
        this.camera.position.set(120, 10, 0);
        this.controls.target.set(0, 0, 0);
        break;
      case 'earth':
        this.camera.position.set(0, 3, 8);
        this.controls.target.set(0, 0, 0);
        break;
      case 'spacecraft': {
        this.followSC = true;
        const sp = this.trajectory.getSpacecraftPosition(this.trajectory.currentMET);
        const sv = new THREE.Vector3(sp.x * KM_TO_UNIT, sp.y * KM_TO_UNIT, sp.z * KM_TO_UNIT);
        this.camera.position.copy(sv).add(new THREE.Vector3(0, 2, 3));
        this.controls.target.copy(sv);
        break;
      }
      default:
        this.camera.position.set(0, 30, 80);
        this.controls.target.set(0, 0, 0);
    }
    this.controls.update();
  }

  // ── Display toggles ───────────────────────────────────────────────────────
  setShowGrid(val) {
    this.showGrid = val;
    if (this._gridHelper) this._gridHelper.visible = val;
  }

  setShowOrbit(val) {
    this.showOrbit = val;
    this.trackFull.visible = val;
  }

  setShowLabels(val) {
    this.showLabels = val;
    if (this._labelRoot) this._labelRoot.visible = val;
  }

  // ── Private builders ──────────────────────────────────────────────────────
  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Pass updateStyle=false so Three.js doesn't override our CSS width/height:100%
    const w = this.canvas.clientWidth  || this.canvas.parentElement?.clientWidth  || 800;
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x000005);
    this.scene = new THREE.Scene();
  }

  _setupCamera() {
    const w = this.canvas.clientWidth  || this.canvas.parentElement?.clientWidth  || 800;
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.01, 2000);
    this.camera.position.set(0, 28, 75);
  }

  _setupControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.07;
    this.controls.minDistance    = 1.2;
    this.controls.maxDistance    = 800;
    this.controls.target.set(0, 0, 0);
  }

  _setupLighting() {
    // Simulate sunlight from a distant direction
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.8);
    sun.position.set(200, 80, 150);
    this.scene.add(sun);

    const ambient = new THREE.AmbientLight(0x0a0a20, 1.2);
    this.scene.add(ambient);

    // Subtle fill light from the opposite side (earthshine effect)
    const fill = new THREE.DirectionalLight(0x2244aa, 0.25);
    fill.position.set(-150, -30, -100);
    this.scene.add(fill);
  }

  _createStars() {
    const count = 3000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * 2 * Math.PI;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 600 + Math.random() * 200;
      positions[i*3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i*3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i*3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  _createEarth() {
    const geo  = new THREE.SphereGeometry(1, 64, 32);
    const tex  = this._buildEarthTexture();
    const mat  = new THREE.MeshPhongMaterial({
      map:       tex,
      specular:  new THREE.Color(0x2244aa),
      shininess: 12,
    });
    this.earthMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.earthMesh);

    // Atmosphere glow
    const atmoGeo = new THREE.SphereGeometry(1.03, 32, 16);
    const atmoMat = new THREE.MeshPhongMaterial({
      color:       0x3399ff,
      transparent: true,
      opacity:     0.10,
      side:        THREE.FrontSide,
      depthWrite:  false,
    });
    this.scene.add(new THREE.Mesh(atmoGeo, atmoMat));

    // Thin rim glow (backside)
    const rimGeo = new THREE.SphereGeometry(1.06, 32, 16);
    const rimMat = new THREE.MeshBasicMaterial({
      color:       0x3366cc,
      transparent: true,
      opacity:     0.07,
      side:        THREE.BackSide,
      depthWrite:  false,
    });
    this.scene.add(new THREE.Mesh(rimGeo, rimMat));
  }

  _createMoon() {
    const geo = new THREE.SphereGeometry(1737 / 6371, 32, 16);
    const tex = this._buildMoonTexture();
    const mat = new THREE.MeshPhongMaterial({
      map:       tex,
      specular:  new THREE.Color(0x111111),
      shininess: 3,
    });
    this.moonMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.moonMesh);
  }

  _createTrajectoryLines() {
    const S   = KM_TO_UNIT;
    const pts = this.trajectory.trajectoryPoints;

    // Build a static Float32 buffer for all points
    const positions = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      positions[i*3]     = p.x * S;
      positions[i*3 + 1] = p.y * S;
      positions[i*3 + 2] = p.z * S;
    });

    // Full trajectory — intended track in blue
    const geoFull = new THREE.BufferGeometry();
    geoFull.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    this.trackFull = new THREE.Line(geoFull, new THREE.LineBasicMaterial({
      color: 0x2266ff, transparent: true, opacity: 0.80,
    }));
    this.scene.add(this.trackFull);

    this.trackDone = null;  // red flown track removed — blue intended line only
  }

  _createSpacecraft() {
    // Red circle ring sprite — always faces the camera, sits on the blue trajectory line
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    // Semi-transparent fill
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 34, 34, 0.22)';
    ctx.fill();
    // Bright ring outline
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = 10;
    ctx.stroke();

    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({
      map:        tex,
      transparent: true,
      depthTest:  false,
      depthWrite: false,
    });
    this.scMesh = new THREE.Sprite(mat);
    this.scMesh.scale.set(0.45, 0.45, 1);
    this.scene.add(this.scMesh);

    // Red additive glow behind the circle
    const glowMat = new THREE.SpriteMaterial({
      color:      0xff2222,
      transparent: true,
      opacity:    0.28,
      depthWrite: false,
      blending:   THREE.AdditiveBlending,
    });
    this.scGlow = new THREE.Sprite(glowMat);
    this.scGlow.scale.set(0.75, 0.75, 1);
    this.scene.add(this.scGlow);
  }

  _createLabels() {
    this._labelRoot = new THREE.Group();
    this.scene.add(this._labelRoot);

    this.earthLabel = this._makeLabel('EARTH',  0x66aaff);
    this.moonLabel  = this._makeLabel('MOON',   0xbbbbbb);
    this.scLabel    = this._makeLabel('ORION',  0xffdd66);

    this.earthLabel.position.set(0, 1.4, 0);
    this._labelRoot.add(this.earthLabel);
    this._labelRoot.add(this.moonLabel);
    this._labelRoot.add(this.scLabel);
  }

  _makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width  = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font         = 'bold 28px "Orbitron", monospace';
    ctx.fillStyle    = '#' + color.toString(16).padStart(6,'0');
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = '#' + color.toString(16).padStart(6,'0');
    ctx.shadowBlur   = 8;
    ctx.fillText(text, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp  = new THREE.Sprite(mat);
    sp.scale.set(4, 1, 1);
    return sp;
  }

  _updateLabels(met, mp, sp) {
    const S = KM_TO_UNIT;
    if (this.moonLabel)
      this.moonLabel.position.set(mp.x * S, mp.y * S + 0.6, mp.z * S);
    if (this.scLabel) {
      // ORION label always follows the model spacecraft (red circle on the blue line)
      this.scLabel.position.set(sp.x * S, sp.y * S + 0.4, sp.z * S);
    }
  }

  _createOrbitalGrid() {
    // Orbital plane grid (XZ plane)
    this._gridHelper = new THREE.GridHelper(160, 40, 0x112244, 0x0a1122);
    this._gridHelper.visible = false;
    this.scene.add(this._gridHelper);

    // Moon orbit ring
    const ringGeo = new THREE.TorusGeometry(
      this.trajectory.MOON_ORBITAL_RADIUS_KM * KM_TO_UNIT,
      0.05, 2, 180
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x223344, transparent: true, opacity: 0.3,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this._orbitHelpers.push(ring);
  }

  _handleResize() {
    const resize = () => {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false); // false = don't override CSS style
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    resize(); // apply correct size immediately after layout
    const ro = new ResizeObserver(resize);
    ro.observe(this.canvas);
  }

  // ── Procedural textures ───────────────────────────────────────────────────
  _buildEarthTexture() {
    const W = 1024, H = 512;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');

    // Ocean base
    const oceanGrad = c.createLinearGradient(0, 0, 0, H);
    oceanGrad.addColorStop(0,   '#0e3055');
    oceanGrad.addColorStop(0.3, '#1a6698');
    oceanGrad.addColorStop(0.7, '#1a6698');
    oceanGrad.addColorStop(1,   '#0e3055');
    c.fillStyle = oceanGrad;
    c.fillRect(0, 0, W, H);

    // Simplified continents (polygon paths in equirectangular coords)
    // Each group is [x,y] pairs as fraction of [W, H]
    const land = [
      // North America
      [ [0.14,0.22],[0.18,0.15],[0.25,0.12],[0.28,0.18],[0.27,0.32],
        [0.24,0.44],[0.20,0.50],[0.16,0.48],[0.13,0.38],[0.12,0.28] ],
      // South America
      [ [0.22,0.50],[0.26,0.47],[0.28,0.53],[0.27,0.65],[0.24,0.78],
        [0.20,0.74],[0.19,0.60],[0.20,0.53] ],
      // Europe
      [ [0.49,0.16],[0.53,0.14],[0.59,0.17],[0.57,0.24],[0.52,0.27],
        [0.47,0.25],[0.47,0.20] ],
      // Africa
      [ [0.50,0.29],[0.57,0.26],[0.62,0.32],[0.63,0.52],[0.57,0.64],
        [0.52,0.64],[0.48,0.52],[0.49,0.38] ],
      // Asia (big)
      [ [0.58,0.14],[0.73,0.10],[0.90,0.14],[0.94,0.22],[0.88,0.34],
        [0.80,0.38],[0.72,0.36],[0.64,0.30],[0.59,0.24] ],
      // India
      [ [0.68,0.36],[0.73,0.35],[0.74,0.46],[0.70,0.52],[0.66,0.46] ],
      // South-East Asia
      [ [0.80,0.38],[0.86,0.36],[0.88,0.44],[0.84,0.48],[0.79,0.46] ],
      // Australia
      [ [0.78,0.58],[0.84,0.56],[0.88,0.60],[0.87,0.68],[0.82,0.72],
        [0.77,0.70],[0.76,0.62] ],
    ];

    const colors = ['#2d7a3e','#268537','#225e2e','#346b25','#1f6b38','#2a7040'];
    land.forEach((pts, i) => {
      c.beginPath();
      c.moveTo(pts[0][0]*W, pts[0][1]*H);
      pts.slice(1).forEach(([x,y]) => c.lineTo(x*W, y*H));
      c.closePath();
      c.fillStyle = colors[i % colors.length];
      c.fill();
      // Slight coastline shade
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 1;
      c.stroke();
    });

    // Polar ice caps
    const arctic = c.createLinearGradient(0, 0, 0, H * 0.12);
    arctic.addColorStop(0, 'rgba(220,235,248,0.95)');
    arctic.addColorStop(1, 'rgba(220,235,248,0)');
    c.fillStyle = arctic;
    c.fillRect(0, 0, W, H * 0.12);

    const antarctic = c.createLinearGradient(0, H * 0.88, 0, H);
    antarctic.addColorStop(0, 'rgba(210,230,248,0)');
    antarctic.addColorStop(1, 'rgba(210,230,248,0.95)');
    c.fillStyle = antarctic;
    c.fillRect(0, H * 0.88, W, H * 0.12);

    // Subtle cloud wisps
    c.globalAlpha = 0.12;
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 20; i++) {
      const cx = Math.random() * W, cy = Math.random() * H;
      c.beginPath();
      c.ellipse(cx, cy, 60 + Math.random()*80, 10 + Math.random()*15, Math.random()*Math.PI, 0, Math.PI*2);
      c.fill();
    }
    c.globalAlpha = 1;

    return new THREE.CanvasTexture(cv);
  }

  _buildMoonTexture() {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');

    // Base regolith gray
    c.fillStyle = '#9e9e9e';
    c.fillRect(0, 0, S, S);

    // Albedo variation
    const alb = c.createRadialGradient(S*0.4, S*0.4, 0, S/2, S/2, S*0.7);
    alb.addColorStop(0, 'rgba(180,180,180,0.2)');
    alb.addColorStop(1, 'rgba(60,60,60,0.2)');
    c.fillStyle = alb;
    c.fillRect(0, 0, S, S);

    // Dark maria (lunar seas)
    const maria = [
      { x:0.37, y:0.34, rx:0.16, ry:0.12, a:0.2 },   // Mare Imbrium
      { x:0.57, y:0.40, rx:0.10, ry:0.09, a:0.3 },   // Mare Serenitatis
      { x:0.62, y:0.52, rx:0.09, ry:0.08, a:0.25},   // Mare Tranquillitatis
      { x:0.42, y:0.54, rx:0.12, ry:0.09, a:0.2 },   // Mare Nubium / Cognitum
      { x:0.30, y:0.52, rx:0.08, ry:0.07, a:0.2 },   // Oceanus Procellarum
    ];
    maria.forEach(m => {
      c.beginPath();
      c.ellipse(m.x*S, m.y*S, m.rx*S, m.ry*S, 0.3, 0, Math.PI*2);
      c.fillStyle = `rgba(80,80,80,${m.a})`;
      c.fill();
    });

    // Impact craters (bright rim + darker floor)
    const craters = [
      {x:0.20, y:0.25, r:0.055}, {x:0.70, y:0.22, r:0.038},
      {x:0.55, y:0.68, r:0.046}, {x:0.82, y:0.55, r:0.030},
      {x:0.15, y:0.65, r:0.042}, {x:0.48, y:0.18, r:0.022},
      {x:0.75, y:0.72, r:0.028}, {x:0.35, y:0.75, r:0.032},
    ];
    craters.forEach(cr => {
      // Rim (bright)
      c.beginPath();
      c.arc(cr.x*S, cr.y*S, cr.r*S, 0, Math.PI*2);
      c.fillStyle = 'rgba(185,185,185,0.7)';
      c.fill();
      // Floor (dark)
      c.beginPath();
      c.arc(cr.x*S, cr.y*S, cr.r*S*0.7, 0, Math.PI*2);
      c.fillStyle = 'rgba(70,70,70,0.6)';
      c.fill();
      // Central peak
      c.beginPath();
      c.arc(cr.x*S, cr.y*S, cr.r*S*0.1, 0, Math.PI*2);
      c.fillStyle = 'rgba(200,200,200,0.5)';
      c.fill();
    });

    return new THREE.CanvasTexture(cv);
  }
}
