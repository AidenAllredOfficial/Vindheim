// One instanced draw call for every sprite the hall emits each frame (embers, dust, smoke,
// pedestal effects, glows). Immediate mode: begin() -> add() ... -> end().
import * as THREE from 'three';
import type { SpriteSink } from './kit';

export class Sprites implements SpriteSink {
  readonly mesh: THREE.Mesh;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly c: Float32Array;
  private readonly aAttr: THREE.InstancedBufferAttribute;
  private readonly bAttr: THREE.InstancedBufferAttribute;
  private readonly cAttr: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;
  private n = 0;
  /** Sprites dropped last frame because the buffer was full. */
  dropped = 0;

  constructor(readonly capacity: number, material: THREE.Material) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new Float32Array(capacity * 4); this.b = new Float32Array(capacity * 4); this.c = new Float32Array(capacity * 4);
    this.aAttr = new THREE.InstancedBufferAttribute(this.a, 4); this.bAttr = new THREE.InstancedBufferAttribute(this.b, 4); this.cAttr = new THREE.InstancedBufferAttribute(this.c, 4);
    for (const at of [this.aAttr, this.bAttr, this.cAttr]) at.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPosRot', this.aAttr); g.setAttribute('iSize', this.bAttr); g.setAttribute('iColor', this.cAttr);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  begin(): void { this.n = 0; this.dropped = 0; }

  add(x: number, y: number, z: number, sx: number, sy: number, rot: number, frame: number, mode: number, r: number, g: number, b: number, a: number): void {
    if (this.n >= this.capacity) { this.dropped++; return; }
    const i = this.n * 4;
    this.a[i] = x; this.a[i + 1] = y; this.a[i + 2] = z; this.a[i + 3] = rot;
    this.b[i] = sx; this.b[i + 1] = sy; this.b[i + 2] = frame; this.b[i + 3] = mode;
    this.c[i] = r; this.c[i + 1] = g; this.c[i + 2] = b; this.c[i + 3] = a;
    this.n++;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    for (const at of [this.aAttr, this.bAttr, this.cAttr]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * 4);
      at.needsUpdate = true;
    }
  }

  get count(): number { return this.n; }
  dispose(): void { this.geo.dispose(); }
}
