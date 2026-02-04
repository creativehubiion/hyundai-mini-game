import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/**
 * Hyundai N Mini Game - Procedural Road Generation
 * Socket-based road piece connection system.
 */

// Road generation constants
const GRID_CELL_SIZE = 2;           // 2m grid cells for collision
const MAX_SAME_DIR_CURVES = 2;      // Max consecutive same-direction curves
const MIN_STRAIGHTS_AFTER_CURVE = 1; // Force straights after curve

class AssetViewer {
  constructor() {
    this.container = document.getElementById('game-container');
    this.loadingScreen = document.getElementById('loading-screen');

    // Core Three.js
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Loaders
    this.gltfLoader = null;
    this.dracoLoader = null;
    this.textureLoader = null;
    this.rgbeLoader = null;

    // Asset management
    this.loadedAssets = [];
    this.textureCache = new Map();
    this.masterRoadMaterial = null;

    // Road generation state
    this.roadPieces = [];           // Spawned road instances
    this.occupiedCells = new Set(); // Grid cells occupied by road
    this.lastCurveDir = 0;          // -1 left, 0 none, 1 right
    this.sameDirCount = 0;          // Consecutive same-direction curves
    this.straightsSinceCurve = 99;  // Straights placed since last curve

    // Infinite road state
    this.activeSegments = [];       // Active road segments with buildings
    this.spawnAheadDistance = 100;  // Spawn new segment when car is within this distance
    this.despawnBehindDistance = 10; // Remove segments this far behind car (aggressive cleanup)
    this.infiniteRoadEnabled = true;

    // Helpers
    this.gridHelper = null;
    this.axesHelper = null;

    // Car following state
    this.car = null;
    this.carSpeed = 5; // units per second
    this.currentSegmentIndex = 0;
    this.currentPathT = 0; // 0-1 progress along current segment path
    this.segmentPaths = []; // Array of CatmullRomCurve3 for each road piece
    this.isCarMoving = false;
    this.lastFrameTime = 0;
    this.debugPaths = false;
    this.carTargetQuaternion = new THREE.Quaternion(); // For smooth car rotation

    // Chase camera state
    this.chaseCamEnabled = true;
    this.chaseCamOffset = new THREE.Vector3(0, 3, -5); // Behind and above car
    this.chaseCamLookAhead = 1.5; // Look at point ahead of car
    this.chaseCamSmoothSpeed = 4; // Elastic follow speed
    this.chaseCamRotationSmooth = 3; // Rotation smoothing
    this.currentCamPos = new THREE.Vector3();
    this.currentCamLookAt = new THREE.Vector3();
    this.smoothedTangent = new THREE.Vector3(0, 0, -1); // Smoothed direction for camera

    // Building generation state
    this.buildingTemplates = [];  // Loaded building templates with metadata
    this.spawnedBuildings = [];   // All spawned building instances
    this.cursorOverflowL = 0;     // Overflow from previous segment (left side)
    this.cursorOverflowR = 0;     // Overflow from previous segment (right side)
  }

  async init() {
    this.setupRenderer();
    this.setupScene();
    this.setupLoaders();
    this.setupLighting();
    this.setupControls();
    this.setupHelpers();

    // Load environment map
    try {
      const envMap = await this.loadHDR('/kloofendal_48d_partly_cloudy_puresky_1k.hdr');
      this.scene.environment = envMap;
      console.log('Environment map loaded');
    } catch (error) {
      console.warn('HDR environment not found, using default lighting');
    }

    // Hide loading screen
    this.hideLoadingScreen();

    // Start render loop
    this.animate();

    // Expose functions globally
    window.loadBuilding = (name, opts) => this.loadBuilding(name, opts);
    window.loadRoad = (name, opts) => this.loadRoad(name, opts);
    window.spawn = (name, x, z, rot) => this.spawn(name, x, z, rot);
    window.clear = () => this.clearAll();
    window.list = () => this.listAssets();
    window.toggleGrid = () => this.toggleGrid();

    // Road generation
    window.generateRoad = (count) => this.generateRoad(count);
    window.clearRoad = () => this.clearRoad();

    // Car controls
    window.startCar = () => this.startCar();
    window.stopCar = () => this.stopCar();
    window.setCarSpeed = (speed) => { this.carSpeed = speed; console.log(`Car speed: ${speed}`); };
    window.debugPaths = (on = true) => { this.debugPaths = on; console.log(`Debug paths: ${on}`); };
    window.showPaths = () => this.visualizeAllPaths();

    // Chase camera controls
    window.toggleChaseCamera = () => this.toggleChaseCamera();
    window.addCarAxes = () => this.addCarAxes();

    // Building generation controls
    window.generateBuildings = () => this.generateBuildings();
    window.clearBuildings = () => this.clearBuildings();

    // Infinite road controls
    window.initInfiniteRoad = (count) => this.initInfiniteRoad(count);
    window.toggleInfiniteRoad = () => {
      this.infiniteRoadEnabled = !this.infiniteRoadEnabled;
      console.log(`Infinite road: ${this.infiniteRoadEnabled ? 'ON' : 'OFF'}`);
    };

    // Load building facade templates for procedural generation
    await this.loadBuildingFacade('oldbuilding', {
      glbPath: '/Building%20Facade/OldBuildingfacadenomaterial.glb',
      lightMapPath: '/Building%20Facade/oldbuildingfacade_baked.webp',
      uvChannel: 1
    });

    await this.loadBuildingFacade('building148', {
      glbPath: '/Building%20Facade/building%20148/building148.glb',
      lightMapPath: '/Building%20Facade/building%20148/building148_bakedtexture.webp',
      uvChannel: 1
    });

    // Initialize infinite road system
    await this.initInfiniteRoad(5);

    // Start car
    await this.startCar();

    console.log('%c Infinite Procedural City Ready ', 'background: #0066cc; color: white; padding: 4px 8px; border-radius: 4px;');
    console.log('Keys: [C] Toggle Camera | [G] Toggle Grid | [Space] Pan');
    console.log('Commands:');
    console.log('  initInfiniteRoad(5)     - Reset infinite road with N initial segments');
    console.log('  toggleInfiniteRoad()    - Toggle infinite spawning on/off');
    console.log('  startCar() / stopCar()  - Control car movement');
    console.log('  setCarSpeed(15)         - Set car speed (units/sec)');
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = false;
    this.container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.onResize());
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 200, 600);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(50, 40, 50);
    this.camera.lookAt(0, 0, 0);
  }

  setupLoaders() {
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.dracoLoader.setDecoderConfig({ type: 'js' });

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.textureLoader = new THREE.TextureLoader();
    this.rgbeLoader = new RGBELoader();
  }

  setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(50, 100, 50);
    this.scene.add(sun);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x444422, 0.6);
    this.scene.add(hemi);
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 500;

    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE
    };

    // Spacebar to pan
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      }
      if (e.code === 'KeyG') this.toggleGrid();
      if (e.code === 'KeyC') this.toggleChaseCamera();
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      }
    });
  }

  setupHelpers() {
    this.gridHelper = new THREE.GridHelper(200, 200, 0xffffff, 0xffffff);
    this.gridHelper.material.opacity = 0.15;
    this.gridHelper.material.transparent = true;
    this.scene.add(this.gridHelper);

    // Large axes helper at origin
    // Red = +X, Green = +Y, Blue = +Z
    this.axesHelper = new THREE.AxesHelper(10);
    this.scene.add(this.axesHelper);

    // Add axis labels
    console.log('%c Three.js Axes: RED = +X | GREEN = +Y | BLUE = +Z ', 'background: #333; color: #fff; padding: 4px;');
  }

  /**
   * Add axes helper to car for debugging
   */
  addCarAxes() {
    if (this.car) {
      const carAxes = new THREE.AxesHelper(3);
      this.car.add(carAxes);
      console.log('Car axes added: RED = +X | GREEN = +Y | BLUE = +Z');
    }
  }

  loadHDR(path) {
    return new Promise((resolve, reject) => {
      this.rgbeLoader.load(path, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        resolve(texture);
      }, undefined, reject);
    });
  }

  async loadTexture(path, options = {}) {
    if (this.textureCache.has(path)) {
      return this.textureCache.get(path);
    }
    return new Promise((resolve, reject) => {
      this.textureLoader.load(path, (texture) => {
        if (options.colorSpace === 'srgb') texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = options.flipY ?? false;
        texture.needsUpdate = true;
        this.textureCache.set(path, texture);
        resolve(texture);
      }, undefined, reject);
    });
  }

  /**
   * Load PBR textures and create shared road material
   */
  async loadRoadMaterial() {
    if (this.masterRoadMaterial) return this.masterRoadMaterial;

    console.log('Loading road PBR textures...');
    const basePath = '/Road%20Pack/Textures%20compressed/WebP%20Normal+AO/initialShadingGroup_';

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    const configureTexture = (tex, isSRGB = false) => {
      tex.flipY = false;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = maxAniso;
      tex.generateMipmaps = true;
      if (isSRGB) tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    };

    try {
      const [baseColor, normal, roughness, metallic, ao, height] = await Promise.all([
        this.loadTexture(basePath + 'Base_Color.webp'),
        this.loadTexture(basePath + 'Normal_DirectX.webp'),
        this.loadTexture(basePath + 'Roughness.webp'),
        this.loadTexture(basePath + 'Metallic.webp'),
        this.loadTexture(basePath + 'Mixed_AO.webp'),
        this.loadTexture(basePath + 'Height.webp')
      ]);

      configureTexture(baseColor, true);
      configureTexture(normal);
      configureTexture(roughness);
      configureTexture(metallic);
      configureTexture(ao);
      configureTexture(height);

      this.masterRoadMaterial = new THREE.MeshStandardMaterial({
        map: baseColor,
        normalMap: normal,
        roughnessMap: roughness,
        metalnessMap: metallic,
        aoMap: ao,
        displacementMap: height,
        displacementScale: 0,
        envMap: this.scene.environment,
        envMapIntensity: 0.5
      });

      console.log('Road material created with PBR textures');
      return this.masterRoadMaterial;
    } catch (error) {
      console.error('Failed to load road textures:', error);
      this.masterRoadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
      return this.masterRoadMaterial;
    }
  }

  /**
   * Load building with baked texture
   * @param {string} name - Asset name for reference
   * @param {Object} options - glbPath, lightMapPath, uvChannel (0 or 1)
   */
  async loadBuilding(name, options = {}) {
    const glbPath = options.glbPath || `/Env%20Assets/${name}.glb`;
    const lightMapPath = options.lightMapPath || `/Env%20Assets/Baked%20Textures/lightmapUV_${name}.webp`;
    const uvChannel = options.uvChannel ?? 1;  // Default to UV1, but can use UV0

    console.log(`Loading building: ${name}`);
    console.log(`  GLB: ${glbPath}`);
    console.log(`  Texture: ${lightMapPath} (UV${uvChannel})`);

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(glbPath, resolve, undefined, reject);
      });

      const model = gltf.scene;

      // Load baked texture with high quality filtering
      let combinedMap = null;
      try {
        combinedMap = await this.loadTexture(lightMapPath, { colorSpace: 'srgb' });
        combinedMap.channel = uvChannel;

        // High quality texture settings
        combinedMap.minFilter = THREE.LinearMipmapLinearFilter;
        combinedMap.magFilter = THREE.LinearFilter;
        combinedMap.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        combinedMap.generateMipmaps = true;
        combinedMap.needsUpdate = true;

        console.log(`  Texture loaded: ${combinedMap.image.width}x${combinedMap.image.height}, channel=${uvChannel}, anisotropy=${combinedMap.anisotropy}`);
      } catch (e) {
        console.warn(`Texture not found: ${lightMapPath}`);
      }

      // Apply materials
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;

          const geom = child.geometry;

          // Fix non-standard UV naming: copy uv1 to uv2 if needed
          if (geom.attributes.uv1 && !geom.attributes.uv2) {
            geom.setAttribute('uv2', geom.attributes.uv1);
          }

          // Check material name
          const origMat = child.material;
          const matName = origMat?.name || '';

          // Glass detection - specific material name
          const isGlass = matName.includes('GlassCyanC');

          if (isGlass && this.scene.environment) {
            // Glass with reflections
            child.material = new THREE.MeshStandardMaterial({
              color: 0x88ccee,
              metalness: 0.95,
              roughness: 0.05,
              envMap: this.scene.environment,
              envMapIntensity: 1.0
            });
          } else if (combinedMap) {
            // Baked texture
            child.material = new THREE.MeshBasicMaterial({ map: combinedMap });
          }
        }
      });

      // Store as template
      model.visible = false;
      this.scene.add(model);
      this.loadedAssets.push({ name, template: model, instances: [] });

      console.log(`Building loaded: ${name}`);
      return model;
    } catch (error) {
      console.error(`Failed to load building: ${name}`, error);
      return null;
    }
  }

  /**
   * Load road with shared PBR material
   */
  async loadRoad(name, options = {}) {
    const glbPath = options.glbPath || `/Road%20Pack/Road%20Pieces/${name}.glb`;

    console.log(`Loading road: ${name}`);

    // Ensure master road material is loaded
    await this.loadRoadMaterial();

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(glbPath, resolve, undefined, reject);
      });

      const model = gltf.scene;

      // Inject shared road material into all meshes
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          child.material = this.masterRoadMaterial;
        }
      });

      // Store as template
      model.visible = false;
      this.scene.add(model);
      this.loadedAssets.push({ name, template: model, instances: [] });

      // Get size for reference
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      console.log(`Road loaded: ${name} (${size.x.toFixed(1)} x ${size.z.toFixed(1)})`);

      return model;
    } catch (error) {
      console.error(`Failed to load road: ${name}`, error);
      return null;
    }
  }

  /**
   * Spawn an asset at position
   */
  spawn(name, x = 0, z = 0, rotation = 0) {
    const asset = this.loadedAssets.find(a => a.name === name);
    if (!asset) {
      console.error(`Asset not loaded: ${name}`);
      return null;
    }

    const instance = asset.template.clone(true);
    instance.visible = true;
    instance.traverse((child) => { child.visible = true; });

    instance.position.set(x, 0, z);
    instance.rotation.y = (rotation % 4) * (Math.PI / 2);

    this.scene.add(instance);
    asset.instances.push(instance);

    return instance;
  }

  listAssets() {
    console.log('Loaded assets:');
    this.loadedAssets.forEach(a => console.log(`  ${a.name} (${a.instances.length} instances)`));
  }

  clearAll() {
    this.loadedAssets.forEach(asset => {
      asset.instances.forEach(inst => {
        this.scene.remove(inst);
      });
      asset.instances = [];
      this.scene.remove(asset.template);
    });
    this.loadedAssets = [];
    console.log('Cleared all assets');
  }

  toggleGrid() {
    this.gridHelper.visible = !this.gridHelper.visible;
  }

  // ============================================
  // PROCEDURAL ROAD GENERATION
  // ============================================

  /**
   * Find socket_out object in a model
   */
  findSocketOut(model) {
    let socket = null;
    model.traverse((child) => {
      if (child.name.toLowerCase().includes('socket_out') || child.name.toLowerCase().includes('socket')) {
        socket = child;
      }
    });
    return socket;
  }

  /**
   * Get world transform of socket_out
   */
  getSocketTransform(piece) {
    const socket = this.findSocketOut(piece);
    if (!socket) {
      console.warn('No socket_out found in piece');
      return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    }

    socket.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    socket.getWorldPosition(position);
    socket.getWorldQuaternion(quaternion);

    return { position, quaternion };
  }

  /**
   * Convert world position to grid cell key
   */
  cellKey(x, z) {
    const gx = Math.round(x / GRID_CELL_SIZE);
    const gz = Math.round(z / GRID_CELL_SIZE);
    return `${gx},${gz}`;
  }

  /**
   * Sample points along road piece centerline
   */
  sampleRoadCells(piece) {
    const cells = [];
    const socket = this.findSocketOut(piece);
    if (!socket) return cells;

    // Get start (origin) and end (socket) positions
    const start = new THREE.Vector3();
    piece.getWorldPosition(start);

    socket.updateMatrixWorld(true);
    const end = new THREE.Vector3();
    socket.getWorldPosition(end);

    // Sample every 1m along the line
    const distance = start.distanceTo(end);
    const steps = Math.max(1, Math.ceil(distance));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      cells.push(this.cellKey(x, z));
    }

    return cells;
  }

  /**
   * Check if road piece would collide with existing road
   */
  checkCollision(cells, recentCells = new Set()) {
    for (const cell of cells) {
      if (this.occupiedCells.has(cell) && !recentCells.has(cell)) {
        return true; // Collision
      }
    }
    return false;
  }

  /**
   * Try to spawn a road piece, returns instance if successful
   */
  trySpawnRoad(name, mirror = false, previousPiece = null) {
    const asset = this.loadedAssets.find(a => a.name === name);
    if (!asset) {
      console.warn(`Road not loaded: ${name}`);
      return null;
    }

    // Clone the template
    const instance = asset.template.clone(true);
    instance.visible = true;
    instance.traverse((child) => { child.visible = true; });

    // Apply mirror if needed (before positioning)
    if (mirror) {
      instance.scale.set(-1, 1, 1);
    }

    // Position the piece
    if (!previousPiece) {
      // First piece at origin
      instance.position.set(0, 0, 0);
      instance.quaternion.identity();
    } else {
      // Snap to previous piece's socket_out
      const { position, quaternion } = this.getSocketTransform(previousPiece);
      instance.position.copy(position);
      instance.quaternion.copy(quaternion);
    }

    // Update matrices for collision check
    instance.updateMatrixWorld(true);

    // Get cells this piece would occupy
    const cells = this.sampleRoadCells(instance);

    // Build recent cells set (last 2 pieces for seam tolerance)
    const recentCells = new Set();
    const recentCount = Math.min(2, this.roadPieces.length);
    for (let i = this.roadPieces.length - recentCount; i < this.roadPieces.length; i++) {
      if (i >= 0) {
        const recentPieceCells = this.sampleRoadCells(this.roadPieces[i]);
        recentPieceCells.forEach(c => recentCells.add(c));
      }
    }

    // Check collision
    if (this.checkCollision(cells, recentCells)) {
      // Collision - discard this piece
      return null;
    }

    // Success - add to scene and mark cells
    this.scene.add(instance);
    asset.instances.push(instance);
    this.roadPieces.push(instance);
    cells.forEach(c => this.occupiedCells.add(c));

    return instance;
  }

  /**
   * Build candidate list based on direction rules
   */
  buildCandidates() {
    const candidates = [];

    // Straights only for now (curves disabled until curved buildings are ready)
    candidates.push({ name: 'road_long', type: 'straight', mirror: false });
    candidates.push({ name: 'road_short', type: 'straight', mirror: false });

    return candidates;
  }

  /**
   * Shuffle array in place
   */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Update direction tracking after placing a piece
   */
  updateDirectionTracking(type, dir = 0) {
    if (type === 'straight') {
      this.straightsSinceCurve++;
    } else if (type === 'curve') {
      if (dir === this.lastCurveDir) {
        this.sameDirCount++;
      } else {
        this.sameDirCount = 1;
        this.lastCurveDir = dir;
      }
      this.straightsSinceCurve = 0;
    }
  }

  /**
   * Generate procedural road
   */
  async generateRoad(targetCount = 20) {
    console.log(`Generating road with ${targetCount} pieces...`);

    // Load road pieces if not loaded (straights only for now)
    const roadNames = [
      'road_long',
      'road_short'
    ];

    for (const name of roadNames) {
      if (!this.loadedAssets.find(a => a.name === name)) {
        await this.loadRoad(name);
      }
    }

    // Reset generation state
    this.clearRoad();

    // Generate pieces
    for (let i = 0; i < targetCount; i++) {
      const previousPiece = this.roadPieces.length > 0
        ? this.roadPieces[this.roadPieces.length - 1]
        : null;

      // Build and shuffle candidates
      const candidates = this.shuffle(this.buildCandidates());

      let placed = false;
      for (const candidate of candidates) {
        const instance = this.trySpawnRoad(candidate.name, candidate.mirror, previousPiece);
        if (instance) {
          this.updateDirectionTracking(candidate.type, candidate.dir || 0);
          placed = true;
          break;
        }
      }

      if (!placed) {
        console.warn(`Could not place piece ${i + 1}, stopping generation`);
        break;
      }
    }

    console.log(`Road generated: ${this.roadPieces.length} pieces`);

    // Build paths and start car automatically
    this.buildSegmentPaths();
    this.startCar();

    // Auto-generate buildings if templates are loaded
    if (this.buildingTemplates.length > 0) {
      this.generateBuildings();
    }
  }

  /**
   * Clear road pieces only
   */
  clearRoad() {
    this.roadPieces.forEach(piece => {
      this.scene.remove(piece);
    });
    this.roadPieces = [];
    this.segmentPaths = [];
    this.occupiedCells.clear();
    this.lastCurveDir = 0;
    this.sameDirCount = 0;
    this.straightsSinceCurve = 99;
    this.currentSegmentIndex = 0;
    this.currentPathT = 0;
    // Also clear buildings when road is cleared
    this.clearBuildings();
    // Clear active segments
    this.activeSegments.forEach(seg => {
      this.disposeSegment(seg);
    });
    this.activeSegments = [];
    console.log('Road cleared');
  }

  // ============================================
  // INFINITE ROAD SYSTEM
  // ============================================

  /**
   * Initialize infinite road with starting segments
   */
  async initInfiniteRoad(initialCount = 5) {
    console.log('Initializing infinite road...');

    // Clear any existing road
    this.clearRoad();

    // Load road pieces if not loaded
    const roadNames = ['road_long', 'road_short'];
    for (const name of roadNames) {
      if (!this.loadedAssets.find(a => a.name === name)) {
        await this.loadRoad(name);
      }
    }

    // Spawn initial segments
    for (let i = 0; i < initialCount; i++) {
      this.spawnNextSegment();
    }

    // Build paths for car
    this.buildSegmentPaths();

    console.log(`Infinite road initialized with ${this.activeSegments.length} segments`);
  }

  /**
   * Spawn a single road segment at the end of the road
   */
  spawnNextSegment() {
    // Pick random straight road piece
    const roadNames = ['road_long', 'road_short'];
    const randomName = roadNames[Math.floor(Math.random() * roadNames.length)];

    const asset = this.loadedAssets.find(a => a.name === randomName);
    if (!asset) {
      console.warn(`Road not loaded: ${randomName}`);
      return null;
    }

    // Clone the template
    const roadInstance = asset.template.clone(true);
    roadInstance.visible = true;
    roadInstance.traverse((child) => { child.visible = true; });

    // Position: snap to previous segment's socket_out or start at origin
    const previousSegment = this.activeSegments[this.activeSegments.length - 1];
    if (previousSegment) {
      const { position, quaternion } = this.getSocketTransform(previousSegment.road);
      roadInstance.position.copy(position);
      roadInstance.quaternion.copy(quaternion);
    } else {
      roadInstance.position.set(0, 0, 0);
      roadInstance.quaternion.identity();
    }

    roadInstance.updateMatrixWorld(true);
    this.scene.add(roadInstance);

    // Create segment object
    const segment = {
      road: roadInstance,
      buildings: [],
      path: null
    };

    // Generate buildings for this segment (as children)
    this.spawnBuildingsForSegment(segment);

    // Extract car path for this segment
    segment.path = this.extractCarPath(roadInstance);

    // Add to tracking arrays
    this.activeSegments.push(segment);
    this.roadPieces.push(roadInstance);
    this.segmentPaths.push(segment.path);

    return segment;
  }

  /**
   * Spawn buildings for a single road segment
   */
  spawnBuildingsForSegment(segment) {
    if (this.buildingTemplates.length === 0) return;

    const roadPiece = segment.road;

    // Find path markers
    const markers = this.findPathMarkers(roadPiece);

    // Get transforms for left and right paths
    const pathLStart = this.getMarkerTransform(markers.pathL.start);
    const pathLEnd = this.getMarkerTransform(markers.pathL.end);
    const pathRStart = this.getMarkerTransform(markers.pathR.start);
    const pathREnd = this.getMarkerTransform(markers.pathR.end);

    // Spawn buildings on left side
    if (pathLStart && pathLEnd) {
      const buildings = this.spawnBuildingsAlongPathForSegment(pathLStart, pathLEnd);
      segment.buildings.push(...buildings);
    }

    // Spawn buildings on right side
    if (pathRStart && pathREnd) {
      const buildings = this.spawnBuildingsAlongPathForSegment(pathRStart, pathREnd);
      segment.buildings.push(...buildings);
    }
  }

  /**
   * Spawn buildings along a path, randomly picking from building pool
   */
  spawnBuildingsAlongPathForSegment(pathStart, pathEnd) {
    const buildings = [];

    if (!pathStart || !pathEnd) return buildings;

    const pathDir = new THREE.Vector3().subVectors(pathEnd.position, pathStart.position);
    const pathLength = pathDir.length();
    pathDir.normalize();

    const markerQuaternion = pathStart.quaternion;
    let cursorDistance = 0;

    while (cursorDistance < pathLength) {
      // Pick random building from pool
      const template = this.buildingTemplates[Math.floor(Math.random() * this.buildingTemplates.length)];
      const buildingWidth = template.width;

      // Calculate cursor world position
      const cursorPos = new THREE.Vector3()
        .copy(pathStart.position)
        .addScaledVector(pathDir, cursorDistance);

      // Clone and setup building
      const instance = template.model.clone(true);
      instance.visible = true;
      instance.traverse((child) => { child.visible = true; });
      instance.position.copy(cursorPos);
      instance.quaternion.copy(markerQuaternion);

      // Add to scene (not parented for now, but tracked with segment)
      this.scene.add(instance);
      buildings.push(instance);

      // Advance cursor
      const padding = 0.01 + Math.random() * 0.09;
      cursorDistance += buildingWidth + padding;
    }

    return buildings;
  }

  /**
   * Get distance from car to the end of the last segment
   */
  getDistanceToRoadEnd() {
    if (!this.car || this.activeSegments.length === 0) return Infinity;

    const lastSegment = this.activeSegments[this.activeSegments.length - 1];
    const { position } = this.getSocketTransform(lastSegment.road);

    return this.car.position.distanceTo(position);
  }

  /**
   * Check and spawn new segments ahead of car
   */
  updateInfiniteRoadSpawning() {
    if (!this.infiniteRoadEnabled || !this.car) return;

    const distanceToEnd = this.getDistanceToRoadEnd();

    if (distanceToEnd < this.spawnAheadDistance) {
      const newSegment = this.spawnNextSegment();
      if (newSegment) {
        console.log(`Spawned new segment, total: ${this.activeSegments.length}`);
      }
    }
  }

  /**
   * Remove old segments behind the car (The Reaper)
   */
  updateInfiniteRoadCleanup() {
    if (!this.infiniteRoadEnabled || !this.car) return;
    if (this.activeSegments.length <= 3) return; // Keep minimum segments

    const oldestSegment = this.activeSegments[0];
    if (!oldestSegment) return;

    // Get segment position
    const segmentPos = new THREE.Vector3();
    oldestSegment.road.getWorldPosition(segmentPos);

    // Check if car has passed this segment by enough distance
    // Using Z since road goes along -Z axis
    const distanceBehind = this.car.position.distanceTo(segmentPos);

    // Only remove if segment is behind the car and far enough
    if (distanceBehind > this.despawnBehindDistance) {
      // Check if the car's segment index is past this one
      if (this.currentSegmentIndex > 0) {
        this.removeOldestSegment();
      }
    }
  }

  /**
   * Remove the oldest segment and clean up its resources
   */
  removeOldestSegment() {
    const segment = this.activeSegments.shift();
    if (!segment) return;

    // Remove from roadPieces and segmentPaths arrays
    const roadIndex = this.roadPieces.indexOf(segment.road);
    if (roadIndex !== -1) {
      this.roadPieces.splice(roadIndex, 1);
      this.segmentPaths.splice(roadIndex, 1);
      // Adjust car's segment index
      this.currentSegmentIndex = Math.max(0, this.currentSegmentIndex - 1);
    }

    // Dispose the segment
    this.disposeSegment(segment);

    console.log(`Removed oldest segment, remaining: ${this.activeSegments.length}`);
  }

  /**
   * Dispose a segment and all its resources
   */
  disposeSegment(segment) {
    // Remove and dispose buildings
    segment.buildings.forEach(building => {
      this.scene.remove(building);
      building.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    });

    // Remove and dispose road
    this.scene.remove(segment.road);
    segment.road.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        // Don't dispose shared road material
      }
    });
  }

  // ============================================
  // CAR PATH FOLLOWING
  // ============================================

  /**
   * Generate car path procedurally based on road type
   * Straight roads: line from origin to socket
   * Curved roads: arc from origin to socket
   */
  extractCarPath(roadPiece) {
    // Get road origin
    const origin = new THREE.Vector3();
    roadPiece.getWorldPosition(origin);

    // Get socket_out position and direction
    const socket = this.findSocketOut(roadPiece);
    if (!socket) {
      console.warn('No socket_out found');
      return this.createFallbackPath(roadPiece);
    }

    socket.updateMatrixWorld(true);
    const socketPos = new THREE.Vector3();
    socket.getWorldPosition(socketPos);

    // Determine if this is a curve by checking if socket is rotated
    const socketQuat = new THREE.Quaternion();
    socket.getWorldQuaternion(socketQuat);

    const roadQuat = new THREE.Quaternion();
    roadPiece.getWorldQuaternion(roadQuat);

    // Get angle difference between road and socket
    const invRoadQuat = roadQuat.clone().invert();
    const relativeQuat = socketQuat.clone().multiply(invRoadQuat);
    const euler = new THREE.Euler().setFromQuaternion(relativeQuat);
    const turnAngle = euler.y;

    // Lift path slightly off ground
    const pathHeight = 0.1;
    origin.y = pathHeight;
    socketPos.y = pathHeight;

    const points = [];
    const numPoints = 12;

    if (Math.abs(turnAngle) < 0.1) {
      // Straight road - simple line
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const point = new THREE.Vector3().lerpVectors(origin, socketPos, t);
        points.push(point);
      }
      console.log(`Straight path: ${points.length} points`);
    } else {
      // Curved road - generate arc
      // Calculate arc center and radius
      const midpoint = new THREE.Vector3().lerpVectors(origin, socketPos, 0.5);
      const chord = origin.distanceTo(socketPos);
      const radius = chord / (2 * Math.sin(Math.abs(turnAngle) / 2));

      // Direction from origin to socket
      const chordDir = new THREE.Vector3().subVectors(socketPos, origin).normalize();

      // Perpendicular direction (toward arc center)
      const perpDir = new THREE.Vector3(-chordDir.z, 0, chordDir.x);
      if (turnAngle > 0) perpDir.negate();

      // Arc center
      const sagitta = radius - Math.sqrt(radius * radius - (chord / 2) * (chord / 2));
      const center = midpoint.clone().add(perpDir.clone().multiplyScalar(radius - sagitta));
      center.y = pathHeight;

      // Generate arc points
      const startAngle = Math.atan2(origin.z - center.z, origin.x - center.x);

      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const angle = startAngle - turnAngle * t;
        const point = new THREE.Vector3(
          center.x + radius * Math.cos(angle),
          pathHeight,
          center.z + radius * Math.sin(angle)
        );
        points.push(point);
      }
      console.log(`Curved path (${(turnAngle * 180 / Math.PI).toFixed(1)}°): ${points.length} points`);
    }

    // Create smooth centripetal CatmullRom spline
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    return curve;
  }

  /**
   * Create fallback path from origin to socket_out
   */
  createFallbackPath(roadPiece) {
    const start = new THREE.Vector3();
    roadPiece.getWorldPosition(start);

    const socket = this.findSocketOut(roadPiece);
    const end = new THREE.Vector3();
    if (socket) {
      socket.updateMatrixWorld(true);
      socket.getWorldPosition(end);
    } else {
      end.copy(start).add(new THREE.Vector3(0, 0, 10));
    }

    // Create a simple 2-point curve
    return new THREE.CatmullRomCurve3([start, end], false, 'catmullrom', 0.5);
  }

  /**
   * Build path curves for all road segments
   */
  buildSegmentPaths() {
    this.segmentPaths = [];
    for (const piece of this.roadPieces) {
      const curve = this.extractCarPath(piece);
      this.segmentPaths.push(curve);
    }
    console.log(`Built ${this.segmentPaths.length} segment paths`);
  }

  /**
   * Visualize all car paths as lines
   */
  visualizeAllPaths() {
    // Remove old visualization
    this.scene.children
      .filter(c => c.userData.isPathViz)
      .forEach(c => this.scene.remove(c));

    for (const curve of this.segmentPaths) {
      const points = curve.getPoints(50);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 2 });
      const line = new THREE.Line(geometry, material);
      line.userData.isPathViz = true;
      this.scene.add(line);
    }
    console.log('Paths visualized (magenta lines)');
  }

  /**
   * Create car - placeholder box
   */
  async createCar() {
    if (this.car) {
      this.scene.remove(this.car);
    }

    const carGroup = new THREE.Group();

    // Main body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.15, 0.75),
      new THREE.MeshStandardMaterial({ color: 0x2233ff, metalness: 0.6, roughness: 0.4 })
    );
    body.position.y = 0.1;
    carGroup.add(body);

    // Roof section
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.1, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x2233ff, metalness: 0.6, roughness: 0.4 })
    );
    roof.position.set(0, 0.225, -0.05);
    carGroup.add(roof);

    this.car = carGroup;
    this.scene.add(this.car);

    console.log('Placeholder car created');
    return this.car;
  }

  /**
   * Start car movement
   */
  async startCar() {
    if (this.segmentPaths.length === 0) {
      this.buildSegmentPaths();
    }

    if (!this.car) {
      await this.createCar();
    }

    this.currentSegmentIndex = 0;
    this.currentPathT = 0;
    this.isCarMoving = true;
    this.updateCarPosition();

    // Setup chase camera
    if (this.chaseCamEnabled) {
      this.controls.enabled = false;
      this.setupChaseCamera();
    }

    console.log('Car started');
  }

  /**
   * Stop car movement
   */
  stopCar() {
    this.isCarMoving = false;
    console.log('Car stopped');
  }

  /**
   * Update car position along path
   */
  updateCarPosition() {
    if (!this.car || this.segmentPaths.length === 0) return;

    const currentPath = this.segmentPaths[this.currentSegmentIndex];
    if (!currentPath) return;

    // Get position on curve
    const targetPosition = currentPath.getPointAt(this.currentPathT);

    // Smooth car position
    this.car.position.lerp(targetPosition, 0.15);

    // Get tangent for orientation
    const tangent = currentPath.getTangentAt(this.currentPathT);

    // Calculate target rotation using a dummy object
    const lookTarget = targetPosition.clone().add(tangent);
    const tempObj = new THREE.Object3D();
    tempObj.position.copy(targetPosition);
    tempObj.lookAt(lookTarget);
    this.carTargetQuaternion.copy(tempObj.quaternion);

    // Smoothly interpolate car rotation
    this.car.quaternion.slerp(this.carTargetQuaternion, 0.08);
  }

  /**
   * Advance car along path (called each frame)
   */
  updateCar(deltaTime) {
    if (!this.isCarMoving || this.segmentPaths.length === 0) return;

    const currentPath = this.segmentPaths[this.currentSegmentIndex];
    if (!currentPath) return;

    // Calculate progress increment based on speed and path length
    const pathLength = currentPath.getLength();
    const progressPerSecond = this.carSpeed / pathLength;
    this.currentPathT += progressPerSecond * deltaTime;

    // Check if we've reached the end of current segment
    if (this.currentPathT >= 1) {
      this.currentPathT = 0;
      this.currentSegmentIndex++;

      // Loop back to start or stop at end
      if (this.currentSegmentIndex >= this.segmentPaths.length) {
        this.currentSegmentIndex = 0; // Loop
        console.log('Car looped to start');
      }
    }

    this.updateCarPosition();

    // Update chase camera
    if (this.chaseCamEnabled) {
      this.updateChaseCamera();
    }
  }

  /**
   * Setup chase camera - initialize position immediately behind car
   */
  setupChaseCamera() {
    if (!this.car) return;

    // Lock up vector to prevent flipping
    this.camera.up.set(0, 1, 0);

    // Get direction of travel from path tangent
    const currentPath = this.segmentPaths[this.currentSegmentIndex];
    if (!currentPath) return;

    const tangent = currentPath.getTangentAt(this.currentPathT);
    tangent.y = 0; // Keep horizontal
    tangent.normalize();

    // Position camera behind car (opposite of travel direction)
    const cameraDistance = 1.5;
    const cameraHeight = 0.5;

    this.camera.position
      .copy(this.car.position)
      .addScaledVector(tangent, -cameraDistance)
      .add(new THREE.Vector3(0, cameraHeight, 0));

    // Look ahead of car
    const lookAhead = new THREE.Vector3()
      .copy(this.car.position)
      .addScaledVector(tangent, 3);
    this.camera.lookAt(lookAhead.x, 0.1, lookAhead.z);

    console.log('Chase camera enabled - positioned behind car');
  }

  /**
   * Update chase camera - follows behind car using path tangent
   */
  updateChaseCamera() {
    if (!this.car) return;

    // Get direction of travel from path tangent
    const currentPath = this.segmentPaths[this.currentSegmentIndex];
    if (!currentPath) return;

    const tangent = currentPath.getTangentAt(this.currentPathT);
    tangent.y = 0; // Keep horizontal
    tangent.normalize();

    // Smooth the tangent to reduce jitter at segment transitions
    this.smoothedTangent.lerp(tangent, 0.1);
    this.smoothedTangent.normalize();

    // Camera position: behind the car (opposite of travel direction) and above
    const cameraDistance = 1.5;
    const cameraHeight = 0.5;

    const targetCamPos = new THREE.Vector3()
      .copy(this.car.position)
      .addScaledVector(this.smoothedTangent, -cameraDistance) // Behind car
      .add(new THREE.Vector3(0, cameraHeight, 0));  // Above

    // Smooth camera position (elastic follow)
    this.camera.position.lerp(targetCamPos, 0.3);

    // Look ahead of car for better chase feel
    const lookAhead = new THREE.Vector3()
      .copy(this.car.position)
      .addScaledVector(this.smoothedTangent, 3); // Look 3 units ahead
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(lookAhead.x, 0.1, lookAhead.z);
  }

  /**
   * Detach camera from car
   */
  detachChaseCamera() {
    this.camera.position.set(50, 40, 50);
    this.camera.lookAt(0, 0, 0);
    console.log('Chase camera detached');
  }

  /**
   * Toggle chase camera on/off
   */
  toggleChaseCamera() {
    this.chaseCamEnabled = !this.chaseCamEnabled;

    // Disable orbit controls when chase cam is active
    this.controls.enabled = !this.chaseCamEnabled;

    if (!this.chaseCamEnabled) {
      // Detach camera and reset to orbit controls view
      this.detachChaseCamera();
      this.controls.update();
    } else if (this.car) {
      // Parent camera to car
      this.setupChaseCamera();
    }
    console.log(`Chase camera: ${this.chaseCamEnabled ? 'ON' : 'OFF'}`);
  }

  // ============================================
  // PROCEDURAL BUILDING GENERATION
  // ============================================

  /**
   * Load a building facade for the building pool
   */
  async loadBuildingFacade(name, options = {}) {
    const glbPath = options.glbPath;
    const lightMapPath = options.lightMapPath;
    const uvChannel = options.uvChannel ?? 1;

    console.log(`Loading building facade: ${name}`);

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(glbPath, resolve, undefined, reject);
      });

      const model = gltf.scene;

      // Load baked texture
      let combinedMap = null;
      if (lightMapPath) {
        try {
          combinedMap = await this.loadTexture(lightMapPath, { colorSpace: 'srgb' });
          combinedMap.channel = uvChannel;
          combinedMap.minFilter = THREE.LinearMipmapLinearFilter;
          combinedMap.magFilter = THREE.LinearFilter;
          combinedMap.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          combinedMap.generateMipmaps = true;
          combinedMap.needsUpdate = true;
        } catch (e) {
          console.warn(`Texture not found: ${lightMapPath}`);
        }
      }

      // Apply materials
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;

          const geom = child.geometry;

          // If using UV1 for baked texture, copy uv1 to main uv attribute
          if (uvChannel === 1 && geom.attributes.uv1) {
            geom.setAttribute('uv', geom.attributes.uv1);
          }

          if (combinedMap) {
            child.material = new THREE.MeshBasicMaterial({ map: combinedMap });
          }
        }
      });

      // Calculate building dimensions
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());

      // Store template with metadata
      model.visible = false;
      this.scene.add(model);

      const template = {
        name,
        model,
        width: size.x,   // Width along X axis
        height: size.y,  // Height along Y axis
        depth: size.z    // Depth along Z axis (front to back)
      };

      this.buildingTemplates.push(template);
      console.log(`Building facade loaded: ${name} (W:${size.x.toFixed(2)} H:${size.y.toFixed(2)} D:${size.z.toFixed(2)})`);

      return template;
    } catch (error) {
      console.error(`Failed to load building facade: ${name}`, error);
      return null;
    }
  }

  /**
   * Find path markers in a road piece
   * Returns { pathL: {start, end}, pathR: {start, end} }
   */
  findPathMarkers(roadPiece) {
    const markers = {
      pathL: { start: null, end: null },
      pathR: { start: null, end: null }
    };

    roadPiece.traverse((child) => {
      const name = child.name.toLowerCase();

      if (name.includes('path_l_start') || name.includes('pathl_start')) {
        markers.pathL.start = child;
      } else if (name.includes('path_l_end') || name.includes('pathl_end')) {
        markers.pathL.end = child;
      } else if (name.includes('path_r_start') || name.includes('pathr_start')) {
        markers.pathR.start = child;
      } else if (name.includes('path_r_end') || name.includes('pathr_end')) {
        markers.pathR.end = child;
      }
    });

    return markers;
  }

  /**
   * Get world position and quaternion from a marker
   */
  getMarkerTransform(marker) {
    if (!marker) return null;

    marker.updateMatrixWorld(true);

    const position = new THREE.Vector3();
    marker.getWorldPosition(position);

    const quaternion = new THREE.Quaternion();
    marker.getWorldQuaternion(quaternion);

    // Get the marker's local +Y as forward direction (for path walking)
    const forward = new THREE.Vector3(0, 1, 0);
    forward.applyQuaternion(quaternion);
    forward.y = 0;
    forward.normalize();

    return { position, quaternion, forward };
  }

  /**
   * Spawn a building instance at cursor position with proper rotation
   */
  spawnBuildingAtCursor(template, cursorPos, markerQuaternion) {
    const instance = template.model.clone(true);
    instance.visible = true;
    instance.traverse((child) => { child.visible = true; });

    // Position at cursor (bottom-front-left origin)
    instance.position.copy(cursorPos);

    // Rotate building so its local +Y aligns with marker's local +Y
    instance.quaternion.copy(markerQuaternion);

    this.scene.add(instance);
    this.spawnedBuildings.push(instance);

    return instance;
  }

  /**
   * Generate buildings along one side of a road segment using virtual cursor
   * @param {Object} pathStart - Start marker transform
   * @param {Object} pathEnd - End marker transform
   * @param {number} cursorOffset - Initial offset from previous segment overflow
   * @returns {number} - Overflow distance for next segment
   */
  generateBuildingsAlongPath(pathStart, pathEnd, cursorOffset = 0) {
    if (!pathStart || !pathEnd) return 0;

    // Calculate path direction and length
    const pathDir = new THREE.Vector3().subVectors(pathEnd.position, pathStart.position);
    const pathLength = pathDir.length();
    pathDir.normalize();

    // Use the start marker's quaternion for building rotation
    const markerQuaternion = pathStart.quaternion;

    // Virtual cursor starts at pathStart, offset by any overflow
    let cursorDistance = cursorOffset;

    while (cursorDistance < pathLength) {
      // Pick a random building from templates
      const template = this.buildingTemplates[Math.floor(Math.random() * this.buildingTemplates.length)];
      if (!template) break;

      const buildingWidth = template.width;

      // Check if building fits in remaining space
      // If not, it will "bridge" to next segment - we allow this

      // Calculate cursor world position
      const cursorPos = new THREE.Vector3()
        .copy(pathStart.position)
        .addScaledVector(pathDir, cursorDistance);

      // Spawn building with marker's quaternion
      this.spawnBuildingAtCursor(template, cursorPos, markerQuaternion);

      // Advance cursor by building width + random padding
      const padding = 0.01 + Math.random() * 0.09; // 0.01m to 0.1m
      cursorDistance += buildingWidth + padding;
    }

    // Return overflow for next segment
    const overflow = cursorDistance - pathLength;
    return overflow > 0 ? overflow : 0;
  }

  /**
   * Check if road piece is a straight (not curved)
   */
  isStraightRoad(roadPiece) {
    // Check socket rotation relative to road
    const socket = this.findSocketOut(roadPiece);
    if (!socket) return true;

    socket.updateMatrixWorld(true);
    const socketQuat = new THREE.Quaternion();
    socket.getWorldQuaternion(socketQuat);

    const roadQuat = new THREE.Quaternion();
    roadPiece.getWorldQuaternion(roadQuat);

    const invRoadQuat = roadQuat.clone().invert();
    const relativeQuat = socketQuat.clone().multiply(invRoadQuat);
    const euler = new THREE.Euler().setFromQuaternion(relativeQuat);

    // If turn angle is small, it's a straight
    return Math.abs(euler.y) < 0.1;
  }

  /**
   * Generate buildings for all road segments
   */
  generateBuildings() {
    console.log('Generating buildings...');

    // Clear existing buildings
    this.clearBuildings();

    // Reset overflow cursors
    this.cursorOverflowL = 0;
    this.cursorOverflowR = 0;

    let buildingCount = 0;

    for (const roadPiece of this.roadPieces) {
      // Skip curved roads for now
      if (!this.isStraightRoad(roadPiece)) {
        // Reset overflow at curves (no bridging across curves)
        this.cursorOverflowL = 0;
        this.cursorOverflowR = 0;
        continue;
      }

      // Find path markers
      const markers = this.findPathMarkers(roadPiece);

      // Get transforms for left path
      const pathLStart = this.getMarkerTransform(markers.pathL.start);
      const pathLEnd = this.getMarkerTransform(markers.pathL.end);

      // Get transforms for right path
      const pathRStart = this.getMarkerTransform(markers.pathR.start);
      const pathREnd = this.getMarkerTransform(markers.pathR.end);

      // Generate buildings on left side
      if (pathLStart && pathLEnd) {
        const beforeL = this.spawnedBuildings.length;
        this.cursorOverflowL = this.generateBuildingsAlongPath(pathLStart, pathLEnd, this.cursorOverflowL);
        buildingCount += this.spawnedBuildings.length - beforeL;
      }

      // Generate buildings on right side
      if (pathRStart && pathREnd) {
        const beforeR = this.spawnedBuildings.length;
        this.cursorOverflowR = this.generateBuildingsAlongPath(pathRStart, pathREnd, this.cursorOverflowR);
        buildingCount += this.spawnedBuildings.length - beforeR;
      }
    }

    console.log(`Buildings generated: ${buildingCount} buildings`);
  }

  /**
   * Clear all spawned buildings
   */
  clearBuildings() {
    if (this.spawnedBuildings) {
      this.spawnedBuildings.forEach(building => {
        this.scene.remove(building);
      });
    }
    this.spawnedBuildings = [];
    this.cursorOverflowL = 0;
    this.cursorOverflowR = 0;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  hideLoadingScreen() {
    this.loadingScreen.classList.add('hidden');
    setTimeout(() => { this.loadingScreen.style.display = 'none'; }, 500);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Calculate delta time
    const now = performance.now();
    const deltaTime = (now - (this.lastFrameTime || now)) / 1000;
    this.lastFrameTime = now;

    // Update car movement
    this.updateCar(deltaTime);

    // Update infinite road system
    this.updateInfiniteRoadSpawning();
    this.updateInfiniteRoadCleanup();

    // Only update orbit controls when chase camera is disabled
    if (!this.chaseCamEnabled) {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Start
const viewer = new AssetViewer();
viewer.init().catch(console.error);
window.viewer = viewer;
