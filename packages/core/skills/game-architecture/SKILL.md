---
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
Implement a complete, standalone, single-file HTML5 game inside `index.html` using the `write_file` tool.
When the game is fully implemented, verified, and playable, conclude your work by invoking `complete_task`.

## 1. Code Modification & Token Conservation Policy (STRICT)
- **Direct Initial Creation (No Redundant `list_files`)**: Start by calling `write_file("index.html", content)` ONCE on your very first turn to generate the complete standalone game. Do NOT waste a turn calling `list_files` on an empty workspace.
- **No Shell / Node Commands (`run_command` Forbidden for VFS HTML)**: Because files reside in an in-memory Virtual File System (VFS), external shell commands (`node -e`, `fs.readFileSync`, etc.) cannot access VFS files and will return empty output. NEVER call `run_command` to syntax-check `index.html`. After `write_file` succeeds, immediately call `complete_task`!
- **Modifications, Tuning, Refinements, and Bug Fixes**: You are STRICTLY FORBIDDEN from regenerating or rewriting the entire file using `write_file`. You MUST use `edit_file` to replace only the specific, targeted lines/functions with minimum Search & Replace blocks. Full-file regeneration wastes thousands of output tokens and is strictly rejected.

## 2. Game Loop & State Machine Lifecycle (MANDATORY)
- **Explicit State Machine**: Structure the game around clear, well-defined states:
  `TITLE / READY` -> `PLAYING` -> `GAMEOVER` (and `CLEAR / VICTORY` where applicable) -> `RESTART`.
- **Title / Ready Overlay**: Show the game title, brief control instructions (for both PC and Mobile), and a prominent start button/tap prompt before gameplay begins.
- **Instant Restart**: Allow instant restart from the Game Over screen via button tap/click or `Space` / `Enter` key press without reloading the browser page (`location.reload()` is forbidden; reset state variables cleanly).
- **Clean Loop Management**: Use a single `requestAnimationFrame` loop. Never spawn duplicate concurrent `requestAnimationFrame` loops on restart.

## 3. HUD, Progression & Game Feel ("Juice")
- **Structured HTML/CSS HUD Overlay**:
  - Render primary UI metrics (Score, High Score via `localStorage` with `try/catch`, Lives/HP, Stage/Wave, or Timer) in a clean HTML/CSS overlay bar positioned above or around the canvas.
- **Tactile Feedback & Juice**:
  - Spawn floating score popups (e.g., `+100`, `COMBO x3!`) when targets are collected or defeated.
  - Add brief, controlled screen-shake or hit-stop (2–4 frames) on heavy impacts or player damage.
  - Ensure difficulty scales progressively over time or across waves/stages so gameplay remains engaging.

## 4. Web Audio API Procedural Sound Synthesizer
- Synthesize responsive sound effects using the browser's built-in `AudioContext` (`window.AudioContext || window.webkitAudioContext`) without relying on external `.mp3`/`.wav` assets.
- **User Gesture Unlock**: Initialize or call `audioCtx.resume()` inside the first `pointerdown` / `keydown` event handler so mobile browsers play audio without autoplay errors.
- Provide distinct procedural tones (`OscillatorNode` + `GainNode` frequency ramps) for key events: action/jump, hit/collect, damage, and game over/victory.
