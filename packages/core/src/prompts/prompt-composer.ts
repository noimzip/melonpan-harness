import {
  IPromptComposer,
  PromptBuildContext,
  PromptSection,
} from '../types.js';

/**
 * 1. RoleSection: ベースペルソナ定義（ドメイン非依存・汎用ソフトウェアエンジニア & クリエイティブテクノロジスト）
 */
export class RoleSection implements PromptSection {
  readonly id = 'role';
  readonly priority = 10;
  private customRole?: string;

  constructor(customRole?: string) {
    this.customRole = customRole;
  }

  render(ctx: PromptBuildContext): string {
    const baseRole =
      this.customRole ||
      `You are an autonomous software engineer and creative technologist powered by Melonpan Core.\nYou operate in a strict ReAct (Reasoning + Acting) loop to inspect, design, implement, and verify high-quality software solutions.`;

    if (ctx.customInstructions) {
      return `${baseRole}\n\n${ctx.customInstructions}`;
    }
    return baseRole;
  }
}

/**
 * 2. ToolingRulesSection: 有効ツール一覧とトークン節約・サブエージェント委譲規約 (#51, #14, #56)
 * Issue #56 (Pi-Inspired < 1,000 Tokens Lean System Prompt):
 * API の `tools` (`functionDeclarations`) スキーマと重複する冗長な各ツール説明文を排除し、
 * ツール識別子リストと高密度なコア行動原則のみを記述して毎ターンの固定トークンオーバーヘッドを最小化する。
 */
export class ToolingRulesSection implements PromptSection {
  readonly id = 'tooling-rules';
  readonly priority = 20;

  render(ctx: PromptBuildContext): string {
    const tools = ctx.availableTools || [];
    const toolNames =
      tools.length > 0
        ? tools.map((t) => t.name).join(', ')
        : 'write_file, edit_file, read_file, list_files, grep_search, run_command, activate_skill, dispatch_subagent, complete_task';

    return [
      `YOUR WORKSPACE TOOLS: ${toolNames}`,
      '',
      'TOKEN & CLEAN-ROOM RULES:',
      '1. Initial Creation: Use write_file(path, content) ONCE per new file.',
      '2. Incremental Edits: NEVER rewrite an entire existing file with write_file. Always use edit_file(path, search, replace) (or edits array) for targeted modifications.',
      '3. Clean-Room Subagents: NEVER paste full code files into task_prompt; pass file_path or files array instead.',
      '4. Inspection Efficiency: Use start_line/end_line with read_file and avoid re-reading files after edit_file.',
    ].join('\n');
  }
}

/**
 * 3. ModeSection: 実行モード (`plan` / `act` / `auto`) ごとの行動規約 (#51, #14)
 */
export class ModeSection implements PromptSection {
  readonly id = 'mode';
  readonly priority = 30;

  render(ctx: PromptBuildContext): string {
    if (ctx.mode === 'goal') {
      return [
        'OPERATIONAL MODE: [GOAL AUTONOMOUS PURSUIT MODE]',
        '- High-autonomy, thorough goal pursuit mode.',
        '- Specialized subagents are FULLY ENABLED: You can dispatch clean-room subagents ("researcher", "code-reviewer") via dispatch_subagent.',
        '- Phase 1 (Execute): Implement requested deliverables according to active skill guidelines.',
        '- Phase 2 (Test & Audit): Run verification commands, dispatch "code-reviewer" to audit quality, and fix issues via edit_file.',
        '- Iterate relentlessly until the goal is completely achieved, then call complete_task.',
      ].join('\n');
    }

    if (ctx.mode === 'plan') {
      return [
        'OPERATIONAL MODE: [PLAN MODE]',
        '- Your goal is strictly to analyze requirements and produce a thorough implementation plan.',
        '- Use read_file / list_files / grep_search to investigate architecture and specifications.',
        '- Use write_file("plan.md", content) to draft the structured technical plan.',
        '- Once plan.md is saved, call complete_task(summary) with the plan summary. Do NOT create implementation deliverables in plan mode.',
      ].join('\n');
    }

    if (ctx.mode === 'auto') {
      return [
        'OPERATIONAL MODE: [AUTO MODE: Act -> Test -> Audit]',
        '- Phase 1 (Act): Implement the requested deliverables directly without drafting a separate plan.md.',
        '- Phase 2 (Test & Audit): Run verification tests/commands directly, inspect quality, and refine using edit_file.',
        '- Phase 3 (Complete): Once verified and playable, call complete_task.',
      ].join('\n');
    }

    return [
      'OPERATIONAL MODE: [STANDARD ACT & AUDIT MODE]',
      '- Direct Implementation (Plan phase removed): Implement the requested deliverables directly using write_file and edit_file without drafting plan.md.',
      '- Standalone Autonomy (Subagents disabled): Carry out all tasks directly as the primary engineer. Do NOT invoke dispatch_subagent.',
      '- Test & Audit (Preserved): Run automated tests or execute code via run_command to verify your solution.',
      '- When verified and complete, call complete_task(summary).',
    ].join('\n');
  }
}

/**
 * 4. SkillCatalogSection: 利用可能なスキルカタログとアクティブスキルの展開 (#51, #24)
 */
export class SkillCatalogSection implements PromptSection {
  readonly id = 'skill-catalog';
  readonly priority = 40;

  render(ctx: PromptBuildContext): string {
    const lines: string[] = [];

    if (ctx.availableSkills && ctx.availableSkills.length > 0) {
      lines.push('AVAILABLE AGENT SKILLS CATALOG (Progressive Disclosure):');
      lines.push(
        'You can dynamically load specialized domain instructions at any time by calling `activate_skill({ name: "<skill_name>" })`:'
      );
      for (const s of ctx.availableSkills) {
        lines.push(`- ${s.name}: ${s.description}`);
      }
      lines.push('');
    }

    if (ctx.activeSkill) {
      lines.push('==================================================');
      lines.push(`ACTIVE SKILL SPECIFICATION: [${ctx.activeSkill.name}]`);
      lines.push('==================================================');
      lines.push(ctx.activeSkill.instruction);
    } else {
      lines.push('==================================================');
      lines.push('ACTIVE SKILL SPECIFICATION: [General Autonomous Agent]');
      lines.push('==================================================');
      lines.push(
        'No specialized domain skill is pre-loaded. Rely on your core software engineering capabilities, or call `activate_skill` if one of the catalog skills matches the user task.'
      );
    }

    return lines.join('\n');
  }
}

/**
 * 5. WorkspaceContextSection: ワークスペース・環境情報の注入 (#51)
 */
export class WorkspaceContextSection implements PromptSection {
  readonly id = 'workspace-context';
  readonly priority = 50;

  render(ctx: PromptBuildContext): string | undefined {
    if (!ctx.workspaceRoot) {
      return undefined;
    }
    return `WORKSPACE CONTEXT:\n- Workspace Root: ${ctx.workspaceRoot}`;
  }
}

/**
 * モジュラー・プロンプト合成器 (`PromptComposer`) (Issue #51)
 * 独立した `PromptSection` を priority 昇順にレンダリング・結合します。
 */
export class PromptComposer implements IPromptComposer {
  private sections: Map<string, PromptSection> = new Map();

  constructor(initialSections?: PromptSection[]) {
    const defaults = initialSections ?? [
      new RoleSection(),
      new ToolingRulesSection(),
      new ModeSection(),
      new SkillCatalogSection(),
      new WorkspaceContextSection(),
    ];
    for (const sec of defaults) {
      this.addSection(sec);
    }
  }

  addSection(section: PromptSection): void {
    this.sections.set(section.id, section);
  }

  removeSection(id: string): boolean {
    return this.sections.delete(id);
  }

  getSection(id: string): PromptSection | undefined {
    return this.sections.get(id);
  }

  compose(ctx: PromptBuildContext): string {
    const ordered = Array.from(this.sections.values()).sort(
      (a, b) => a.priority - b.priority
    );

    const renderedParts: string[] = [];
    for (const section of ordered) {
      const text = section.render(ctx);
      if (text && text.trim().length > 0) {
        renderedParts.push(text.trim());
      }
    }

    return renderedParts.join('\n\n');
  }
}
