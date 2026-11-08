---
name: physics-engine
description: Enforces stable, frame-rate independent 2D/3D game physics with fixed-timestep accumulators, strict velocity clamping (preventing abnormal runaway speeds), substepping continuous collision detection (preventing wall tunneling), and realistic restitution/friction. Activate when building games involving physics, gravity, jumping, bouncing balls, projectiles, racing, or collisions.
license: MIT
metadata:
  version: "1.0.0"
  category: "physics"
  keywords: "physics,gravity,collision,bounce,velocity,jump,ball,pinball,breakout,platformer,racing,drift,turbo,kart,物理,重力,衝突,跳ね返り,反射,バウンド,速度,加速,ジャンプ,ボール,ピンボール,ドリフト,ターボ,レース,カート"
---

# Robust Game Physics & Collision Stability Guidelines

When implementing movement, gravity, projectiles, bouncing balls, or physical collisions, you MUST prevent common physics bugs such as runaway speeds, wall tunneling, and frame-rate dependent behavior.

## 1. Frame-Rate Independence & Delta-Time Clamping (MANDATORY)
Never add raw constants per frame (`x += 5`) without accounting for frame rate, and never allow background tab pauses to cause massive time jumps:
- **Clamp `dt` Spikes**: Always cap the frame delta time to a maximum of `0.05` seconds (`50ms`) so switching browser tabs or momentary lag never teleports entities across the screen:
  ```javascript
  const rawDt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  ```
- **Fixed Timestep Accumulator (Recommended for Physics-Heavy Games)**:
  Run physics integration at a deterministic fixed step (`FIXED_DT = 1 / 60`) using an accumulator so behavior is identical on 60Hz, 120Hz, and 144Hz displays.

## 2. Strict Velocity Clamping (Preventing Abnormal Speeds)
Unbounded acceleration, repeated bounce multipliers, or overlapping impulse forces can easily accelerate objects to unplayable or `NaN` speeds.
- **Hard Speed Caps**: Every moving entity (player, ball, projectile, enemy, vehicle) MUST enforce a strict `MAX_SPEED` (and `MIN_SPEED` for bouncing balls that must not stall):
  ```javascript
  function clampVelocity(entity, maxSpeed) {
    const speedSq = entity.vx * entity.vx + entity.vy * entity.vy;
    if (speedSq > maxSpeed * maxSpeed) {
      const scale = maxSpeed / Math.sqrt(speedSq);
      entity.vx *= scale;
      entity.vy *= scale;
    }
    // Guard against NaN / Infinity
    if (!Number.isFinite(entity.vx)) entity.vx = 0;
    if (!Number.isFinite(entity.vy)) entity.vy = 0;
  }
  ```
- **Terminal Fall Velocity**: For platformers and gravity games, always cap downward falling speed (`entity.vy = Math.min(entity.vy, MAX_FALL_SPEED)`).
- **Avoid Exponential Bounce Traps**: If a paddle or bumper increases ball speed on hit (e.g., `vx *= 1.05`), ALWAYS immediately clamp to `MAX_BALL_SPEED` and prevent shallow horizontal/vertical lock angles (ensure `Math.abs(vy) >= MIN_VERTICAL_SPEED`).

## 3. Tunneling Prevention (Substepping & Penetration Resolution)
Fast-moving balls, bullets, or falling players can pass right through walls, floors, or bricks in a single frame if `speed * dt > wallThickness`.
- **Physics Substepping**: Divide each frame's physics update into `SUBSTEPS` (e.g., `4` to `8` substeps per frame) so an object never moves more than a few pixels before checking collisions:
  ```javascript
  const SUBSTEPS = 4;
  const subDt = dt / SUBSTEPS;
  for (let step = 0; step < SUBSTEPS; step++) {
    updateVelocities(subDt);
    clampAllVelocities();
    integratePositions(subDt);
    resolveCollisions();
  }
  ```
- **Positional Penetration Correction (Push-Out)**:
  When two bodies collide (e.g., ball vs. paddle/wall, player vs. platform), NEVER just flip velocity (`vy *= -1`) while leaving the object overlapping! If it remains overlapping on the next step, it will flip velocity again and get stuck vibrating inside the wall.
  - Always push the object out of the overlap along the minimum penetration axis BEFORE reflecting its velocity:
    ```javascript
    // Example: Ball hitting right wall
    if (ball.x + ball.radius > width) {
      ball.x = width - ball.radius; // Push out first!
      ball.vx = -Math.abs(ball.vx) * restitution;
    }
    ```

## 4. Natural Feel: Friction, Damping & Restitution
- Apply smooth exponential damping (`vx *= Math.pow(friction, dt * 60)`) for top-down movement and air resistance.
- Use realistic restitution (`0.6` to `0.95`) for elastic bounces, and zero out micro-bounces on resting surfaces (`if (Math.abs(vy) < 15) vy = 0`) to prevent endless ground jitter.
