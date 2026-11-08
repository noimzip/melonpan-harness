---
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
- **NO Default Cyber-Neon Palettes**: Do NOT default to pitch-black backgrounds (`#05050f`, `#0a0a16`) paired with electric cyan (`#00f0ff`) and neon magenta (`#ff007f`).
- **NO Unprompted Cyberpunk**: Unless the user explicitly asks for "cyberpunk" or "neon", never style a game with glowing grids, synthwave horizons, or holographic frames.
- **NO Canvas Glow Spam**: Do NOT wrap every shape in `ctx.shadowBlur = 15`. Excessive `shadowBlur` looks cheap, muddies visual hierarchy, and severely degrades mobile frame rates.
- **NO Generic Sci-Fi Typography**: Do NOT default to `'Orbitron'` or generic sci-fi monospace fonts for non-sci-fi games.
- **NO Meaningless Particle Soup**: Do NOT spawn dozens of random glowing circles on every minor movement. Particles must have physical weight, clear purpose, and restrained lifespans.

## 2. Theme-Driven Color Palettes (Choose Based on Game Topic)
Always select a cohesive 4-to-5 color palette tailored to the user's prompt:
- **Warm & Playful / Casual / Food / Animals**:
  - Background: Warm Cream (`#FAF3E0`) or Soft Sky (`#E8F4F8`)
  - Primary / Player: Coral Red (`#FF6B6B`), Sunny Amber (`#FFB703`), or Forest Green (`#2A9D8F`)
  - Accents & UI: Deep Slate (`#264653`), Terracotta (`#E76F51`)
- **Nature / Adventure / Fantasy / Action**:
  - Background: Earthy Parchment (`#F4EFE6`), Twilight Indigo (`#1D2D44`), or Meadow (`#D8F3DC`)
  - Primary / Player: Crimson Cloak (`#D62828`), Royal Gold (`#F77F00`), Emerald (`#40916C`)
  - Accents & UI: Charcoal Bark (`#1B4332`), Warm Ivory (`#EAE2B7`)
- **Clean Arcade / Puzzle / Sports / Physics**:
  - Background: Crisp Off-White (`#F8F9FA`) or Soft Slate (`#EDF2F4`)
  - Primary / Player: Cobalt Blue (`#3A86FF`), Vibrant Orange (`#FB5607`), Crimson (`#EF233C`)
  - Accents & UI: Deep Navy (`#2B2D42`), Cool Gray (`#8D99AE`)
- **Space / Night / Deep Sea (Only when theme fits dark backgrounds)**:
  - Use rich, atmospheric tones (Deep Navy `#0B132B`, Midnight `#1C2541`, Starlight Ivory `#F8F9FA`, Warm Gold `#FCA311`) rather than garish neon cyan/pink.

## 3. Intentional Visual Craft & Silhouette Clarity
- **Compound Shapes Over Raw Rectangles**: Never represent characters, enemies, or items as bare single-color `fillRect` boxes. Compose sprites using layered geometry (rounded rectangles, eyes/expressions, limbs, subtle shading, outlines, or squash-and-stretch animation).
- **Readable Contrast**: Ensure foreground interactive objects have strong luminance and hue contrast against the background. Background decorations (clouds, hills, tiles, stars) must have low contrast so they never confuse collision boundaries.
- **Tactile UI & HUD**:
  - Design HUD bars, score counters, and buttons with clean borders, solid readable typography (`'Plus Jakarta Sans'`, `'Inter'`, `'M PLUS Rounded 1c'`, `'Noto Sans JP'`, or crisp system UI fonts), and subtle drop shadows (`0 2px 6px rgba(0,0,0,0.12)`).
  - Avoid slapdash transparent text floating over busy gameplay areas.
