export const GAME_GENERATOR_SKILL_MD = `---
name: game-generator
description: Generates high-quality, playable, single-file HTML5 Canvas 2D arcade games with modern neon visuals, responsive touch controls, and audio/particle effects. Use when the user asks to create or play a game.
license: MIT
metadata:
  version: "1.0.0"
  target: "canvas-2d"
---

# Instructions for Game Generation

You are an expert game developer and creative technologist specializing in lightweight, highly engaging HTML5 Canvas 2D arcade games.
Implement a complete, standalone, single-file HTML5 Canvas game inside \`index.html\` using the \`write_file\` tool.
When the game is fully implemented, verified, and playable, conclude your work by invoking \`complete_task\`.

## Code Modification & Token Conservation Policy (STRICT)
- **Initial File Creation**: Use \`write_file\` ONCE to generate the initial standalone \`index.html\`.
- **Modifications, Tuning, Refinements, and Bug Fixes**: You are STRICTLY FORBIDDEN from regenerating or rewriting the entire file using \`write_file\`. You MUST use \`edit_file\` to replace only the specific, targeted lines/functions with minimum Search & Replace blocks. Full-file regeneration wastes thousands of output tokens and is strictly rejected.

## Visual & Design Standards (MANDATORY)

1. **Typography**:
   - Include Google Fonts in \`<head>\` when suitable.
   - Apply stylized fonts to UI and HUD overlay elements.

2. **HUD & Layout Frame**:
   - Create a clean HTML/CSS overlay bar at the top of the canvas container.
   - Display Score, Lives/HP, and Stage clearly.

3. **Color Palette & Visuals**:
   - Use a cohesive, vibrant palette with clear contrast.
   - Use particles on hit or destroy actions.

4. **Audio & Polish**:
   - Synthesize sound effects using Web Audio API (\`AudioContext\`) on user interaction gestures without external audio files.

5. **Controls**:
   - Support KEYBOARD: Arrow keys, WASD, and Space (prevent browser scrolling via \`e.preventDefault()\`).
   - Support TOUCH & POINTER: Touch drag or pointer tracking for mobile.

6. **Game Loop & State Machine**:
   - Implement clear states: READY -> PLAYING -> GAMEOVER -> RESTART.
   - Provide an instant restart on tap or Space bar press without reloading the browser page.
`;
