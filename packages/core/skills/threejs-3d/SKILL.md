---
name: threejs-3d
description: Builds rich, carefully modeled 3D WebGL games using Three.js with composite hierarchical procedural geometries (THREE.Group), physically-based materials, directional lighting with soft shadows, and smooth camera rigs. Activate when the user requests a 3D game, Three.js, WebGL, third-person/first-person 3D perspective, or polygon worlds.
license: MIT
metadata:
  version: "1.0.0"
  category: "3d-graphics"
  keywords: "3d,threejs,three.js,webgl,polygon,perspective,voxel,first-person,third-person,cube,sphere,立体,三次元,ポリゴン,奥行き,一人称,三人称"
---

# Three.js 3D Modeling & Scene Architecture Guidelines

When building a 3D game in a single-file `index.html`, you MUST deliver carefully crafted 3D models, atmospheric lighting, and smooth camera controls rather than bare single-primitive boxes.

## 1. Reliable Three.js CDN Setup
Load Three.js cleanly using an ES Module Import Map or reliable CDN script in `<head>`:
```html
<script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
    }
  }
</script>
```

## 2. Careful Procedural 3D Modeling (Composite `THREE.Group` Hierarchies)
- **STRICT RULE — NO Bare Single-Cube Characters**: NEVER represent the player, enemies, vehicles, or key items as a single unadorned `new THREE.BoxGeometry(1, 1, 1)`.
- **Build Multi-Part Composite Models**: Always construct every character, creature, vehicle, or prop as a `new THREE.Group()` combining at least **5 to 12 distinct child meshes** with varied primitives (`BoxGeometry`, `CylinderGeometry`, `SphereGeometry`, `ConeGeometry`, `CapsuleGeometry`, `TorusGeometry`, `DodecahedronGeometry`):
  - **Characters / Creatures**: Distinct head, torso, eyes/pupils, ears/horns/hat, articulated left/right arms and legs (pivoted at shoulders/hips so they swing procedurally with `Math.sin(walkTime)` during movement), and held accessories.
  - **Vehicles / Aircraft / Ships**: Main fuselage/chassis, cockpit canopy (semi-transparent or contrasting material), wings/spoilers, wheel assemblies or engine thrusters, and headlights/tail-lights.
  - **Environment Props**: Trees with tapered trunks and multi-tiered foliage clusters (`ConeGeometry` / `DodecahedronGeometry`), layered rocks with vertex perturbation, buildings with roofs/windows/doors, and ground tiles/paths.
- **Procedural Idle & Locomotion Animation**:
  - Animate child sub-meshes inside the `THREE.Group` each frame: bobbing torsos, swinging limbs when walking, rotating wheels/propellers, banking/tilting into turns (`group.rotation.z = THREE.MathUtils.lerp(...)`), and recoil/squash-and-stretch on jump or attack.

## 3. Materials, Lighting & Real-Time Shadows
- **Materials**: Use `THREE.MeshStandardMaterial` or `THREE.MeshLambertMaterial` with intentional `roughness` (`0.3`–`0.8`), `metalness` (`0.0`–`0.4`), and `flatShading: true` when going for a crisp stylized low-poly aesthetic.
- **Multi-Light Setup**:
  - Combine `THREE.HemisphereLight(skyColor, groundColor, 0.65)` (natural sky/ground ambient bounce) with a primary `THREE.DirectionalLight(0xfff6e5, 1.2)` positioned at an angle (e.g., `(20, 35, 20)`).
- **Soft Shadows**:
  - Enable `renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;`.
  - Configure `dirLight.castShadow = true` with `mapSize` (`1024` or `2048`), properly sized orthodontic shadow camera bounds (`left/right/top/bottom = ±30`), and `shadow.bias = -0.0005`.
  - Set `castShadow = true` and `receiveShadow = true` on all composite model meshes and terrain.
- **Depth & Atmosphere**: Add `scene.fog = new THREE.FogExp2(bgColor, density)` or `THREE.Fog` matching `scene.background` to create depth and hide far-plane clipping.

## 4. Camera Rig, Controls & Performance
- **Smooth Camera Tracking**: Use frame-rate independent damping (`THREE.MathUtils.damp` or `lerp`) for camera position and `lookAt` targets so camera motion feels cinematic and never jerky.
- **Geometry & Material Reuse**: Instantiate shared `Geometry` and `Material` instances outside loops when spawning multiple obstacles, coins, particles, or trees to maintain a locked 60 FPS on mobile GPUs.
- **Responsive Resize**: Always update `camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);` on `window.resize`.
