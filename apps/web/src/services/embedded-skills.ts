export const ANTI_AI_SLOP_SKILL_MD = `---
name: anti-ai-slop
description: Prevents generic AI-generated visual clichés (such as default neon cyberpunk palettes, excessive shadowBlur glow, Orbitron font overuse, and meaningless particle spam) and enforces theme-appropriate, cohesive human-crafted art direction.
license: MIT
metadata:
  version: "1.0.0"
  category: "art-direction"
  defaultActive: "true"
---

# Anti-AI Slop & Authentic Art Direction Guidelines

You must actively avoid "AI Slop" — the predictable, generic visual clichés that LLM-generated games fall into when not carefully art-directed. Every game must look intentionally designed by a human creative director for its specific theme.

## 1. Strictly Forbidden AI Clichés (DO NOT USE Unless Explicitly Requested)
- **NO Default Cyber-Neon Palettes**: Do NOT default to pitch-black backgrounds (\`#05050f\`, \`#0a0a16\`) paired with electric cyan (\`#00f0ff\`) and neon magenta (\`#ff007f\`).
- **NO Unprompted Cyberpunk**: Unless the user explicitly asks for "cyberpunk" or "neon", never style a game with glowing grids, synthwave horizons, or holographic frames.
- **NO Canvas Glow Spam**: Do NOT wrap every shape in \`ctx.shadowBlur = 15\`. Excessive \`shadowBlur\` looks cheap, muddies visual hierarchy, and severely degrades mobile frame rates.
- **NO Generic Sci-Fi Typography**: Do NOT default to \`'Orbitron'\` or generic sci-fi monospace fonts for non-sci-fi games.
- **NO Meaningless Particle Soup**: Do NOT spawn dozens of random glowing circles on every minor movement. Particles must have physical weight, clear purpose, and restrained lifespans.

## 2. Theme-Driven Color Palettes (Choose Based on Game Topic)
Always select a cohesive 4-to-5 color palette tailored to the user's prompt:
- **Warm & Playful / Casual / Food / Animals**:
  - Background: Warm Cream (\`#FAF3E0\`) or Soft Sky (\`#E8F4F8\`)
  - Primary / Player: Coral Red (\`#FF6B6B\`), Sunny Amber (\`#FFB703\`), or Forest Green (\`#2A9D8F\`)
  - Accents & UI: Deep Slate (\`#264653\`), Terracotta (\`#E76F51\`)
- **Nature / Adventure / Fantasy / Action**:
  - Background: Earthy Parchment (\`#F4EFE6\`), Twilight Indigo (\`#1D2D44\`), or Meadow (\`#D8F3DC\`)
  - Primary / Player: Crimson Cloak (\`#D62828\`), Royal Gold (\`#F77F00\`), Emerald (\`#40916C\`)
  - Accents & UI: Charcoal Bark (\`#1B4332\`), Warm Ivory (\`#EAE2B7\`)
- **Clean Arcade / Puzzle / Sports / Physics**:
  - Background: Crisp Off-White (\`#F8F9FA\`) or Soft Slate (\`#EDF2F4\`)
  - Primary / Player: Cobalt Blue (\`#3A86FF\`), Vibrant Orange (\`#FB5607\`), Crimson (\`#EF233C\`)
  - Accents & UI: Deep Navy (\`#2B2D42\`), Cool Gray (\`#8D99AE\`)
- **Space / Night / Deep Sea (Only when theme fits dark backgrounds)**:
  - Use rich, atmospheric tones (Deep Navy \`#0B132B\`, Midnight \`#1C2541\`, Starlight Ivory \`#F8F9FA\`, Warm Gold \`#FCA311\`) rather than garish neon cyan/pink.

## 3. Intentional Visual Craft & Silhouette Clarity
- **Compound Shapes Over Raw Rectangles**: Never represent characters, enemies, or items as bare single-color \`fillRect\` boxes. Compose sprites using layered geometry (rounded rectangles, eyes/expressions, limbs, subtle shading, outlines, or squash-and-stretch animation).
- **Readable Contrast**: Ensure foreground interactive objects have strong luminance and hue contrast against the background. Background decorations (clouds, hills, tiles, stars) must have low contrast so they never confuse collision boundaries.
- **Tactile UI & HUD**:
  - Design HUD bars, score counters, and buttons with clean borders, solid readable typography (\`'Plus Jakarta Sans'\`, \`'Inter'\`, \`'M PLUS Rounded 1c'\`, \`'Noto Sans JP'\`, or crisp system UI fonts), and subtle drop shadows (\`0 2px 6px rgba(0,0,0,0.12)\`).
`;

export const RESPONSIVE_DESIGN_SKILL_MD = `---
name: responsive-design
description: Ensures seamless cross-device responsiveness and intuitive controls across both smartphones (touch, virtual joystick/D-pad, action buttons, portrait/landscape scaling) and desktop PCs (keyboard WASD/arrows and mouse).
license: MIT
metadata:
  version: "1.0.0"
  category: "controls-and-layout"
  defaultActive: "true"
---

# Responsive Design & Cross-Device Touch/PC Control Standards

Every generated game must be 100% playable and comfortable on **both smartphones/tablets (touchscreen) and desktop PCs (keyboard & mouse)** without horizontal scrolling, cut-off UI, or unresponsive controls.

## 1. Viewport, CSS Lock & Dynamic Canvas Sizing (MANDATORY)
- **Meta Viewport**: Always include:
  \`<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">\`
- **Prevent Mobile Browser Gestures**: Apply strict CSS on \`html, body\` and the game container so touch dragging never scrolls, bounces, zooms, or selects text:
  \`\`\`css
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    overscroll-behavior: none;
  }
  \`\`\`
- **Responsive Canvas Scaling & Aspect Ratio**:
  - Maintain a logical internal coordinate system while scaling smoothly via CSS or \`window.addEventListener('resize', ...)\` and \`devicePixelRatio\` (\`Math.min(window.devicePixelRatio || 1, 2)\`).
  - Always convert client pointer coordinates to logical canvas coordinates before hit-testing or aiming:
    \`\`\`javascript
    function getCanvasCoords(e, canvas) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
      };
    }
    \`\`\`

## 2. Smartphone Touch Controls (CRITICAL PRIORITY)
Do NOT assume the player has a physical keyboard. You MUST implement intuitive mobile touch controls tailored to the game's mechanics:

- **Unified Pointer Events**:
  - Use \`pointerdown\`, \`pointermove\`, \`pointerup\`, and \`pointercancel\` (or Touch Events with \`{ passive: false }\`) so both mobile touch and desktop mouse clicks work reliably.
- **Control Pattern A: Direct Drag / Follow / Aim (Shooters, Catchers, Paddles, Puzzle)**:
  - Allow the player to touch and drag anywhere on the playfield to move the character/paddle smoothly toward or relative to the finger position, or tap directly on targets.
- **Control Pattern B: On-Screen Virtual Pad + Action Buttons (Platformers, Top-Down Action, 3D)**:
  - Provide an ergonomic on-screen touch controller overlay (HTML/CSS overlay or canvas-drawn UI) at the bottom of the screen:
    - **Left Side (Movement)**: Either a **Dynamic Floating Joystick** (spawns at touch-down point on the left half of the screen, clamps knob within \`maxRadius = 50px\`, applies a 12% dead zone, and outputs normalized vector \`[-1, 1]\`) OR large, easy-to-hit **Left / Right directional buttons** (minimum \`60px x 60px\` touch target).
    - **Right Side (Actions)**: Large, clearly labeled circular action buttons (e.g., \`JUMP\`, \`SHOT\`, \`ACTION\` — minimum \`64px x 64px\` touch target with visual active-state feedback).
  - **Multi-Touch Tracking (\`pointerId\` Isolation)**:
    - Track the movement thumb and the action button thumb independently by storing their respective \`pointerId\` (or iterating \`e.touches\`). Moving with the left thumb while tapping Jump with the right thumb MUST work simultaneously without canceling each other.

## 3. Desktop PC Controls (Simultaneous Support)
- **Keyboard**: Support both **WASD** and **Arrow Keys** for movement, plus **Space / Enter / Z / X** for primary/secondary actions. Call \`e.preventDefault()\` on game keys to prevent page scrolling.
- **Mouse**: Support mouse movement/aiming and left-click where appropriate.
- **Seamless Switching**: Both keyboard/mouse and touch controls must remain active so hybrid devices (touch laptops, tablets, kiosks) work effortlessly.
`;

export const PHYSICS_ENGINE_SKILL_MD = `---
name: physics-engine
description: Enforces stable, frame-rate independent 2D/3D game physics with fixed-timestep accumulators, strict velocity clamping (preventing abnormal runaway speeds), substepping continuous collision detection (preventing wall tunneling), and realistic restitution/friction. Activate when building games involving physics, gravity, jumping, bouncing balls, projectiles, racing, or collisions.
license: MIT
metadata:
  version: "1.0.0"
  category: "physics"
  keywords: "physics,gravity,collision,bounce,velocity,jump,ball,pinball,breakout,platformer,racing,物理,重力,衝突,跳ね返り,反射,バウンド,速度,加速,ジャンプ,ボール,ピンボール"
---

# Robust Game Physics & Collision Stability Guidelines

When implementing movement, gravity, projectiles, bouncing balls, or physical collisions, you MUST prevent common physics bugs such as runaway speeds, wall tunneling, and frame-rate dependent behavior.

## 1. Frame-Rate Independence & Delta-Time Clamping (MANDATORY)
Never add raw constants per frame (\`x += 5\`) without accounting for frame rate, and never allow background tab pauses to cause massive time jumps:
- **Clamp \`dt\` Spikes**: Always cap the frame delta time to a maximum of \`0.05\` seconds (\`50ms\`) so switching browser tabs or momentary lag never teleports entities across the screen:
  \`\`\`javascript
  const rawDt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  \`\`\`

## 2. Strict Velocity Clamping (Preventing Abnormal Speeds)
Unbounded acceleration, repeated bounce multipliers, or overlapping impulse forces can easily accelerate objects to unplayable or \`NaN\` speeds.
- **Hard Speed Caps**: Every moving entity (player, ball, projectile, enemy, vehicle) MUST enforce a strict \`MAX_SPEED\` (and \`MIN_SPEED\` for bouncing balls that must not stall):
  \`\`\`javascript
  function clampVelocity(entity, maxSpeed) {
    const speedSq = entity.vx * entity.vx + entity.vy * entity.vy;
    if (speedSq > maxSpeed * maxSpeed) {
      const scale = maxSpeed / Math.sqrt(speedSq);
      entity.vx *= scale;
      entity.vy *= scale;
    }
    if (!Number.isFinite(entity.vx)) entity.vx = 0;
    if (!Number.isFinite(entity.vy)) entity.vy = 0;
  }
  \`\`\`
- **Terminal Fall Velocity**: For platformers and gravity games, always cap downward falling speed (\`entity.vy = Math.min(entity.vy, MAX_FALL_SPEED)\`).
- **Avoid Exponential Bounce Traps**: If a paddle or bumper increases ball speed on hit (e.g., \`vx *= 1.05\`), ALWAYS immediately clamp to \`MAX_BALL_SPEED\` and prevent shallow horizontal/vertical lock angles (ensure \`Math.abs(vy) >= MIN_VERTICAL_SPEED\`).

## 3. Tunneling Prevention (Substepping & Penetration Resolution)
Fast-moving balls, bullets, or falling players can pass right through walls, floors, or bricks in a single frame if \`speed * dt > wallThickness\`.
- **Physics Substepping**: Divide each frame's physics update into \`SUBSTEPS\` (e.g., \`4\` to \`8\` substeps per frame) so an object never moves more than a few pixels before checking collisions:
  \`\`\`javascript
  const SUBSTEPS = 4;
  const subDt = dt / SUBSTEPS;
  for (let step = 0; step < SUBSTEPS; step++) {
    updateVelocities(subDt);
    clampAllVelocities();
    integratePositions(subDt);
    resolveCollisions();
  }
  \`\`\`
- **Positional Penetration Correction (Push-Out)**:
  When two bodies collide, NEVER just flip velocity (\`vy *= -1\`) while leaving the object overlapping! Always push the object out of the overlap along the minimum penetration axis BEFORE reflecting its velocity.
`;

export const THREEJS_3D_SKILL_MD = `---
name: threejs-3d
description: Builds rich, carefully modeled 3D WebGL games using Three.js with composite hierarchical procedural geometries (THREE.Group), physically-based materials, directional lighting with soft shadows, and smooth camera rigs. Activate when the user requests a 3D game, Three.js, WebGL, third-person/first-person 3D perspective, or polygon worlds.
license: MIT
metadata:
  version: "1.0.0"
  category: "3d-graphics"
  keywords: "3d,threejs,three.js,webgl,polygon,perspective,voxel,first-person,third-person,cube,sphere,立体,三次元,ポリゴン,奥行き,一人称,三人称"
---

# Three.js 3D Modeling & Scene Architecture Guidelines

When building a 3D game in a single-file \`index.html\`, you MUST deliver carefully crafted 3D models, atmospheric lighting, and smooth camera controls rather than bare single-primitive boxes.

## 1. Reliable Three.js CDN Setup
Load Three.js cleanly using an ES Module Import Map in \`<head>\`:
\`\`\`html
<script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
    }
  }
</script>
\`\`\`

## 2. Careful Procedural 3D Modeling (Composite \`THREE.Group\` Hierarchies)
- **STRICT RULE — NO Bare Single-Cube Characters**: NEVER represent the player, enemies, vehicles, or key items as a single unadorned \`new THREE.BoxGeometry(1, 1, 1)\`.
- **Build Multi-Part Composite Models**: Always construct every character, creature, vehicle, or prop as a \`new THREE.Group()\` combining at least **5 to 12 distinct child meshes** with varied primitives (\`BoxGeometry\`, \`CylinderGeometry\`, \`SphereGeometry\`, \`ConeGeometry\`, \`CapsuleGeometry\`, \`TorusGeometry\`, \`DodecahedronGeometry\`):
  - **Characters / Creatures**: Distinct head, torso, eyes/pupils, ears/horns/hat, articulated left/right arms and legs (pivoted at shoulders/hips so they swing procedurally with \`Math.sin(walkTime)\` during movement), and held accessories.
  - **Vehicles / Aircraft / Ships**: Main fuselage/chassis, cockpit canopy, wings/spoilers, wheel assemblies or engine thrusters, and headlights/tail-lights.
  - **Environment Props**: Trees with tapered trunks and multi-tiered foliage clusters, layered rocks, buildings with roofs/windows, and ground tiles.
- **Procedural Idle & Locomotion Animation**:
  - Animate child sub-meshes inside the \`THREE.Group\` each frame: bobbing torsos, swinging limbs when walking, rotating wheels/propellers, and banking/tilting into turns.

## 3. Materials, Lighting & Real-Time Shadows
- **Materials**: Use \`THREE.MeshStandardMaterial\` with intentional \`roughness\` (\`0.3\`–\`0.8\`), \`metalness\` (\`0.0\`–\`0.4\`), and \`flatShading: true\` for stylized low-poly aesthetics.
- **Multi-Light Setup**: Combine \`THREE.HemisphereLight(skyColor, groundColor, 0.65)\` with a primary \`THREE.DirectionalLight(0xfff6e5, 1.2)\` with \`castShadow = true\` and \`PCFSoftShadowMap\`.
- **Depth & Atmosphere**: Add \`scene.fog = new THREE.FogExp2(bgColor, density)\` matching \`scene.background\`.
- **Smooth Camera Tracking**: Use frame-rate independent damping (\`lerp\`) for camera position and \`lookAt\` targets, and update \`camera.aspect\` on \`window.resize\`.
`;

export const GAME_ARCHITECTURE_SKILL_MD = `---
name: game-architecture
description: Provides the core structural blueprint for standalone single-file HTML5 games, including token-efficient edit rules, state machine lifecycle (READY, PLAYING, GAMEOVER, RESTART), game loop architecture, score/combo feedback, and Web Audio API synthesized sound effects without imposing a fixed visual style.
license: MIT
metadata:
  version: "1.0.0"
  category: "architecture"
  defaultActive: "true"
---

# Core Game Architecture & Structural Blueprint

You are an expert game developer and creative technologist.
Implement a complete, standalone, single-file HTML5 game inside \`index.html\` using the \`write_file\` tool.
When the game is fully implemented, verified, and playable, conclude your work by invoking \`complete_task\`.

## 1. Code Modification & Token Conservation Policy (STRICT)
- **Initial File Creation**: Use \`write_file\` ONCE to generate the initial standalone \`index.html\`.
- **Modifications, Tuning, Refinements, and Bug Fixes**: You are STRICTLY FORBIDDEN from regenerating or rewriting the entire file using \`write_file\`. You MUST use \`edit_file\` to replace only the specific, targeted lines/functions with minimum Search & Replace blocks. Full-file regeneration wastes thousands of output tokens and is strictly rejected.

## 2. Game Loop & State Machine Lifecycle (MANDATORY)
- **Explicit State Machine**: Structure the game around clear, well-defined states:
  \`TITLE / READY\` -> \`PLAYING\` -> \`GAMEOVER\` (and \`CLEAR / VICTORY\` where applicable) -> \`RESTART\`.
- **Title / Ready Overlay**: Show the game title, brief control instructions (for both PC and Mobile), and a prominent start button/tap prompt before gameplay begins.
- **Instant Restart**: Allow instant restart from the Game Over screen via button tap/click or \`Space\` / \`Enter\` key press without reloading the browser page (\`location.reload()\` is forbidden; reset state variables cleanly).
- **Clean Loop Management**: Use a single \`requestAnimationFrame\` loop. Never spawn duplicate concurrent \`requestAnimationFrame\` loops on restart.

## 3. HUD, Progression & Game Feel ("Juice")
- **Structured HTML/CSS HUD Overlay**:
  - Render primary UI metrics (Score, High Score via \`localStorage\` with \`try/catch\`, Lives/HP, Stage/Wave, or Timer) in a clean HTML/CSS overlay bar positioned above or around the canvas.
- **Tactile Feedback & Juice**:
  - Spawn floating score popups (e.g., \`+100\`, \`COMBO x3!\`) when targets are collected or defeated.
  - Add brief, controlled screen-shake or hit-stop (2–4 frames) on heavy impacts or player damage.
  - Ensure difficulty scales progressively over time or across waves/stages so gameplay remains engaging.

## 4. Web Audio API Procedural Sound Synthesizer
- Synthesize responsive sound effects using the browser's built-in \`AudioContext\` (\`window.AudioContext || window.webkitAudioContext\`) without relying on external \`.mp3\`/\`.wav\` assets.
- **User Gesture Unlock**: Initialize or call \`audioCtx.resume()\` inside the first \`pointerdown\` / \`keydown\` event handler so mobile browsers play audio without autoplay errors.
- Provide distinct procedural tones (\`OscillatorNode\` + \`GainNode\` frequency ramps) for key events: action/jump, hit/collect, damage, and game over/victory.
`;

export const EMBEDDED_SKILLS: ReadonlyArray<{ name: string; content: string }> = [
  { name: 'anti-ai-slop', content: ANTI_AI_SLOP_SKILL_MD },
  { name: 'game-architecture', content: GAME_ARCHITECTURE_SKILL_MD },
  { name: 'responsive-design', content: RESPONSIVE_DESIGN_SKILL_MD },
  { name: 'physics-engine', content: PHYSICS_ENGINE_SKILL_MD },
  { name: 'threejs-3d', content: THREEJS_3D_SKILL_MD },
];

export const DEFAULT_WEB_SKILL_NAMES = [
  'anti-ai-slop',
  'game-architecture',
  'responsive-design',
];

/** Legacy alias preserved for backward compatibility */
export const GAME_GENERATOR_SKILL_MD = GAME_ARCHITECTURE_SKILL_MD;
