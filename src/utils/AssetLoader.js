import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/**
 * AssetLoader - Centralized asset loading with progress tracking
 *
 * Handles loading of:
 * - GLB/GLTF models
 * - Textures (color maps, AO maps)
 * - HDR environment maps
 */
export class AssetLoader {
  constructor() {
    this.loadingManager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    this.rgbeLoader = new RGBELoader(this.loadingManager);

    // Cache loaded assets
    this.cache = {
      models: new Map(),
      textures: new Map(),
      environments: new Map()
    };

    // Progress tracking
    this.totalItems = 0;
    this.loadedItems = 0;
    this.onProgressCallback = null;
    this.onCompleteCallback = null;

    this.setupLoadingManager();
  }

  setupLoadingManager() {
    this.loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
      this.totalItems = itemsTotal;
    };

    this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
      this.loadedItems = itemsLoaded;
      this.totalItems = itemsTotal;
      const progress = (itemsLoaded / itemsTotal) * 100;

      if (this.onProgressCallback) {
        this.onProgressCallback(progress, url);
      }
    };

    this.loadingManager.onLoad = () => {
      if (this.onCompleteCallback) {
        this.onCompleteCallback();
      }
    };

    this.loadingManager.onError = (url) => {
      console.error(`Error loading: ${url}`);
    };
  }

  /**
   * Set progress callback
   * @param {Function} callback - Called with (progress: number, url: string)
   */
  onProgress(callback) {
    this.onProgressCallback = callback;
    return this;
  }

  /**
   * Set completion callback
   * @param {Function} callback - Called when all assets are loaded
   */
  onComplete(callback) {
    this.onCompleteCallback = callback;
    return this;
  }

  /**
   * Load a GLB/GLTF model
   * @param {string} path - Path to the model file
   * @param {boolean} useCache - Whether to use cached version if available
   * @returns {Promise<GLTF>}
   */
  async loadGLB(path, useCache = true) {
    if (useCache && this.cache.models.has(path)) {
      return this.cache.models.get(path);
    }

    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        path,
        (gltf) => {
          this.cache.models.set(path, gltf);
          resolve(gltf);
        },
        undefined,
        (error) => {
          console.error(`Failed to load GLB: ${path}`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Load a texture
   * @param {string} path - Path to the texture
   * @param {Object} options - Texture options
   * @returns {Promise<THREE.Texture>}
   */
  async loadTexture(path, options = {}) {
    const cacheKey = `${path}_${JSON.stringify(options)}`;

    if (this.cache.textures.has(cacheKey)) {
      return this.cache.textures.get(cacheKey);
    }

    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        path,
        (texture) => {
          // Apply options
          if (options.colorSpace === 'srgb') {
            texture.colorSpace = THREE.SRGBColorSpace;
          }
          if (options.flipY !== undefined) {
            texture.flipY = options.flipY;
          }
          if (options.wrapS) {
            texture.wrapS = options.wrapS;
          }
          if (options.wrapT) {
            texture.wrapT = options.wrapT;
          }
          if (options.minFilter) {
            texture.minFilter = options.minFilter;
          }
          if (options.magFilter) {
            texture.magFilter = options.magFilter;
          }
          if (options.anisotropy) {
            texture.anisotropy = options.anisotropy;
          }

          texture.needsUpdate = true;
          this.cache.textures.set(cacheKey, texture);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.error(`Failed to load texture: ${path}`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Load an HDR environment map
   * @param {string} path - Path to the HDR file
   * @returns {Promise<THREE.Texture>}
   */
  async loadHDR(path) {
    if (this.cache.environments.has(path)) {
      return this.cache.environments.get(path);
    }

    return new Promise((resolve, reject) => {
      this.rgbeLoader.load(
        path,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          this.cache.environments.set(path, texture);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.error(`Failed to load HDR: ${path}`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Load multiple assets in parallel
   * @param {Object} manifest - { models: [], textures: [], environments: [] }
   * @returns {Promise<Object>} Loaded assets organized by category
   */
  async loadManifest(manifest) {
    const results = {
      models: {},
      textures: {},
      environments: {}
    };

    const promises = [];

    // Queue model loads
    if (manifest.models) {
      for (const item of manifest.models) {
        const promise = this.loadGLB(item.path).then(model => {
          results.models[item.name] = model;
        });
        promises.push(promise);
      }
    }

    // Queue texture loads
    if (manifest.textures) {
      for (const item of manifest.textures) {
        const promise = this.loadTexture(item.path, item.options).then(texture => {
          results.textures[item.name] = texture;
        });
        promises.push(promise);
      }
    }

    // Queue environment loads
    if (manifest.environments) {
      for (const item of manifest.environments) {
        const promise = this.loadHDR(item.path).then(env => {
          results.environments[item.name] = env;
        });
        promises.push(promise);
      }
    }

    await Promise.all(promises);
    return results;
  }

  /**
   * Dispose a specific cached asset
   * @param {string} type - 'models', 'textures', or 'environments'
   * @param {string} path - The asset path/key
   */
  disposeAsset(type, path) {
    const cache = this.cache[type];
    if (!cache || !cache.has(path)) return;

    const asset = cache.get(path);

    if (type === 'textures' || type === 'environments') {
      asset.dispose();
    } else if (type === 'models') {
      // GLTF models need deeper disposal
      asset.scene?.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => {
              this.disposeMaterial(m);
            });
          } else {
            this.disposeMaterial(child.material);
          }
        }
      });
    }

    cache.delete(path);
  }

  /**
   * Dispose a material and its textures
   */
  disposeMaterial(material) {
    // Dispose all texture maps
    const textureProps = [
      'map', 'aoMap', 'normalMap', 'roughnessMap',
      'metalnessMap', 'emissiveMap', 'envMap'
    ];

    textureProps.forEach(prop => {
      if (material[prop]) {
        material[prop].dispose();
      }
    });

    material.dispose();
  }

  /**
   * Clear all cached assets
   */
  clearCache() {
    // Dispose textures
    this.cache.textures.forEach(texture => texture.dispose());
    this.cache.textures.clear();

    // Dispose environments
    this.cache.environments.forEach(env => env.dispose());
    this.cache.environments.clear();

    // Dispose models
    this.cache.models.forEach(gltf => {
      gltf.scene?.traverse(child => {
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
    this.cache.models.clear();
  }

  /**
   * Get current loading progress
   */
  getProgress() {
    if (this.totalItems === 0) return 100;
    return (this.loadedItems / this.totalItems) * 100;
  }
}
