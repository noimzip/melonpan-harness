---
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
  `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">`
- **Prevent Mobile Browser Gestures**: Apply strict CSS on `html, body` and the game container so touch dragging never scrolls, bounces, zooms, or selects text:
  ```css
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
  ```
- **Responsive Canvas Scaling & Aspect Ratio**:
  - Maintain a logical internal coordinate system (e.g., `800x600` or dynamic aspect-aware dimensions) while scaling smoothly via CSS or `window.addEventListener('resize', ...)` and `devicePixelRatio` (`Math.min(window.devicePixelRatio || 1, 2)`).
  - Always convert client pointer coordinates to logical canvas coordinates before hit-testing or aiming:
    ```javascript
    function getCanvasCoords(e, canvas) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
      };
    }
    ```

## 2. Smartphone Touch Controls (CRITICAL PRIORITY)
Do NOT assume the player has a physical keyboard. You MUST implement intuitive mobile touch controls tailored to the game's mechanics:

- **Unified Pointer Events**:
  - Use `pointerdown`, `pointermove`, `pointerup`, and `pointercancel` (or Touch Events with ` { passive: false }`) so both mobile touch and desktop mouse clicks work reliably.
- **Control Pattern A: Direct Drag / Follow / Aim (Shooters, Catchers, Paddles, Puzzle)**:
  - Allow the player to touch and drag anywhere on the playfield to move the character/paddle smoothly toward or relative to the finger position, or tap directly on targets.
- **Control Pattern B: On-Screen Virtual Pad + Action Buttons (Platformers, Top-Down Action, 3D)**:
  - Provide an ergonomic on-screen touch controller overlay (HTML/CSS overlay or canvas-drawn UI) at the bottom of the screen:
    - **Left Side (Movement)**: Either a **Dynamic Floating Joystick** (spawns at touch-down point on the left half of the screen, clamps knob within `maxRadius = 50px`, applies a 12% dead zone, and outputs normalized vector `[-1, 1]`) OR large, easy-to-hit **Left / Right directional buttons** (minimum `60px x 60px` touch target).
    - **Right Side (Actions)**: Large, clearly labeled circular action buttons (e.g., `JUMP`, `SHOT`, `ACTION` — minimum `64px x 64px` touch target with visual active-state feedback).
  - **Multi-Touch Tracking (`pointerId` Isolation)**:
    - Track the movement thumb and the action button thumb independently by storing their respective `pointerId` (or iterating `e.touches`). Moving with the left thumb while tapping Jump with the right thumb MUST work simultaneously without canceling each other.

## 3. Desktop PC Controls (Simultaneous Support)
- **Keyboard**: Support both **WASD** and **Arrow Keys** for movement, plus **Space / Enter / Z / X** for primary/secondary actions. Call `e.preventDefault()` on game keys to prevent page scrolling.
- **Mouse**: Support mouse movement/aiming and left-click where appropriate.
- **Seamless Switching**: Both keyboard/mouse and touch controls must remain active so hybrid devices (touch laptops, tablets, kiosks) work effortlessly.

## 4. Responsive HUD & Safe Areas
- Keep HUD elements (Score, HP/Lives, Stage, Pause/Restart buttons) compact and anchored with `clamp()` font sizes (`font-size: clamp(14px, 2.5vw, 20px)`).
- Ensure on-screen touch controls at the bottom do not obscure critical gameplay areas on narrow portrait screens.
