import * as THREE from 'three';
import { ObjectPool } from './ObjectPool.js';

/**
 * RoadManager - Handles infinite road generation using pre-modeled segments
 *
 * Road segments are GLB files with defined connection points:
 * - 'in_point': Where the segment connects to the previous segment
 * - 'out_point': Where the next segment connects
 *
 * Segments are recycled from behind the player to ahead using ObjectPool.
 */
export class RoadManager {
  constructor(scene, assetLoader) {
    this.scene = scene;
    this.assetLoader = assetLoader;

    // Segment templates (original loaded models)
    this.segmentTemplates = new Map();

    // Active road segments in world order
    this.activeSegments = [];

    // Pool for each segment type
    this.segmentPools = new Map();

    // Current end position/rotation for placing next segment
    this.currentEndPosition = new THREE.Vector3(0, 0, 0);
    this.currentEndDirection = new THREE.Vector3(0, 0, -1); // Forward is -Z

    // Configuration
    this.segmentsAhead = 10;  // Segments to maintain ahead of player
    this.segmentsBehind = 3;  // Segments to keep behind before recycling

    // Segment length for placeholder geometry
    this.defaultSegmentLength = 20;
  }

  /**
   * Initialize the road manager with segment definitions
   * @param {Array} segmentDefs - Array of { name, path, weight } objects
   */
  async init(segmentDefs = null) {
    if (segmentDefs && segmentDefs.length > 0) {
      // Load actual GLB segments
      await this.loadSegments(segmentDefs);
    } else {
      // Use placeholder geometry for development
      this.createPlaceholderSegments();
    }

    // Generate initial road
    this.generateInitialRoad();
  }

  /**
   * Load GLB segment models
   */
  async loadSegments(segmentDefs) {
    for (const def of segmentDefs) {
      const model = await this.assetLoader.loadGLB(def.path);

      // Extract connection points from model
      const inPoint = this.findConnectionPoint(model, 'in_point');
      const outPoint = this.findConnectionPoint(model, 'out_point');

      this.segmentTemplates.set(def.name, {
        model: model.scene,
        inPoint: inPoint || new THREE.Vector3(0, 0, this.defaultSegmentLength / 2),
        outPoint: outPoint || new THREE.Vector3(0, 0, -this.defaultSegmentLength / 2),
        weight: def.weight || 1
      });

      // Create pool for this segment type
      this.createSegmentPool(def.name);
    }
  }

  /**
   * Find a connection point empty/marker in the model
   */
  findConnectionPoint(gltf, name) {
    let point = null;
    gltf.scene.traverse(child => {
      if (child.name.toLowerCase().includes(name.toLowerCase())) {
        point = child.position.clone();
      }
    });
    return point;
  }

  /**
   * Create placeholder segments for development without GLB files
   */
  createPlaceholderSegments() {
    // Straight segment
    this.createPlaceholderSegment('straight', {
      length: 20,
      width: 12,
      curve: 0
    });

    // Gentle left curve
    this.createPlaceholderSegment('curve_left', {
      length: 20,
      width: 12,
      curve: -0.15 // radians rotation
    });

    // Gentle right curve
    this.createPlaceholderSegment('curve_right', {
      length: 20,
      width: 12,
      curve: 0.15
    });
  }

  /**
   * Create a single placeholder segment type
   */
  createPlaceholderSegment(name, config) {
    const { length, width, curve } = config;

    // Calculate out point based on curve
    const halfLength = length / 2;

    // For straight: out is directly ahead
    // For curves: out is rotated
    const outX = Math.sin(curve) * length;
    const outZ = -Math.cos(curve) * length;

    this.segmentTemplates.set(name, {
      config: config,
      inPoint: new THREE.Vector3(0, 0, halfLength),
      outPoint: new THREE.Vector3(outX, 0, -halfLength + outZ + halfLength),
      outRotation: curve, // Additional Y rotation for next segment
      weight: name === 'straight' ? 3 : 1 // Straight segments more common
    });

    this.createSegmentPool(name);
  }

  /**
   * Create an object pool for a segment type
   */
  createSegmentPool(name) {
    const template = this.segmentTemplates.get(name);

    const createFn = () => {
      if (template.model) {
        // Clone the GLB model
        const clone = template.model.clone();
        clone.traverse(child => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        return {
          mesh: clone,
          type: name,
          inPoint: template.inPoint.clone(),
          outPoint: template.outPoint.clone(),
          outRotation: template.outRotation || 0
        };
      } else {
        // Create placeholder geometry
        return this.createPlaceholderMesh(name, template);
      }
    };

    const resetFn = (segment) => {
      segment.mesh.visible = false;
      segment.mesh.position.set(0, 0, 0);
      segment.mesh.rotation.set(0, 0, 0);
    };

    this.segmentPools.set(name, new ObjectPool(createFn, resetFn, 2));
  }

  /**
   * Create placeholder mesh geometry
   */
  createPlaceholderMesh(name, template) {
    const { length, width, curve } = template.config;
    const group = new THREE.Group();

    // Road surface
    const roadGeo = new THREE.PlaneGeometry(width, length, 1, 8);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.9
    });

    // Apply curve deformation to vertices
    if (curve !== 0) {
      const positions = roadGeo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const z = positions.getZ(i);
        const t = (z + length / 2) / length; // 0 to 1 along length
        const xOffset = Math.sin(curve * t) * t * length * 0.5;
        positions.setX(i, positions.getX(i) + xOffset);
      }
      roadGeo.computeVertexNormals();
    }

    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    group.add(road);

    // Road markings (center line)
    const lineGeo = new THREE.PlaneGeometry(0.15, length * 0.8);
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      roughness: 0.5
    });
    const centerLine = new THREE.Mesh(lineGeo, lineMat);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.02;
    group.add(centerLine);

    // Edge curbs
    const curbGeo = new THREE.BoxGeometry(0.3, 0.15, length);
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.8
    });

    const leftCurb = new THREE.Mesh(curbGeo, curbMat);
    leftCurb.position.set(-width / 2 + 0.15, 0.075, 0);
    group.add(leftCurb);

    const rightCurb = new THREE.Mesh(curbGeo, curbMat);
    rightCurb.position.set(width / 2 - 0.15, 0.075, 0);
    group.add(rightCurb);

    // Sidewalk
    const sidewalkGeo = new THREE.PlaneGeometry(3, length);
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.95
    });

    const leftSidewalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
    leftSidewalk.rotation.x = -Math.PI / 2;
    leftSidewalk.position.set(-width / 2 - 1.5, 0.005, 0);
    group.add(leftSidewalk);

    const rightSidewalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
    rightSidewalk.rotation.x = -Math.PI / 2;
    rightSidewalk.position.set(width / 2 + 1.5, 0.005, 0);
    group.add(rightSidewalk);

    return {
      mesh: group,
      type: name,
      inPoint: template.inPoint.clone(),
      outPoint: template.outPoint.clone(),
      outRotation: template.outRotation || 0
    };
  }

  /**
   * Generate the initial stretch of road
   */
  generateInitialRoad() {
    for (let i = 0; i < this.segmentsAhead; i++) {
      this.addSegmentAhead();
    }
  }

  /**
   * Select a random segment type based on weights
   */
  selectRandomSegmentType() {
    const types = Array.from(this.segmentTemplates.entries());
    const totalWeight = types.reduce((sum, [, t]) => sum + t.weight, 0);
    let random = Math.random() * totalWeight;

    for (const [name, template] of types) {
      random -= template.weight;
      if (random <= 0) {
        return name;
      }
    }

    return types[0][0]; // Fallback to first type
  }

  /**
   * Add a new segment at the end of the road
   */
  addSegmentAhead() {
    const segmentType = this.selectRandomSegmentType();
    const pool = this.segmentPools.get(segmentType);
    const segment = pool.acquire();

    // Position segment so its inPoint aligns with currentEndPosition
    const template = this.segmentTemplates.get(segmentType);

    // Calculate world position
    // The segment's local inPoint should be at currentEndPosition
    segment.mesh.position.copy(this.currentEndPosition);

    // Apply current road direction as rotation
    const angle = Math.atan2(this.currentEndDirection.x, -this.currentEndDirection.z);
    segment.mesh.rotation.y = angle;

    // Offset by the inPoint (transformed by rotation)
    const rotatedInPoint = segment.inPoint.clone().applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angle
    );
    segment.mesh.position.sub(rotatedInPoint);

    // Update currentEndPosition for next segment
    const rotatedOutPoint = segment.outPoint.clone().applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angle
    );
    this.currentEndPosition.copy(segment.mesh.position).add(rotatedOutPoint);

    // Update direction based on segment's curve
    if (segment.outRotation) {
      this.currentEndDirection.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        segment.outRotation
      );
    }

    segment.mesh.visible = true;
    segment.worldZ = segment.mesh.position.z; // For culling reference

    this.scene.add(segment.mesh);
    this.activeSegments.push(segment);

    return segment;
  }

  /**
   * Remove the oldest segment and recycle it
   */
  recycleOldestSegment() {
    if (this.activeSegments.length === 0) return null;

    const segment = this.activeSegments.shift();
    this.scene.remove(segment.mesh);

    const pool = this.segmentPools.get(segment.type);
    pool.release(segment);

    return segment;
  }

  /**
   * Update road based on player position
   * @param {THREE.Vector3} playerPosition
   */
  update(playerPosition) {
    // Count segments ahead and behind player
    let segmentsBehind = 0;
    let segmentsAhead = 0;

    for (const segment of this.activeSegments) {
      // Use Z position relative to player (assuming -Z is forward)
      if (segment.mesh.position.z > playerPosition.z) {
        segmentsBehind++;
      } else {
        segmentsAhead++;
      }
    }

    // Recycle segments that are too far behind
    while (segmentsBehind > this.segmentsBehind && this.activeSegments.length > 0) {
      const oldest = this.activeSegments[0];
      if (oldest.mesh.position.z > playerPosition.z + this.defaultSegmentLength * 2) {
        this.recycleOldestSegment();
        segmentsBehind--;
      } else {
        break;
      }
    }

    // Add new segments ahead if needed
    while (segmentsAhead < this.segmentsAhead) {
      this.addSegmentAhead();
      segmentsAhead++;
    }
  }

  /**
   * Get the road center position at a given Z coordinate
   * @param {number} z - World Z coordinate
   * @returns {THREE.Vector3} Center position of road at that Z
   */
  getRoadCenterAt(z) {
    // Find the segment containing this Z position
    for (const segment of this.activeSegments) {
      const segZ = segment.mesh.position.z;
      const halfLength = this.defaultSegmentLength / 2;

      if (z >= segZ - halfLength && z <= segZ + halfLength) {
        // Interpolate position within segment
        // For now, return segment center X (proper curve following comes later)
        return new THREE.Vector3(
          segment.mesh.position.x,
          0,
          z
        );
      }
    }

    // Default to origin if not found
    return new THREE.Vector3(0, 0, z);
  }

  /**
   * Get pool statistics for debugging
   */
  getStats() {
    const stats = {
      activeSegments: this.activeSegments.length,
      pools: {}
    };

    this.segmentPools.forEach((pool, name) => {
      stats.pools[name] = pool.stats;
    });

    return stats;
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    // Remove all segments from scene
    this.activeSegments.forEach(segment => {
      this.scene.remove(segment.mesh);
    });

    // Dispose all pools
    this.segmentPools.forEach(pool => {
      pool.dispose((segment) => {
        segment.mesh.traverse(child => {
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
    });

    this.activeSegments = [];
    this.segmentPools.clear();
    this.segmentTemplates.clear();
  }
}
