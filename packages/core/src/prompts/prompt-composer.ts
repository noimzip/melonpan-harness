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
 * 2. ToolingRulesSection: 有効ツール一覧とトークン節約・サブエージェント委譲規約 (#51, #14)
 */
export class ToolingRulesSection implements PromptSection {
  readonly id = 'tooling-rules';
  readonly priority = 20;

  render(ctx: PromptBuildContext): string {
    const tools = ctx.availableTools || [];
    const toolLines =
      tools.length > 0
        ? tools
            .map(
              (t, idx) =>
                `${idx + 1}. ${t.name}: ${t.declaration.description || t.category}`
            )
            .join('\n')
        : [
            '1. write_file(path, content): Create or overwrite a file in the filesystem.',
            '2. edit_file(path, search, replace): Modify an existing file with exact search/replace.',
            '3. read_file(path, start_line?, end_line?): Read file contents with line numbers.',
            '4. list_files(path?, pattern?): List files in the workspace.',
            '5. grep_search(query, path?, include_pattern?): Search for patterns across files.',
            '6. run_command(command, cwd?, timeout_ms?): Run shell commands for verification.',
            '7. activate_skill(name): Load specialized domain instructions on demand.',
            '8. dispatch_subagent(agent_type, task_prompt, file_path?, files?): Delegate to a clean-room sub-agent.',
            '9. complete_task(summary): Declare that the implementation is verified and complete.',
          ].join('\n');

    return [
      'YOUR WORKSPACE TOOLS:',
      toolLines,
      '',
      'CRITICAL TOKEN OPTIMIZATION & CLEAN-ROOM RULES (STRICT):',
      '1. Initial File Creation: Use write_file(path, content) ONLY ONCE to establish a new file.',
      '2. Modifications, Tuning, Refinements, & Bug Fixes: You are STRICTLY FORBIDDEN from regenerating or rewriting an entire existing file using write_file. You MUST use edit_file(path, search, replace) with minimal, targeted search/replace blocks.',
      '3. Subagent Delegation: Subagents execute in isolated clean-room sessions. NEVER paste full code files into task_prompt. Instead, pass a concise task_prompt and specify target files via file_path (e.g. file_path: "index.html" or "plan.md") or files array so the runner injects them cleanly.',
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
    if (ctx.mode === 'plan') {
      return [
        'OPERATIONAL MODE: [PLAN MODE]',
        '- Your goal is strictly to analyze requirements and produce a thorough implementation plan.',
        '- Use read_file / list_files / grep_search or dispatch_subagent("researcher", task_prompt) to investigate architecture and specifications.',
        '- Use write_file("plan.md", content) to draft the structured technical plan.',
        '- Once plan.md is saved, call complete_task(summary) with the plan summary. Do NOT create implementation deliverables in plan mode.',
      ].join('\n');
    }

    if (ctx.mode === 'auto') {
      return [
        'OPERATIONAL MODE: [AUTO MODE: Plan -> Implement -> Multi-Perspective Audit]',
        '- Phase 1 (Plan): Dispatch "researcher" if needed, then write a concise technical design to "plan.md".',
        '- Phase 2 (Act): Implement the requested deliverables according to the plan and active skill guidelines.',
        '- Phase 3 (Audit): Call dispatch_subagent("code-reviewer", "Audit implementation for quality, performance, and security", file_path) without pasting raw code into task_prompt.',
        '- Phase 4 (Refine): If any warnings or issues are found, use edit_file to fix them, then call complete_task.',
      ].join('\n');
    }

    return [
      'OPERATIONAL MODE: [ACT MODE]',
      '- Implement the requested deliverables using write_file (initial creation) and edit_file (refinements).',
      '- You can dispatch "researcher" for technical discovery, "coder" for scoped sub-tasks, or "code-reviewer" (specifying file_path) to audit deliverables before finalizing.',
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
