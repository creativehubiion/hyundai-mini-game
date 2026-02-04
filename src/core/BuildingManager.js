import * as THREE from 'three';
import { ObjectPool } from './ObjectPool.js';

/**
 * BuildingManager - Grid-based spawning system for city props
 *
 * Places building GLBs on both sides of the road while maintaining
 * a clear driving corridor. Uses object pooling to recycle buildings
 * as the player advances.
 */
export class BuildingManager {
  constructor(scene, assetLoader) {
    this.scene = scene;
    this.assetLoader = assetLoader;

    // Building templates (original loaded models)
    this.buildingTemplates = [];

    // Object pool for buildings
    this.buildingPool = null;

    // Active buildings in the world
    this.activeBuildings = [];

    // Grid configuration
    this.config = {
      roadWidth: 12,           // Width of the road
      sidewalkWidth: 3,        // Width of sidewalk
      buildingSetback: 2,      // Distance from sidewalk edge to building
      gridCellSize: 15,        // Size of each building lot
      spawnDistance: 200,      // How far ahead to spawn buildings
      despawnDistance: 50,     // How far behind to despawn
      minBuildingSpacing: 2,   // Minimum gap between buildings
      rowsPerSide: 2           // Depth of building rows on each side
    };

    // Current spawn position (Z coordinate)
    this.lastSpawnZ = 0;

    // Track which grid cells have buildings
    this.occupiedCells = new Set();
  }

  /**
   * Initialize with building definitions
   * @param {Array} buildingDefs - Array of { name, path, width, depth, weight }
   */
  async init(buildingDefs = null) {
    if (buildingDefs && buildingDefs.length > 0) {
      await this.loadBuildings(buildingDefs);
    } else {
      // Create placeholder buildings
      this.createPlaceholderBuildings();
    }

    this.createBuildingPool();
  }

  /**
   * Load building GLB models
   */
  async loadBuildings(buildingDefs) {
    for (const def of buildingDefs) {
      try {
        const gltf = await this.assetLoader.loadGLB(def.path);

        // Calculate bounding box for placement
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());

        this.buildingTemplates.push({
          name: def.name,
          model: gltf.scene,
          width: def.width || size.x,
          depth: def.depth || size.z,
          height: size.y,
          weight: def.weight || 1
        });
      } catch (error) {
        console.warn(`Failed to load building: ${def.path}`, error);
      }
    }
  }

  /**
   * Create placeholder buildings for development
   */
  createPlaceholderBuildings() {
    const buildingTypes = [
      { name: 'small_office', width: 8, depth: 8, minHeight: 15, maxHeight: 25, color: 0x666677 },
      { name: 'medium_office', width: 12, depth: 10, minHeight: 25, maxHeight: 40, color: 0x555566 },
      { name: 'tall_tower', width: 10, depth: 10, minHeight: 40, maxHeight: 60, color: 0x444455 },
      { name: 'wide_building', width: 15, depth: 12, minHeight: 12, maxHeight: 20, color: 0x777788 },
      { name: 'shop', width: 6, depth: 6, minHeight: 6, maxHeight: 10, color: 0x886655 }
    ];

    buildingTypes.forEach(type => {
      const height = THREE.MathUtils.randFloat(type.minHeight, type.maxHeight);

      const geometry = new THREE.BoxGeometry(type.width, height, type.depth);
      const material = new THREE.MeshStandardMaterial({
        color: type.color,
        roughness: 0.9,
        metalness: 0.1
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = height / 2; // Origin at base

      // Add windows (simple colored rectangles)
      this.addWindowsToBuilding(mesh, type.width, height, type.depth);

      this.buildingTemplates.push({
        name: type.name,
        model: mesh,
        width: type.width,
        depth: type.depth,
        height: height,
        weight: type.name === 'shop' ? 3 : 1 // More shops
      });
    });
  }

  /**
   * Add simple window details to a building
   */
  addWindowsToBuilding(building, width, height, depth) {
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xaaccff,
      emissive: 0x223344,
      emissiveIntensity: 0.3,
      roughness: 0.1
    });

    const windowSize = 1.5;
    const windowSpacing = 3;
    const startY = 4;

    // Front and back faces
    for (let y = startY; y < height - 2; y += windowSpacing) {
      for (let x = -width / 2 + 2; x < width / 2 - 1; x += windowSpacing) {
        // Front
        const frontWindow = new THREE.Mesh(
          new THREE.PlaneGeometry(windowSize, windowSize * 1.5),
          windowMat
        );
        frontWindow.position.set(x, y, depth / 2 + 0.01);
        building.add(frontWindow);

        // Back
        const backWindow = new THREE.Mesh(
          new THREE.PlaneGeometry(windowSize, windowSize * 1.5),
          windowMat
        );
        backWindow.position.set(x, y, -depth / 2 - 0.01);
        backWindow.rotation.y = Math.PI;
        building.add(backWindow);
      }
    }

    // Side faces
    for (let y = startY; y < height - 2; y += windowSpacing) {
      for (let z = -depth / 2 + 2; z < depth / 2 - 1; z += windowSpacing) {
        // Left
        const leftWindow = new THREE.Mesh(
          new THREE.PlaneGeometry(windowSize, windowSize * 1.5),
          windowMat
        );
        leftWindow.position.set(-width / 2 - 0.01, y, z);
        leftWindow.rotation.y = -Math.PI / 2;
        building.add(leftWindow);

        // Right
        const rightWindow = new THREE.Mesh(
          new THREE.PlaneGeometry(windowSize, windowSize * 1.5),
          windowMat
        );
        rightWindow.position.set(width / 2 + 0.01, y, z);
        rightWindow.rotation.y = Math.PI / 2;
        building.add(rightWindow);
      }
    }
  }

  /**
   * Create the object pool for buildings
   */
  createBuildingPool() {
    const createFn = () => {
      // Select a random building type based on weight
      const template = this.selectRandomTemplate();
      const clone = template.model.clone();

      return {
        mesh: clone,
        template: template,
        active: false
      };
    };

    const resetFn = (building) => {
      building.mesh.visible = false;
      building.active = false;
    };

    this.buildingPool = new ObjectPool(createFn, resetFn, 30);
  }

  /**
   * Select a random building template based on weights
   */
  selectRandomTemplate() {
    const totalWeight = this.buildingTemplates.reduce((sum, t) => sum + t.weight, 0);
    let random = Math.random() * totalWeight;

    for (const template of this.buildingTemplates) {
      random -= template.weight;
      if (random <= 0) {
        return template;
      }
    }

    return this.buildingTemplates[0];
  }

  /**
   * Spawn a building at a specific position
   */
  spawnBuilding(x, z, side) {
    const building = this.buildingPool.acquire();

    // Random Y rotation for variety
    const yRotation = side === 'left'
      ? Math.PI / 2 + (Math.random() - 0.5) * 0.2
      : -Math.PI / 2 + (Math.random() - 0.5) * 0.2;

    building.mesh.position.set(x, 0, z);
    building.mesh.rotation.y = yRotation;
    building.mesh.visible = true;
    building.active = true;
    building.worldZ = z;
    building.side = side;

    this.scene.add(building.mesh);
    this.activeBuildings.push(building);

    return building;
  }

  /**
   * Generate buildings for a section of road
   * @param {number} startZ - Start Z position
   * @param {number} endZ - End Z position
   */
  generateSection(startZ, endZ) {
    const { roadWidth, sidewalkWidth, buildingSetback, gridCellSize, rowsPerSide } = this.config;

    // Calculate building placement zones
    const leftEdge = -roadWidth / 2 - sidewalkWidth - buildingSetback;
    const rightEdge = roadWidth / 2 + sidewalkWidth + buildingSetback;

    for (let z = startZ; z > endZ; z -= gridCellSize) {
      // Left side buildings
      for (let row = 0; row < rowsPerSide; row++) {
        const x = leftEdge - row * gridCellSize - Math.random() * 5;
        const cellKey = `${Math.floor(x / gridCellSize)}_${Math.floor(z / gridCellSize)}`;

        if (!this.occupiedCells.has(cellKey) && Math.random() > 0.2) {
          this.spawnBuilding(x, z + Math.random() * 5, 'left');
          this.occupiedCells.add(cellKey);
        }
      }

      // Right side buildings
      for (let row = 0; row < rowsPerSide; row++) {
        const x = rightEdge + row * gridCellSize + Math.random() * 5;
        const cellKey = `${Math.floor(x / gridCellSize)}_${Math.floor(z / gridCellSize)}`;

        if (!this.occupiedCells.has(cellKey) && Math.random() > 0.2) {
          this.spawnBuilding(x, z + Math.random() * 5, 'right');
          this.occupiedCells.add(cellKey);
        }
      }
    }
  }

  /**
   * Update building spawning/despawning based on player position
   * @param {THREE.Vector3} playerPosition
   */
  update(playerPosition) {
    const { spawnDistance, despawnDistance, gridCellSize } = this.config;
    const playerZ = playerPosition.z;

    // Spawn new buildings ahead
    const targetSpawnZ = playerZ - spawnDistance;
    if (this.lastSpawnZ > targetSpawnZ) {
      this.generateSection(this.lastSpawnZ, targetSpawnZ);
      this.lastSpawnZ = targetSpawnZ;
    }

    // Despawn buildings behind
    const despawnZ = playerZ + despawnDistance;
    const toRemove = [];

    for (let i = 0; i < this.activeBuildings.length; i++) {
      const building = this.activeBuildings[i];
      if (building.worldZ > despawnZ) {
        this.scene.remove(building.mesh);
        this.buildingPool.release(building);

        // Clear occupied cell
        const cellKey = `${Math.floor(building.mesh.position.x / gridCellSize)}_${Math.floor(building.worldZ / gridCellSize)}`;
        this.occupiedCells.delete(cellKey);

        toRemove.push(i);
      }
    }

    // Remove despawned buildings from active list (in reverse order)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.activeBuildings.splice(toRemove[i], 1);
    }
  }

  /**
   * Initialize buildings for starting area
   * @param {THREE.Vector3} startPosition
   */
  initializeArea(startPosition) {
    const { spawnDistance } = this.config;
    this.lastSpawnZ = startPosition.z + 50;
    this.generateSection(this.lastSpawnZ, startPosition.z - spawnDistance);
  }

  /**
   * Get statistics for debugging
   */
  getStats() {
    return {
      activeBuildings: this.activeBuildings.length,
      poolStats: this.buildingPool?.stats,
      occupiedCells: this.occupiedCells.size
    };
  }

  /**
   * Dispose all resources
   */
  dispose() {
    // Remove all buildings from scene
    this.activeBuildings.forEach(building => {
      this.scene.remove(building.mesh);
    });

    // Dispose pool
    if (this.buildingPool) {
      this.buildingPool.dispose((building) => {
        building.mesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      });
    }

    this.activeBuildings = [];
    this.occupiedCells.clear();
    this.buildingTemplates = [];
  }
}
