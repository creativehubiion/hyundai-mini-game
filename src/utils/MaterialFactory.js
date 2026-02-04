import * as THREE from 'three';

/**
 * MaterialFactory - Creates optimized materials for the low-poly baked aesthetic
 *
 * Standard material setup:
 * - color_map: Master texture atlas on UV channel 0
 * - ao_map: Baked Ambient Occlusion on UV channel 1 (aoMapIntensity = 1.0)
 * - No real-time shadows on city meshes
 * - Lighting baked in Blender, matched in Three.js
 */
export class MaterialFactory {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;
    this.materialCache = new Map();
  }

  /**
   * Create a standard material with color and AO maps
   * @param {Object} options
   * @param {string} options.name - Unique name for caching
   * @param {string} options.colorMapPath - Path to color/diffuse texture
   * @param {string} options.aoMapPath - Path to ambient occlusion texture
   * @param {Object} options.materialProps - Additional MeshStandardMaterial properties
   * @returns {Promise<THREE.MeshStandardMaterial>}
   */
  async createStandardMaterial(options) {
    const {
      name,
      colorMapPath,
      aoMapPath,
      materialProps = {}
    } = options;

    // Check cache
    if (name && this.materialCache.has(name)) {
      return this.materialCache.get(name);
    }

    const materialConfig = {
      roughness: 0.8,
      metalness: 0.0,
      aoMapIntensity: 1.0,
      ...materialProps
    };

    // Load textures in parallel
    const texturePromises = [];

    if (colorMapPath) {
      texturePromises.push(
        this.assetLoader.loadTexture(colorMapPath, {
          colorSpace: 'srgb',
          flipY: false
        }).then(tex => {
          materialConfig.map = tex;
        })
      );
    }

    if (aoMapPath) {
      texturePromises.push(
        this.assetLoader.loadTexture(aoMapPath, {
          flipY: false
        }).then(tex => {
          materialConfig.aoMap = tex;
        })
      );
    }

    await Promise.all(texturePromises);

    const material = new THREE.MeshStandardMaterial(materialConfig);

    // Cache the material
    if (name) {
      this.materialCache.set(name, material);
    }

    return material;
  }

  /**
   * Create a simple color material (no textures)
   * Good for placeholder/debug geometry
   */
  createSimpleMaterial(color, options = {}) {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: options.roughness ?? 0.8,
      metalness: options.metalness ?? 0.0,
      flatShading: options.flatShading ?? false,
      ...options
    });
  }

  /**
   * Create a glass/transparent material
   */
  createGlassMaterial(options = {}) {
    return new THREE.MeshStandardMaterial({
      color: options.color ?? 0x88ccff,
      roughness: options.roughness ?? 0.1,
      metalness: options.metalness ?? 0.0,
      transparent: true,
      opacity: options.opacity ?? 0.3,
      side: THREE.DoubleSide
    });
  }

  /**
   * Create an emissive material (for lights, signs, etc.)
   */
  createEmissiveMaterial(color, intensity = 1.0, options = {}) {
    return new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: options.roughness ?? 0.5,
      metalness: options.metalness ?? 0.0,
      ...options
    });
  }

  /**
   * Apply material to a loaded GLB model
   * Replaces existing materials while preserving UV channels
   * @param {THREE.Object3D} model - The model to update
   * @param {THREE.Material} material - The material to apply
   * @param {Object} options - { preserveNames: string[] } - Material names to preserve
   */
  applyMaterialToModel(model, material, options = {}) {
    const preserveNames = options.preserveNames || [];

    model.traverse(child => {
      if (child.isMesh) {
        const existingName = child.material?.name || '';

        // Skip preserved materials (like glass)
        if (preserveNames.some(name => existingName.includes(name))) {
          return;
        }

        // Ensure UV2 exists for AO map if the mesh has UV1
        if (material.aoMap && child.geometry.attributes.uv && !child.geometry.attributes.uv2) {
          // Clone UV1 to UV2 as fallback
          child.geometry.attributes.uv2 = child.geometry.attributes.uv.clone();
        }

        child.material = material;
      }
    });
  }

  /**
   * Get a cached material by name
   */
  getMaterial(name) {
    return this.materialCache.get(name);
  }

  /**
   * Dispose a specific material
   */
  disposeMaterial(name) {
    const material = this.materialCache.get(name);
    if (material) {
      // Dispose textures
      if (material.map) material.map.dispose();
      if (material.aoMap) material.aoMap.dispose();
      if (material.normalMap) material.normalMap.dispose();
      material.dispose();
      this.materialCache.delete(name);
    }
  }

  /**
   * Dispose all cached materials
   */
  disposeAll() {
    this.materialCache.forEach(material => {
      if (material.map) material.map.dispose();
      if (material.aoMap) material.aoMap.dispose();
      if (material.normalMap) material.normalMap.dispose();
      material.dispose();
    });
    this.materialCache.clear();
  }
}
