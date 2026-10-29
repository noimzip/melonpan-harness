# AGENTS.md — Instructions for AI Coding Agents

> **Melonpan Harness**: Headless event-driven ReAct agent harness (`@melonpan/core`) and Claude Code-style Ink TUI client (`@melonpan/cli`) for progressive HTML5 game generation and interactive demonstrations.

---

## 1. Project Overview & Architecture

### Purpose
Melonpan is an autonomous coding agent harness that transforms short natural language prompts (e.g., *"Neon cyber block breaker with particle effects"*, *"Space jump action game"*) into complete, single-file HTML5 Canvas 2D arcade games (`index.html`) using a ReAct autonomous loop, in-memory Virtual File System (VFS), and modular Agent Skills conforming to the [Agent Skills standard (agentskills.io)](https://agentskills.io).

### Monorepo Structure
This repository is managed with **pnpm workspaces**:

```text
melonpan-harness/
├── AGENTS.md                   # This instruction file for AI agents
├── README.md                   # High-level overview
├── package.json                # Monorepo root scripts & dev dependencies
├── pnpm-workspace.yaml         # Workspace definitions (packages/*, apps/*)
├── tsconfig.base.json          # Shared TypeScript configuration (ES2022, NodeNext)
├── packages/
│   └── core/                   # @melonpan/core: Headless ReAct agent harness
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── skills/             # Agent Skills standard compliant skills
│       │   └── game-generator/
│       │       └── SKILL.md    # Arcade game generation skill instructions & guidelines
│       ├── agents/             # Clean-room subagent personas
│       │   ├── researcher.md   # Architectural & algorithmic research persona
│       │   └── code-reviewer.md # Security, performance & UI auditor persona
│       └── src/
│           ├── types.ts        # Universal streaming events, models & payload types
│           ├── index.ts        # MelonpanCore facade class
│           ├── react-agent.ts  # Central ReAct loop, context pruner & usage tracker
│           ├── skills/         # SkillManager (Progressive Disclosure) & SkillParser
│           ├── subagents/      # SubagentRunner (Clean-Room isolation)
│           ├── tools/          # Tool definitions (write_file, edit_file, complete_task, dispatch_subagent)
│           └── vfs/            # VirtualFS (in-memory Map<string, string>)
└── apps/
    └── cli/                    # @melonpan/cli: Claude Code-like Ink TUI client
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── index.tsx       # CLI launcher & argument parser
            ├── app.tsx         # Root Ink application component
            ├── commands/       # Slash command subsystem
            │   ├── types.ts    # CommandDefinition, CommandContext, CommandSuggestion
            │   ├── registry.ts # CommandRegistry & prefix autocomplete generator
            │   └── handlers/   # 9 modular command handlers: key, model, effort, plan, clear, export, skills, cost, help
            └── components/     # UI widgets: header, input-bar, command-suggest, event-list, modal-picker, plan-viewer
```

---

## 2. Setup, Build & Test Commands

### Prerequisites
- **Node.js**: $\ge 20$ (Node 24 recommended).
- **Package Manager**: `pnpm` $\ge 9$ (pnpm workspaces). If `pnpm` is not in `$PATH`, activate it via `corepack enable`.

### Essential Commands

| Action | Command | Notes |
| :--- | :--- | :--- |
| **Enable pnpm** | `corepack enable` | Required if `pnpm` command is missing in subshell |
| **Install dependencies** | `pnpm install` | Install all workspace packages |
| **Build all packages** | `pnpm build` | Builds `@melonpan/core` and `@melonpan/cli` |
| **Run all tests** | `pnpm test` | Runs Vitest across all workspaces (**11 files, 59 tests**) |
| **Run core tests only** | `pnpm --filter @melonpan/core test` | Runs 10 test files (39 tests) in `@melonpan/core` |
| **Run CLI tests only** | `pnpm --filter @melonpan/cli test` | Runs command registry and autocomplete tests (20 tests) |
| **Launch TUI Client** | `pnpm tui` | Starts the interactive Ink terminal UI |
| **Run simulation demo**| `pnpm demo` | Deterministic offline test run without Gemini API key |
| **Run plan mode demo** | `pnpm demo:plan` | Offline demonstration of Plan Mode |

---

## 3. Core Architecture & Mental Model

### A. Agent Skills Standard & Progressive Disclosure (`agentskills.io`)
- Skills are stored in `packages/core/skills/<skill-name>/SKILL.md`.
- Each `SKILL.md` contains strict YAML Frontmatter (`name`, `description`, `license`, `metadata`) separated from Markdown instructions.
- **Progressive Disclosure**:
  1. At initialization, `SkillManager` scans and indexes *only the frontmatter metadata* (`name`, `description`) into memory.
  2. When the user submits a prompt, `SkillManager.matchSkill(prompt)` dynamically evaluates relevance.
  3. Only the selected skill's full Markdown instructions are loaded into the system prompt.
  4. If no specialized skill matches, `SkillManager` provides a built-in **Generalist Mode** prompt.

### B. ReAct Autonomous Loop (`packages/core/src/react-agent.ts`)
- Powered by Google Gemini API (`@google/genai`) Function Calling.
- Execution lifecycle follows `Thought` $\rightarrow$ `Action` (tool call) $\rightarrow$ `Observation` (tool result) $\rightarrow$ `Next Thought`.
- **Max Turns**: Default `maxTurns = 100` to allow complex multi-step generation and debugging without premature cutoff.
- **Streaming Event Architecture**: Emits typed `AgentEvent` objects via an `AsyncGenerator`:
  `SKILL_INDEXED` $\rightarrow$ `SKILL_LOADED` $\rightarrow$ `PLAN_STARTED` / `PLAN_CREATED` $\rightarrow$ `CONTEXT_PRUNED` $\rightarrow$ `THOUGHT` $\rightarrow$ `TOOL_CALL` $\rightarrow$ `FILE_CHANGED` $\rightarrow$ `TOOL_RESULT` $\rightarrow$ `USAGE` $\rightarrow$ `COMPLETE`.

### C. Token Optimization & Context Pruning (Crucial)
To avoid exponential token inflation across 20+ turns, two optimizations are strictly enforced:
1. **`pruneChatHistory()`**:
   - Before sending history to the Gemini API (`sendMessage`), the agent inspects past turns.
   - Any past `write_file` tool call containing code $\ge 200$ characters is masked to `<Content preserved in VFS: N chars>`.
   - Result: Input tokens remain flat (saving 70–80% input token cost) while the LLM retains knowledge of having written the file.
2. **Diff Enforcement (`edit_file`)**:
   - For file updates or fixes, the system forbids `write_file` rewrites.
   - The agent must use `edit_file` (Search & Replace) for localized changes.

### D. Clean-Room Sub-agent Isolation (`packages/core/src/subagents/`)
- Main agent delegates specialized subtasks via `dispatch_subagent(agent_type, task_prompt)`.
- Available Subagents:
  - `researcher` (`packages/core/agents/researcher.md`): Investigates physics formulas, collision detection, and Web APIs.
  - `code-reviewer` (`packages/core/agents/code-reviewer.md`): Multi-perspective audit for performance (60fps, particle pooling), security, and cyber-neon visual standards.
- **Clean-Room Guarantee**:
  - The subagent runs in a completely separate chat session.
  - It does **NOT** inherit the parent's noisy trial-and-error chat history.
  - It receives only the current target file content from VFS and the specific `task_prompt`.
  - Its output is condensed into an actionable summary (100–200 tokens) returned to the parent agent.

### E. In-Memory Virtual File System (`packages/core/src/vfs/`)
- All files generated or edited by the agent are held in a `Map<string, string>` via `VirtualFS`.
- Zero disk pollution occurs during reasoning and generation loops.
- File export to disk occurs only upon explicit user request (e.g. `/export` in TUI or programmatic export).

### F. Ink TUI & Slash Command System (`apps/cli/`)
- Built with [Ink](https://github.com/vadimdemedes/ink) (React 19 for terminal interfaces).
- **9 Active Slash Commands**:
  - `/key`: Interactive API key configuration (`/key <key>`, `/key save <key>`, `/key status`).
  - `/model`: Switch model (`gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-4-argon`, `gemma-4-31b-it`).
  - `/effort`: Change thinking level (`minimal`, `low`, `medium`, `high`).
  - `/plan`: Toggle or execute Plan Mode (researches and writes `plan.md` before coding).
  - `/clear`: Clear terminal history and reset session VFS.
  - `/export`: Export VFS files to real disk (default: `./output/`).
  - `/skills`: List, inspect, enable, or disable skills.
  - `/cost`: Display cumulative session token consumption and estimated cost (USD / JPY).
  - `/help`: Show formatted command reference and usage guide.
- **Real-time Autocomplete Overlay (`command-suggest.tsx`)**:
  - Automatically pops up as the user types `/`.
  - Supports incremental fuzzy prefix filtering and tab/enter selection.

## 4. Critical Guardrails & Rules of Engagement

When modifying this repository, AI agents **MUST** obey the following rules:

### ⛔ NEVER Do This
1. **Never use CommonJS or omit `.js` in relative imports**:
   - The project uses TypeScript `NodeNext` ESM (`"module": "NodeNext"`).
   - All internal relative imports MUST include the `.js` extension (e.g. `import { VirtualFS } from './vfs/virtual-fs.js';`).
2. **Never hardcode or commit API keys**:
   - Always read `GEMINI_API_KEY` from environment variables or through the `/key` command handler.
   - When displaying keys in UI or logs, always mask them (e.g., `...${key.slice(-4)}`).
3. **Never bypass `VirtualFS` to perform direct disk I/O in `@melonpan/core`**:
   - Core generation, execution, and subagents must operate exclusively through `vfs.writeFile()` and `vfs.editFile()`.
4. **Never disable or bypass Context Pruning (`pruneChatHistory`)**:
   - Without pruning, multi-turn game generation quickly exceeds context window limits and burns excessive API quota.
5. **Never break existing tests**:
   - Always run `pnpm test` before concluding work. All 59 tests across 11 test files must pass.
6. **Never commit generated artifacts or sensitive files**:
   - `index.html`, `plan.md`, `generated-game.html`, `.env`, and `.env.*` are in `.gitignore`. Do not use `git add -f` to track them.

---

## 5. Extensibility Recipes

### Recipe 1: Adding a New Slash Command to `apps/cli`
1. Create a new handler in `apps/cli/src/commands/handlers/<name>.ts`:
   ```typescript
   import { CommandDefinition, CommandContext } from '../types.js';

   export const myCommand: CommandDefinition = {
     name: 'mycommand',
     description: 'Description of what this command does',
     usage: '/mycommand [arg]',
     aliases: ['mc'],
     async execute(args: string[], ctx: CommandContext): Promise<void> {
       // Perform action using ctx (logThought, logActivity, setModel, etc.)
     },
   };
   ```
2. Register the command in `apps/cli/src/commands/registry.ts`:
   ```typescript
   import { myCommand } from './handlers/mycommand.js';
   // in constructor:
   this.register(myCommand);
   ```
3. Add a unit test in `apps/cli/test/command-registry.test.ts`.

### Recipe 2: Adding a New Agent Skill
1. Create directory `packages/core/skills/<skill-name>/`.
2. Add `SKILL.md` with standard YAML frontmatter:
   ```markdown
   ---
   name: my-skill
   description: Explains what this skill does and when the agent should activate it.
   license: MIT
   metadata:
     version: "1.0.0"
   ---

   # Instructions for My Skill
   Detailed guidelines, constraints, and instructions for the agent...
   ```
3. `SkillManager` will automatically index and match this skill on runtime prompt analysis.

### Recipe 3: Adding a New Sub-agent Persona
1. Create `packages/core/agents/<persona-name>.md`.
2. Include YAML frontmatter (`name`, `description`, `role`) and strict output formatting instructions.
3. Update `packages/core/src/tools/tool-definitions.ts` if adding to the enum in `dispatch_subagent` arguments.
4. Verify isolation in `packages/core/test/subagent-runner.test.ts`.

### Recipe 4: Adding or Updating Models
1. Update `AVAILABLE_MODELS` in `packages/core/src/types.ts`.
2. Update `AVAILABLE_MODELS` in `apps/cli/src/commands/types.ts`.
3. Update pricing tables in `apps/cli/src/commands/handlers/cost.ts`.
4. Run `pnpm test` and `pnpm build` to verify autocomplete, pricing and client.

---

## 6. Troubleshooting & Common Pitfalls

| Issue | Cause | Resolution |
| :--- | :--- | :--- |
| `bash: pnpm: command not found` | `pnpm` is not in global `$PATH` | Run `corepack enable` in your terminal session |
| `TypeError: Cannot find module ... Did you mean to import ...js?` | Missing `.js` extension in TS import | Add `.js` extension to relative import path |
| TUI displays broken characters or layout issues | Terminal window width < 80 columns | Resize terminal to at least 100x30 columns |
| Vitest hangs or stays open | Vitest default watch mode | Use `pnpm test` (runs `vitest run`) instead of `vitest` |
| Gemini API `PERMISSION_DENIED` or `UNAUTHENTICATED` | Missing or invalid API key | Run `/key <api-key>` in TUI or set `export GEMINI_API_KEY="..."` |
