import * as THREE from "../vendor/three.js";
import { loadMaskTexture } from "./assets.js";
import {
  chromeMaterial, planeVertex, dustVertex, dustFragment, shootingStarFragment,
} from "./shaders.js";

const CAMERA_Z = 12;
const HALF_FOV = THREE.MathUtils.degToRad(29);
const wrap = (value, span) => (((value + span / 2) % span) + span) % span - span / 2;

// Deterministic randomness keeps a stable composition as the page loads.
export function random(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export class DoodleUniverse {
  constructor(container, doodles, { onSelect, onHover, onProgress, displayMode = "shine" } = {}) {
    this.container = container;
    this.doodles = doodles;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onProgress = onProgress;
    this.items = [];
    this.batches = new Map();
    this.textures = [];
    this.pan = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.pointer = new THREE.Vector2(2, 2);
    this.pointerPixels = { x: 0, y: 0 };
    this.pointerActive = false;
    this.pointerDirty = false;
    this.lastPickAt = 0;
    this.currentTime = 0;
    this.dragging = false;
    this.movement = 0;
    this.hovered = null;
    this.hoverTransitions = new Set();
    this.destroyed = false;
    this.readyToLayout = false;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.motionQuery.matches;
    this.displayMode = displayMode === "color" ? "color" : "shine";
    this.timeUniform = { value: 0 };
    this.panUniform = { value: new THREE.Vector2() };
    this.modeUniform = { value: this.displayMode === "color" ? 1 : 0 };
    this.tileUniform = { value: new THREE.Vector2(1, 1) };
    this.materialUniforms = {
      uTime: this.timeUniform,
      uPan: this.panUniform,
      uTile: this.tileUniform,
      uMode: this.modeUniform,
    };
    this.pickCenter = new THREE.Vector3();
    this.pickEdgeX = new THREE.Vector3();
    this.pickEdgeY = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0a0a0f");
    this.scene.fog = new THREE.Fog("#0a0a0f", 10, 26);
    this.camera = new THREE.PerspectiveCamera(58, this.aspect(), 0.1, 100);
    this.camera.position.z = CAMERA_Z;
    // Integrated-GPU preference saves energy while retaining the same antialiasing.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power", preserveDrawingBuffer: false });
    const pixelRatioCap = window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.createDust();
    this.createShootingStars();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.startTime = performance.now();
    this.lastTime = 0;
    this.lastFrameAt = 0;
    this.frameInterval = 1000 / 60; // avoid waste on 90–240 Hz displays, without lowering normal 60 Hz quality
    this.nextStarAt = 2.5;
    this.animate = this.animate.bind(this);
    this.onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.hiddenAt = performance.now();
      } else if (!this.destroyed) {
        if (this.hiddenAt) this.startTime += performance.now() - this.hiddenAt;
        this.hiddenAt = 0;
        this.lastTime = (performance.now() - this.startTime) / 1000;
        this.lastFrameAt = 0;
        this.scheduleFrame();
      }
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.scheduleFrame();
    this.ready = this.populate();
  }

  scheduleFrame() {
    if (!this.destroyed && !document.hidden && !this.frame) this.frame = requestAnimationFrame(this.animate);
  }

  aspect() {
    return this.container.clientWidth / Math.max(this.container.clientHeight, 1);
  }

  dustTile() {
    const height = Math.tan(HALF_FOV) * 28 * 2 * 1.35;
    return { width: height * this.aspect(), height };
  }

  unitsPerPixel() {
    return 2 * Math.tan(HALF_FOV) * CAMERA_Z / Math.max(this.container.clientHeight, 1);
  }

  async populate() {
    let loaded = 0;
    this.textures = new Array(this.doodles.length);
    let next = 0;
    // Bound simultaneous SVG decoding/rasterisation to keep startup responsive.
    await Promise.all(Array.from({ length: Math.min(6, this.doodles.length) }, async () => {
      while (next < this.doodles.length && !this.destroyed) {
        const index = next++;
        this.textures[index] = await loadMaskTexture(this.doodles[index].slug);
        this.onProgress?.(++loaded, this.doodles.length);
      }
    }));
    if (this.destroyed) return;
    this.readyToLayout = true;
    this.layout();
    this.container.dataset.loaded = "true";
    this.container.dataset.doodleCount = String(this.doodles.length);
    this.scheduleFrame();
  }

  layout() {
    for (const batch of this.batches.values()) {
      batch.geometry.dispose();
      batch.material.dispose();
    }
    this.batches.clear();
    this.group.clear();
    this.items = [];
    this.hoverTransitions.clear();
    this.hovered = null;
    this.lastAspect = this.aspect();
    const height = Math.tan(HALF_FOV) * 16 * 2 * 1.3;
    const width = height * this.lastAspect;
    this.tile = { width, height };
    this.tileUniform.value.set(width, height);

    const suggestedSlots = Math.min(220, Math.round(
      this.container.clientWidth * this.container.clientHeight / 6400,
    ));
    const count = this.doodles.length ? Math.max(this.doodles.length, suggestedSlots) : 0;
    if (!count) return;
    const columns = Math.max(1, Math.round(Math.sqrt(width / height * count)));
    const rows = Math.max(1, Math.ceil(count / columns));
    const shuffled = Array.from({ length: count }, (_, index) => ({
      doodle: this.doodles[index % this.doodles.length],
      texture: this.textures[index % this.doodles.length],
      key: random(index * 9.17 + 1),
    })).sort((a, b) => a.key - b.key);
    const groups = new Map();
    shuffled.forEach(({ doodle, texture }, index) => {
      const seed = index + 1;
      const size = 0.55 + random(seed * 3.7) * 0.7;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = ((column + 0.5) / columns - 0.5) * width
        + (random(seed) - 0.5) * 0.8 * width / columns;
      const y = ((row + 0.5) / rows - 0.5) * height
        + (random(seed * 1.3) - 0.5) * 0.8 * height / rows;
      const z = (random(seed * 2.1) - 0.5) * 7 - 0.5;
      const item = {
        doodle, texture, size, baseX: x, baseY: y, z,
        baseRotation: (random(seed * 4.2) - 0.5) * 0.7,
        phase: random(seed * 5.5) * Math.PI * 2,
        bobSpeed: 0.25 + random(seed * 6.1) * 0.5,
        spinSpeed: (random(seed * 7.3) - 0.5) * 0.3,
        seed: random(seed * 8.9) * 10,
        hoverAmount: 0,
      };
      if (!groups.has(doodle.slug)) groups.set(doodle.slug, []);
      groups.get(doodle.slug).push(item);
    });

    const dummy = new THREE.Object3D();
    for (const [slug, items] of groups) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const seeds = new Float32Array(items.length);
      const phases = new Float32Array(items.length);
      const bobSpeeds = new Float32Array(items.length);
      const spinSpeeds = new Float32Array(items.length);
      const hoverValues = new Float32Array(items.length);
      items.forEach((item, index) => {
        item.batchIndex = index;
        item.hoverValues = hoverValues;
        seeds[index] = item.seed;
        phases[index] = item.phase;
        bobSpeeds[index] = item.bobSpeed;
        spinSpeeds[index] = item.spinSpeed * 0.24; // match the original per-frame rotation rate
        dummy.position.set(item.baseX, item.baseY, item.z);
        dummy.rotation.set(0, 0, item.baseRotation);
        dummy.scale.setScalar(item.size);
        dummy.updateMatrix();
        item.instanceMatrix = dummy.matrix.clone();
      });
      geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
      geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
      geometry.setAttribute("aBobSpeed", new THREE.InstancedBufferAttribute(bobSpeeds, 1));
      geometry.setAttribute("aSpinSpeed", new THREE.InstancedBufferAttribute(spinSpeeds, 1));
      const hoverAttribute = new THREE.InstancedBufferAttribute(hoverValues, 1);
      hoverAttribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("aHover", hoverAttribute);
      const material = chromeMaterial(items[0].texture, this.materialUniforms);
      const batch = new THREE.InstancedMesh(geometry, material, items.length);
      batch.frustumCulled = false; // Shader-side wrapping moves instances outside their base CPU bounds.
      batch.userData.items = items;
      items.forEach((item, index) => {
        item.batch = batch;
        batch.setMatrixAt(index, item.instanceMatrix);
        this.items.push(item);
      });
      batch.instanceMatrix.needsUpdate = true;
      this.group.add(batch);
      this.batches.set(slug, batch);
    }
  }

  setMode(mode) {
    this.displayMode = mode === "color" ? "color" : "shine";
    this.modeUniform.value = this.displayMode === "color" ? 1 : 0;
    this.container.dataset.renderMode = this.displayMode;
    this.scheduleFrame();
  }

  createDust() {
    const tile = this.dustTile();
    const dustCount = Math.max(180, Math.min(380, Math.round(
      this.container.clientWidth * this.container.clientHeight / 3800,
    )));
    const positions = new Float32Array(dustCount * 3);
    const sizes = new Float32Array(dustCount);
    const seeds = new Float32Array(dustCount);
    for (let index = 0; index < dustCount; index++) {
      positions[index * 3] = (random(index * 1.7 + 0.3) - 0.5) * tile.width;
      positions[index * 3 + 1] = (random(index * 2.9 + 0.7) - 0.5) * tile.height;
      positions[index * 3 + 2] = -5 - random(index * 4.3 + 0.1) * 11;
      sizes[index] = 1 + random(index * 5.9 + 0.5) * 2.4;
      seeds[index] = random(index * 7.1 + 0.9);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPan: { value: new THREE.Vector2() },
        uTile: { value: new THREE.Vector2(tile.width, tile.height) },
        uTime: { value: 0 },
      },
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geometry, material);
    this.scene.add(this.dust);
  }

  createShootingStars() {
    this.shootingStars = Array.from({ length: 3 }, () => {
      const material = new THREE.ShaderMaterial({
        uniforms: { uLife: { value: 0 } },
        vertexShader: planeVertex,
        fragmentShader: shootingStarFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.05), material);
      mesh.visible = false;
      this.scene.add(mesh);
      return { mesh, material, velocity: new THREE.Vector2(), startedAt: 0, duration: 1, active: false };
    });
  }

  setPointer(event) {
    const bounds = this.container.getBoundingClientRect();
    this.pointer.set(
      (event.clientX - bounds.left) / Math.max(bounds.width, 1) * 2 - 1,
      -(event.clientY - bounds.top) / Math.max(bounds.height, 1) * 2 + 1,
    );
    this.pointerPixels = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    this.pointerActive = true;
    this.pointerDirty = true;
    this.scheduleFrame();
  }

  pick() {
    if (!this.pointerActive || Math.abs(this.pointer.x) > 1 || Math.abs(this.pointer.y) > 1) return null;
    const bounds = this.container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    this.camera.updateMatrixWorld();
    let nearest = null;
    let nearestZ = -Infinity;
    for (const item of this.items) {
      const x = wrap(item.baseX + this.pan.x, this.tile.width);
      const y = wrap(item.baseY + this.pan.y + Math.sin(this.currentTime * item.bobSpeed + item.phase) * 0.25, this.tile.height);
      const half = item.size * (1 + item.hoverAmount * 0.5) * 0.7072;
      this.pickCenter.set(x, y, item.z).project(this.camera);
      if (this.pickCenter.z < -1 || this.pickCenter.z > 1) continue;
      this.pickEdgeX.set(x + half, y, item.z).project(this.camera);
      this.pickEdgeY.set(x, y + half, item.z).project(this.camera);
      const px = (this.pickCenter.x * 0.5 + 0.5) * bounds.width;
      const py = (-this.pickCenter.y * 0.5 + 0.5) * bounds.height;
      const rx = Math.abs(this.pickEdgeX.x - this.pickCenter.x) * bounds.width * 0.5 + 2;
      const ry = Math.abs(this.pickEdgeY.y - this.pickCenter.y) * bounds.height * 0.5 + 2;
      if (Math.abs(this.pointerPixels.x - px) <= rx && Math.abs(this.pointerPixels.y - py) <= ry && item.z > nearestZ) {
        nearest = item;
        nearestZ = item.z;
      }
    }
    return nearest;
  }

  setHovered(item) {
    if (item === this.hovered) return;
    if (this.hovered) this.hoverTransitions.add(this.hovered);
    if (item) this.hoverTransitions.add(item);
    this.hovered = item;
    this.onHover?.(item, this.pointerPixels);
    const cursor = item ? "pointer" : this.dragging ? "grabbing" : "grab";
    if (this.container.style.cursor !== cursor) this.container.style.cursor = cursor;
  }

  updateHover() {
    const touched = new Set();
    for (const item of this.hoverTransitions) {
      const target = item === this.hovered ? 1 : 0;
      const next = item.hoverAmount + (target - item.hoverAmount) * 0.15;
      item.hoverAmount = Math.abs(target - next) < 0.008 ? target : next;
      item.hoverValues[item.batchIndex] = item.hoverAmount;
      touched.add(item.batch.geometry.attributes.aHover);
      if (item.hoverAmount === target) this.hoverTransitions.delete(item);
    }
    for (const attribute of touched) attribute.needsUpdate = true;
  }

  bindEvents() {
    this.events = {
      pointerdown: (event) => {
        if (event.button !== 0) return;
        this.setPointer(event);
        this.dragging = true;
        this.movement = 0;
        this.lastPointer = { x: event.clientX, y: event.clientY };
        this.velocity.x = this.velocity.y = 0;
        this.container.setPointerCapture(event.pointerId);
      },
      pointermove: (event) => {
        this.setPointer(event);
        this.onHover?.(this.hovered, this.pointerPixels);
        if (!this.dragging) return;
        const dx = event.clientX - this.lastPointer.x;
        const dy = event.clientY - this.lastPointer.y;
        this.lastPointer = { x: event.clientX, y: event.clientY };
        this.movement += Math.abs(dx) + Math.abs(dy);
        const unit = this.unitsPerPixel();
        this.pan.x += dx * unit;
        this.pan.y -= dy * unit;
        this.velocity.x = dx * unit;
        this.velocity.y = -dy * unit;
      },
      pointerup: () => { this.dragging = false; },
      pointercancel: () => {
        this.dragging = false;
        this.pointerActive = false;
        this.pointer.set(2, 2);
        this.setHovered(null);
        this.scheduleFrame();
      },
      pointerleave: () => {
        if (this.dragging) return;
        this.pointerActive = false;
        this.pointerDirty = false;
        this.pointer.set(2, 2);
        this.setHovered(null);
        this.scheduleFrame();
      },
      click: (event) => {
        if (this.movement >= 6) return;
        this.setPointer(event);
        const item = this.pick();
        if (item?.doodle) this.onSelect?.(item.doodle);
      },
      wheel: (event) => {
        event.preventDefault();
        const unit = this.unitsPerPixel();
        this.pan.x -= event.deltaX * unit;
        this.pan.y += event.deltaY * unit;
        this.pointerDirty = true;
        this.scheduleFrame();
      },
      keydown: (event) => {
        const unit = this.unitsPerPixel() * 140;
        const moves = { ArrowLeft: [unit, 0], ArrowRight: [-unit, 0], ArrowUp: [0, -unit], ArrowDown: [0, unit] };
        if (moves[event.key]) {
          event.preventDefault();
          const [x, y] = moves[event.key];
          this.pan.x += x;
          this.pan.y += y;
          this.pointerDirty = true;
          this.scheduleFrame();
        } else if (event.key.toLowerCase() === "r") {
          this.pan.x = this.pan.y = this.velocity.x = this.velocity.y = 0;
          this.pointerDirty = true;
          this.scheduleFrame();
        } else if (event.key === "Enter") {
          event.preventDefault();
          const item = this.closestDoodle();
          if (item) this.onSelect?.(item.doodle);
        }
      },
    };
    for (const [name, handler] of Object.entries(this.events)) {
      this.container.addEventListener(name, handler, name === "wheel" ? { passive: false } : undefined);
    }
    this.motionHandler = (event) => { this.reducedMotion = event.matches; this.scheduleFrame(); };
    this.motionQuery.addEventListener("change", this.motionHandler);
  }

  closestDoodle() {
    let nearest = null;
    let distance = Infinity;
    this.camera.updateMatrixWorld();
    for (const item of this.items) {
      const x = wrap(item.baseX + this.pan.x, this.tile.width);
      const y = wrap(item.baseY + this.pan.y + Math.sin(this.currentTime * item.bobSpeed + item.phase) * 0.25, this.tile.height);
      const point = this.pickCenter.set(x, y, item.z).project(this.camera);
      const value = point.x * point.x + point.y * point.y;
      if (point.z >= -1 && point.z <= 1 && value < distance) { nearest = item; distance = value; }
    }
    return nearest;
  }

  resize() {
    if (this.destroyed) return;
    this.camera.aspect = this.aspect();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    const tile = this.dustTile();
    this.dust.material.uniforms.uTile.value.set(tile.width, tile.height);
    if (this.readyToLayout && Math.abs(this.lastAspect - this.aspect()) > 0.001) this.layout();
    this.scheduleFrame();
  }

  animate(timestamp) {
    if (this.destroyed || document.hidden) { this.frame = 0; return; }
    this.frame = 0;
    if (this.lastFrameAt && timestamp - this.lastFrameAt < this.frameInterval - 0.5) {
      this.scheduleFrame();
      return;
    }
    this.lastFrameAt = timestamp;
    const elapsed = (timestamp - this.startTime) / 1000;
    const delta = Math.min(elapsed - this.lastTime, 0.1);
    this.lastTime = elapsed;
    this.currentTime = this.reducedMotion ? 0 : elapsed;
    this.timeUniform.value = this.currentTime;
    if (this.pointerActive && (this.pointerDirty || timestamp - this.lastPickAt >= 90)) {
      this.setHovered(this.pick());
      this.pointerDirty = false;
      this.lastPickAt = timestamp;
    }
    this.updateHover();
    if (this.dragging) {
      if (this.container.style.cursor !== "grabbing") this.container.style.cursor = "grabbing";
    } else if (!this.hovered && this.container.style.cursor !== "grab") this.container.style.cursor = "grab";
    if (!this.dragging) {
      this.pan.x += this.velocity.x;
      this.pan.y += this.velocity.y;
      this.velocity.x *= 0.94;
      this.velocity.y *= 0.94;
    }
    this.panUniform.value.set(this.pan.x, this.pan.y);
    this.dust.material.uniforms.uPan.value.set(this.pan.x, this.pan.y);
    this.dust.material.uniforms.uTime.value = this.currentTime;
    if (!this.reducedMotion) {
      if (elapsed >= this.nextStarAt) {
        this.spawnShootingStar(elapsed);
        this.nextStarAt = elapsed + 4 + Math.random() * 9;
      }
      for (const star of this.shootingStars) {
        if (!star.active) continue;
        const life = (elapsed - star.startedAt) / star.duration;
        if (life >= 1) { star.active = false; star.mesh.visible = false; continue; }
        star.mesh.position.x += star.velocity.x * delta;
        star.mesh.position.y += star.velocity.y * delta;
        star.material.uniforms.uLife.value = life;
      }
    } else {
      for (const star of this.shootingStars) star.mesh.visible = false;
    }
    this.renderer.render(this.scene, this.camera);
    const stillMoving = Math.hypot(this.velocity.x, this.velocity.y) > 0.0001;
    if (!this.reducedMotion || this.dragging || stillMoving || this.hoverTransitions.size || this.pointerDirty) this.scheduleFrame();
  }

  spawnShootingStar(time) {
    const star = this.shootingStars.find((item) => !item.active);
    if (!star) return;
    const z = -8 - Math.random() * 6;
    const height = Math.tan(HALF_FOV) * (CAMERA_Z - z) * 2;
    const width = height * this.aspect();
    const angle = -Math.PI / 6 * (0.7 + Math.random() * 0.9);
    const direction = Math.random() < 0.5 ? 1 : -1;
    const speed = 10 + Math.random() * 8;
    star.velocity.set(Math.cos(angle) * speed * direction, Math.sin(angle) * speed);
    star.mesh.position.set(
      (Math.random() - 0.5) * width * 0.8 - star.velocity.x * 0.6,
      (Math.random() * 0.5 + 0.1) * height * 0.5,
      z,
    );
    star.mesh.rotation.z = Math.atan2(star.velocity.y, star.velocity.x);
    star.duration = 1.1 + Math.random() * 0.8;
    star.startedAt = time;
    star.active = true;
    star.mesh.visible = true;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.resizeObserver?.disconnect();
    for (const [name, handler] of Object.entries(this.events || {})) this.container.removeEventListener(name, handler);
    this.motionQuery.removeEventListener("change", this.motionHandler);
    this.scene.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
