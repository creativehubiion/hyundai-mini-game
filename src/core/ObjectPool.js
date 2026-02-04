/**
 * ObjectPool - Generic pooling system for Three.js objects
 *
 * Manages reusable object instances to avoid garbage collection stutters.
 * Objects are acquired from the pool when needed and released back when done.
 */
export class ObjectPool {
  /**
   * @param {Function} createFn - Factory function that creates a new object
   * @param {Function} resetFn - Function to reset an object before reuse
   * @param {number} initialSize - Number of objects to pre-instantiate
   */
  constructor(createFn, resetFn = null, initialSize = 0) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.available = [];
    this.inUse = new Set();

    // Pre-populate pool
    for (let i = 0; i < initialSize; i++) {
      this.available.push(this.createFn());
    }
  }

  /**
   * Get an object from the pool
   * @returns {Object} A pooled object (new or recycled)
   */
  acquire() {
    let obj;

    if (this.available.length > 0) {
      obj = this.available.pop();
    } else {
      obj = this.createFn();
    }

    this.inUse.add(obj);
    return obj;
  }

  /**
   * Return an object to the pool
   * @param {Object} obj - The object to release
   */
  release(obj) {
    if (!this.inUse.has(obj)) {
      console.warn('ObjectPool: Attempted to release an object not in use');
      return;
    }

    this.inUse.delete(obj);

    // Reset the object if a reset function was provided
    if (this.resetFn) {
      this.resetFn(obj);
    }

    this.available.push(obj);
  }

  /**
   * Release all objects currently in use
   */
  releaseAll() {
    this.inUse.forEach(obj => {
      if (this.resetFn) {
        this.resetFn(obj);
      }
      this.available.push(obj);
    });
    this.inUse.clear();
  }

  /**
   * Dispose of all objects and clear the pool
   * @param {Function} disposeFn - Optional function to properly dispose each object
   */
  dispose(disposeFn = null) {
    const allObjects = [...this.available, ...this.inUse];

    allObjects.forEach(obj => {
      if (disposeFn) {
        disposeFn(obj);
      } else if (obj.dispose) {
        obj.dispose();
      } else if (obj.geometry || obj.material) {
        // Default Three.js mesh disposal
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });

    this.available = [];
    this.inUse.clear();
  }

  /**
   * Get current pool statistics
   */
  get stats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size
    };
  }
}
