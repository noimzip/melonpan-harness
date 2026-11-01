import { Type } from '@google/genai';
import {
  ActivateSkillArgs,
  CompleteTaskArgs,
  DispatchSubagentArgs,
  EditFileArgs,
  FetchUrlArgs,
  GrepSearchArgs,
  ITool,
  ListFilesArgs,
  ReadFileArgs,
  RunCommandArgs,
  ToolExecutionContext,
  ToolExecutionResult,
  WebSearchArgs,
  WriteFileArgs,
} from '../types.js';
import { computeUnifiedDiff, matchGlob } from '../vfs/diff.js';
import { MockCommandExecutor, NodeCommandExecutor } from './command-executor.js';
import { FetchWebProvider, MockWebProvider } from './web-provider.js';

/**
 * 1. write_file ツールプラグイン (#50, #20)
 */
export class WriteFileTool implements ITool<WriteFileArgs> {
  readonly name = 'write_file';
  readonly category = 'write' as const;
  readonly riskLevel = 'medium' as const;
  readonly declaration = {
    name: 'write_file',
    description:
      'Write content to a file in the filesystem. Creates a new file or completely overwrites an existing file.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative file path, e.g., "index.html" or "src/app.ts".',
        },
        content: {
          type: Type.STRING,
          description: 'The complete text content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  };

  async execute(args: WriteFileArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const pathArg = String(args?.path || 'index.html');
    const contentArg = String(args?.content ?? '');

    const previous = (await ctx.fs.readFile(pathArg)) ?? '';
    await ctx.fs.writeFile(pathArg, contentArg);

    const diffInfo = computeUnifiedDiff(pathArg, previous, contentArg);

    ctx.emit({
      type: 'FILE_CHANGED',
      payload: {
        path: pathArg,
        action: 'write',
        size: contentArg.length,
        unifiedDiff: diffInfo.unifiedDiff,
        addedLines: diffInfo.addedLines,
        removedLines: diffInfo.removedLines,
      },
      timestamp: Date.now(),
    });

    if (pathArg === 'plan.md' || pathArg.endsWith('/plan.md')) {
      ctx.emit({
        type: 'PLAN_CREATED',
        payload: {
          plan: contentArg,
          path: pathArg,
        },
        timestamp: Date.now(),
      });
    }

    const output = `Successfully wrote ${contentArg.length} characters to "${pathArg}".`;
    return {
      output,
      metadata: {
        path: pathArg,
        action: 'write',
        size: contentArg.length,
        unifiedDiff: diffInfo.unifiedDiff,
        addedLines: diffInfo.addedLines,
        removedLines: diffInfo.removedLines,
      },
    };
  }
}

/**
 * 2. edit_file ツールプラグイン (#50, #20, #2)
 */
export class EditFileTool implements ITool<EditFileArgs> {
  readonly name = 'edit_file';
  readonly category = 'write' as const;
  readonly riskLevel = 'medium' as const;
  readonly declaration = {
    name: 'edit_file',
    description:
      'Edit an existing file in the filesystem by finding an exact snippet and replacing it with new code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative file path to edit, e.g., "index.html".',
        },
        search: {
          type: Type.STRING,
          description:
            'The exact continuous block of text in the existing file that needs to be replaced.',
        },
        replace: {
          type: Type.STRING,
          description: 'The replacement code chunk.',
        },
      },
      required: ['path', 'search', 'replace'],
    },
  };

  async execute(args: EditFileArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const pathArg = String(args?.path || '');
    const searchArg = String(args?.search ?? '');
    const replaceArg = String(args?.replace ?? '');

    const editRes = await ctx.fs.editFile(pathArg, searchArg, replaceArg);
    if (editRes.success) {
      const updatedContent = await ctx.fs.readFile(pathArg);
      ctx.emit({
        type: 'FILE_CHANGED',
        payload: {
          path: pathArg,
          action: 'edit',
          size: updatedContent?.length || 0,
          diffSummary: editRes.diffSummary,
          unifiedDiff: editRes.unifiedDiff,
          addedLines: editRes.addedLines,
          removedLines: editRes.removedLines,
        },
        timestamp: Date.now(),
      });
    }

    let output = '';
    if (editRes.success) {
      output = editRes.diffSummary || `Successfully edited "${pathArg}".`;
      if (editRes.unifiedDiff) {
        output += `\n\n[Applied Diff Preview]:\n${editRes.unifiedDiff}`;
      }
    } else {
      output = `Error: ${editRes.error}`;
    }

    return {
      output,
      isError: !editRes.success,
      metadata: {
        path: pathArg,
        action: 'edit',
        success: editRes.success,
        unifiedDiff: editRes.unifiedDiff,
        addedLines: editRes.addedLines,
        removedLines: editRes.removedLines,
      },
    };
  }
}

/**
 * 3. read_file ツールプラグイン (#21)
 */
export class ReadFileTool implements ITool<ReadFileArgs> {
  readonly name = 'read_file';
  readonly category = 'read' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'read_file',
    description:
      'Read the contents of a file from the filesystem with optional 1-indexed start_line and end_line ranges.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative path of the file to read.',
        },
        start_line: {
          type: Type.NUMBER,
          description: 'Optional 1-indexed starting line number (inclusive).',
        },
        end_line: {
          type: Type.NUMBER,
          description: 'Optional 1-indexed ending line number (inclusive).',
        },
      },
      required: ['path'],
    },
  };

  async execute(args: ReadFileArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const pathArg = String(args?.path || '');
    const fullContent = await ctx.fs.readFile(pathArg);
    if (fullContent === undefined) {
      return {
        output: `Error: File "${pathArg}" does not exist.`,
        isError: true,
        metadata: { path: pathArg, exists: false },
      };
    }

    const allLines = fullContent.split('\n');
    const totalLines = allLines.length;

    // 行範囲が未指定の場合は最大200行までに制限してトークン急増を防止
    const defaultMaxLines = 200;
    const requestedStart = args?.start_line ? Number(args.start_line) : undefined;
    const requestedEnd = args?.end_line ? Number(args.end_line) : undefined;

    let startLine = Math.max(1, requestedStart || 1);
    let endLine = requestedEnd !== undefined
      ? Math.min(totalLines, requestedEnd)
      : Math.min(totalLines, startLine + defaultMaxLines - 1);

    const isLineClipped = requestedEnd === undefined && totalLines > defaultMaxLines;

    const slicedLines = startLine <= endLine ? allLines.slice(startLine - 1, endLine) : [];
    let numberedContent = slicedLines
      .map((line, idx) => `${startLine + idx}: ${line}`)
      .join('\n');

    if (isLineClipped) {
      numberedContent += `\n... [Showing lines ${startLine}-${endLine} of ${totalLines}. Use start_line and end_line to inspect specific ranges]`;
    }

    const maxChars = 8000;
    const truncated = numberedContent.length > maxChars;
    const outputBody = truncated
      ? `${numberedContent.slice(0, maxChars)}\n... [Truncated remaining characters. Use start_line and end_line for specific sections]`
      : numberedContent;

    return {
      output: outputBody,
      metadata: {
        path: pathArg,
        startLine,
        endLine,
        totalLines,
        truncated: truncated || isLineClipped,
      },
    };
  }
}

/**
 * 4. list_files ツールプラグイン (#21)
 */
export class ListFilesTool implements ITool<ListFilesArgs> {
  readonly name = 'list_files';
  readonly category = 'read' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'list_files',
    description:
      'List files in the workspace or a subdirectory, optionally filtered by a glob pattern.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Optional subdirectory path to list (default: workspace root).',
        },
        pattern: {
          type: Type.STRING,
          description: 'Optional glob filter pattern, e.g., "*.ts" or "src/**/*.tsx".',
        },
      },
    },
  };

  async execute(args: ListFilesArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const dirPath = args?.path ? String(args.path) : undefined;
    const pattern = args?.pattern ? String(args.pattern) : undefined;
    const files = await ctx.fs.listFiles(dirPath, { pattern });

    const output =
      files.length > 0
        ? files.join('\n')
        : `No files found${dirPath ? ` in "${dirPath}"` : ''}${pattern ? ` matching "${pattern}"` : ''}.`;

    return {
      output,
      metadata: {
        path: dirPath || '.',
        pattern,
        count: files.length,
        files,
      },
    };
  }
}

/**
 * 5. grep_search ツールプラグイン (#21)
 */
export class GrepSearchTool implements ITool<GrepSearchArgs> {
  readonly name = 'grep_search';
  readonly category = 'read' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'grep_search',
    description:
      'Search for a keyword or regular expression pattern across files in the filesystem and return matching lines with line numbers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The text or regular expression pattern to search for.',
        },
        path: {
          type: Type.STRING,
          description: 'Optional directory or file path to restrict the search.',
        },
        include_pattern: {
          type: Type.STRING,
          description: 'Optional glob pattern to filter files, e.g., "*.ts".',
        },
        is_regex: {
          type: Type.BOOLEAN,
          description: 'If true, treats query as a regular expression (default: false).',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: GrepSearchArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const query = String(args?.query || '');
    if (!query) {
      return { output: 'Error: query parameter is required.', isError: true };
    }

    const dirOrFile = args?.path ? String(args.path) : undefined;
    const includePattern = args?.include_pattern ? String(args.include_pattern) : undefined;
    const isRegex = Boolean(args?.is_regex);

    let regex: RegExp;
    try {
      regex = isRegex
        ? new RegExp(query, 'i')
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch (err: any) {
      return {
        output: `Error: Invalid regular expression "${query}": ${err?.message || String(err)}`,
        isError: true,
      };
    }

    let candidateFiles: string[] = [];
    if (dirOrFile && (await ctx.fs.exists(dirOrFile))) {
      const directContent = await ctx.fs.readFile(dirOrFile);
      if (directContent !== undefined) {
        candidateFiles = [dirOrFile];
      } else {
        candidateFiles = await ctx.fs.listFiles(dirOrFile, { pattern: includePattern });
      }
    } else {
      candidateFiles = await ctx.fs.listFiles(dirOrFile, { pattern: includePattern });
    }

    const matches: Array<{ file: string; line: number; content: string }> = [];
    const maxMatches = 30;

    for (const filePath of candidateFiles) {
      if (includePattern && !matchGlob(filePath, includePattern)) {
        continue;
      }
      const content = await ctx.fs.readFile(filePath);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i]!;
        if (regex.test(lineText)) {
          const clippedContent =
            lineText.length > 160 ? `${lineText.slice(0, 160)}...` : lineText;
          matches.push({
            file: filePath,
            line: i + 1,
            content: clippedContent,
          });
          if (matches.length >= maxMatches) break;
        }
      }
      if (matches.length >= maxMatches) break;
    }

    let formatted =
      matches.length > 0
        ? matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n')
        : `No matches found for "${query}".`;

    if (matches.length >= maxMatches) {
      formatted += `\n... [Truncated: Showing top ${maxMatches} matches. Narrow your search pattern or path]`;
    }

    const maxChars = 8000;
    if (formatted.length > maxChars) {
      formatted = `${formatted.slice(0, maxChars)}\n... [Truncated at ${maxChars} characters]`;
    }

    return {
      output: formatted,
      metadata: {
        query,
        matchCount: matches.length,
        truncated: matches.length >= maxMatches || formatted.length >= maxChars,
        matches,
      },
    };
  }
}

/**
 * 6. run_command ツールプラグイン (#22)
 */
export class RunCommandTool implements ITool<RunCommandArgs> {
  readonly name = 'run_command';
  readonly category = 'execute' as const;
  readonly riskLevel = 'high' as const;
  readonly declaration = {
    name: 'run_command',
    description:
      'Execute a shell command (e.g., build, test, typecheck) and capture stdout, stderr, and exit code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'The shell command line to execute.',
        },
        cwd: {
          type: Type.STRING,
          description: 'Optional working directory for the command.',
        },
        timeout_ms: {
          type: Type.NUMBER,
          description: 'Optional timeout in milliseconds (default: 30000).',
        },
      },
      required: ['command'],
    },
  };

  private fallbackExecutor?: NodeCommandExecutor | MockCommandExecutor;

  async execute(args: RunCommandArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const command = String(args?.command || '').trim();
    if (!command) {
      return { output: 'Error: command parameter is required.', isError: true };
    }

    const executor =
      ctx.commandExecutor ??
      (this.fallbackExecutor || (this.fallbackExecutor = new NodeCommandExecutor()));

    const res = await executor.execute(command, {
      cwd: args?.cwd ? String(args.cwd) : undefined,
      timeoutMs: args?.timeout_ms ? Number(args.timeout_ms) : undefined,
      signal: ctx.signal,
    });

    const parts: string[] = [];
    parts.push(`Exit Code: ${res.exitCode ?? 'null'} (${res.durationMs}ms)`);
    if (res.timedOut) parts.push('[TIMED OUT]');
    if (res.aborted) parts.push('[ABORTED]');
    if (res.stdout.trim()) parts.push(`STDOUT:\n${res.stdout.trim()}`);
    if (res.stderr.trim()) parts.push(`STDERR:\n${res.stderr.trim()}`);

    const isError = res.exitCode !== 0 || Boolean(res.timedOut) || Boolean(res.aborted);

    return {
      output: parts.join('\n\n'),
      isError,
      metadata: {
        command: res.command,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        durationMs: res.durationMs,
        timedOut: res.timedOut,
        aborted: res.aborted,
        truncated: res.truncated,
      },
    };
  }
}

/**
 * 7. web_search ツールプラグイン (#22)
 */
export class WebSearchTool implements ITool<WebSearchArgs> {
  readonly name = 'web_search';
  readonly category = 'network' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'web_search',
    description:
      'Search the web for technical documentation, API specifications, or reference information.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query.',
        },
        max_results: {
          type: Type.NUMBER,
          description: 'Optional maximum number of results to return (default: 5).',
        },
      },
      required: ['query'],
    },
  };

  private fallbackProvider?: FetchWebProvider | MockWebProvider;

  async execute(args: WebSearchArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const query = String(args?.query || '').trim();
    if (!query) {
      return { output: 'Error: query parameter is required.', isError: true };
    }

    const provider =
      ctx.webProvider ??
      (this.fallbackProvider || (this.fallbackProvider = new FetchWebProvider()));

    const results = await provider.search(query, {
      maxResults: args?.max_results ? Number(args.max_results) : 5,
      signal: ctx.signal,
    });

    const formatted =
      results.length > 0
        ? results
            .map((item, idx) => `${idx + 1}. [${item.title}](${item.url})\n   ${item.snippet}`)
            .join('\n\n')
        : `No web results found for "${query}".`;

    return {
      output: formatted,
      metadata: {
        query,
        count: results.length,
        results,
      },
    };
  }
}

/**
 * 8. fetch_url ツールプラグイン (#22)
 */
export class FetchUrlTool implements ITool<FetchUrlArgs> {
  readonly name = 'fetch_url';
  readonly category = 'network' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'fetch_url',
    description:
      'Fetch content from a public HTTP/HTTPS URL and extract clean readable text.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'The URL to fetch.',
        },
        max_chars: {
          type: Type.NUMBER,
          description: 'Optional maximum character limit for the returned text.',
        },
      },
      required: ['url'],
    },
  };

  private fallbackProvider?: FetchWebProvider | MockWebProvider;

  async execute(args: FetchUrlArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const url = String(args?.url || '').trim();
    if (!url) {
      return { output: 'Error: url parameter is required.', isError: true };
    }

    const provider =
      ctx.webProvider ??
      (this.fallbackProvider || (this.fallbackProvider = new FetchWebProvider()));

    const res = await provider.fetchUrl(url, {
      maxChars: args?.max_chars ? Number(args.max_chars) : undefined,
      signal: ctx.signal,
    });

    const header = res.title ? `# ${res.title}\nURL: ${res.url} (HTTP ${res.status})\n\n` : `URL: ${res.url} (HTTP ${res.status})\n\n`;
    return {
      output: `${header}${res.content}`,
      isError: res.status >= 400,
      metadata: {
        url: res.url,
        title: res.title,
        status: res.status,
        contentType: res.contentType,
        truncated: res.truncated,
      },
    };
  }
}

/**
 * 9. activate_skill ツールプラグイン (#24, #50)
 */
export class ActivateSkillTool implements ITool<ActivateSkillArgs> {
  readonly name = 'activate_skill';
  readonly category = 'skill' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'activate_skill',
    description:
      'Activate a specialized domain skill by name on demand (Progressive Disclosure) and load its full Markdown instructions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'The exact skill identifier from the available skill catalog, e.g., "game-generator".',
        },
      },
      required: ['name'],
    },
  };

  async execute(args: ActivateSkillArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
    const skillName = String(args?.name || '').trim();
    if (!skillName) {
      return { output: 'Error: skill name is required.', isError: true };
    }

    if (!ctx.skillManager) {
      return {
        output: `Error: No SkillManager is configured in the current context.`,
        isError: true,
      };
    }

    const loaded =
      typeof ctx.skillManager.activateSkill === 'function'
        ? await ctx.skillManager.activateSkill(skillName)
        : await ctx.skillManager.resolveAndLoad(skillName);

    if (!loaded || loaded.name !== skillName) {
      return {
        output: `Error: Skill "${skillName}" not found or is disabled.`,
        isError: true,
      };
    }

    const allowedTools = loaded.frontmatter?.['allowed-tools']
      ? String(loaded.frontmatter['allowed-tools'])
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;

    ctx.emit({
      type: 'SKILL_LOADED',
      payload: {
        name: loaded.name,
        description: loaded.description,
        filePath: loaded.filePath,
        instructionPreview:
          loaded.instruction.length > 150
            ? loaded.instruction.slice(0, 150) + '...'
            : loaded.instruction,
        allowedTools,
      },
      timestamp: Date.now(),
    });

    return {
      output: `[Skill Activated: ${loaded.name}]\n\n${loaded.instruction}`,
      metadata: {
        name: loaded.name,
        description: loaded.description,
        filePath: loaded.filePath,
        allowedTools,
      },
    };
  }
}

/**
 * 10. dispatch_subagent ツールプラグイン (#50, #13, #25)
 */
export class DispatchSubagentTool implements ITool<DispatchSubagentArgs> {
  readonly name = 'dispatch_subagent';
  readonly category = 'subagent' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'dispatch_subagent',
    description:
      'Delegate specialized research, code review, or scoped implementation to an isolated clean-room sub-agent ("researcher", "code-reviewer", or "coder").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        agent_type: {
          type: Type.STRING,
          enum: ['researcher', 'code-reviewer', 'coder'],
          description:
            'Type of specialized sub-agent: "researcher" for technical discovery, "code-reviewer" for multi-perspective code audit, or "coder" for scoped implementation.',
        },
        task_prompt: {
          type: Type.STRING,
          description:
            'Focused instructions or technical questions for the sub-agent. Do not paste entire file contents here; specify file_path or files instead.',
        },
        file_path: {
          type: Type.STRING,
          description:
            'Optional target file path in the workspace/VFS to provide as context to the sub-agent (e.g., "plan.md" or "index.html").',
        },
        files: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            'Optional list of target file paths in the workspace/VFS to pass to the sub-agent.',
        },
      },
      required: ['agent_type', 'task_prompt'],
    },
  };

  async execute(
    args: DispatchSubagentArgs,
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const agentType = String(args?.agent_type || 'researcher');
    const taskPrompt = String(args?.task_prompt || '');
    const explicitFilePath = args?.file_path ? String(args.file_path) : undefined;
    const explicitFiles = Array.isArray(args?.files)
      ? args.files.map((f) => String(f))
      : undefined;

    if (!ctx.subagentSpawner) {
      return {
        output: 'Error: Subagent spawner is not available in this execution context.',
        isError: true,
      };
    }

    const subStartTime = Date.now();
    const subagentId = `sub-${agentType}-${Date.now().toString(36)}`;

    ctx.emit({
      type: 'SUBAGENT_DISPATCHED',
      payload: {
        agentType,
        taskPrompt,
        callId: ctx.callId,
        subagentId,
        filePath: explicitFilePath,
        files: explicitFiles,
      },
      timestamp: Date.now(),
    });

    // Issue #13: 明示的な file_path / files が指定された場合はそれを優先し、未指定時はフォールバック
    let resolvedFilePath = explicitFilePath;
    let targetFileContent: string | undefined;

    if (explicitFiles && explicitFiles.length > 0) {
      const blocks: string[] = [];
      for (const fp of explicitFiles) {
        const c = await ctx.fs.readFile(fp);
        if (c !== undefined) {
          blocks.push({ path: fp, content: c } as any);
        }
      }
      resolvedFilePath = explicitFiles[0];
      targetFileContent = await ctx.fs.readFile(explicitFiles[0]!);
    } else if (explicitFilePath) {
      targetFileContent = await ctx.fs.readFile(explicitFilePath);
    } else {
      // Issue #13 & Token Bloat Prevention: Avoid blindly injecting index.html (thousands of lines)
      // unless specifically relevant or requested in the task prompt.
      const lowerPrompt = taskPrompt.toLowerCase();
      if (lowerPrompt.includes('plan.md') && (await ctx.fs.exists('plan.md'))) {
        resolvedFilePath = 'plan.md';
        targetFileContent = await ctx.fs.readFile('plan.md');
      } else if (lowerPrompt.includes('index.html') && (await ctx.fs.exists('index.html'))) {
        resolvedFilePath = 'index.html';
        targetFileContent = await ctx.fs.readFile('index.html');
      } else {
        const requestsWorkspaceCode =
          lowerPrompt.includes('existing code') ||
          lowerPrompt.includes('current code') ||
          lowerPrompt.includes('source code') ||
          lowerPrompt.includes('the code') ||
          lowerPrompt.includes('this code') ||
          (agentType === 'code-reviewer' &&
            (lowerPrompt.includes('audit code') ||
              lowerPrompt.includes('review code') ||
              lowerPrompt.includes('code review')));

        if (requestsWorkspaceCode) {
          if (await ctx.fs.exists('index.html')) {
            resolvedFilePath = 'index.html';
            targetFileContent = await ctx.fs.readFile('index.html');
          } else if (await ctx.fs.exists('plan.md')) {
            resolvedFilePath = 'plan.md';
            targetFileContent = await ctx.fs.readFile('plan.md');
          }
        }
      }
    }

    const subResult = await ctx.subagentSpawner.run(agentType, taskPrompt, {
      filePath: resolvedFilePath,
      files: explicitFiles,
      fileContext: targetFileContent,
      parentCallId: ctx.callId,
      subagentId,
      signal: ctx.signal,
      onEvent: (subEvent) => {
        ctx.emit({
          ...subEvent,
          subagentId,
          parentCallId: ctx.callId,
        });
      },
    });

    const subUsage = ctx.subagentSpawner.getLastUsage();
    const durationMs = Date.now() - subStartTime;

    ctx.emit({
      type: 'SUBAGENT_COMPLETED',
      payload: {
        agentType,
        result: subResult,
        durationMs,
        callId: ctx.callId,
        subagentId,
        usage: subUsage,
      },
      timestamp: Date.now(),
    });

    const observation = `[Clean-Room Sub-agent: ${agentType} Report]\n${subResult}`;
    return {
      output: observation,
      metadata: {
        agentType,
        subagentId,
        durationMs,
        filePath: resolvedFilePath,
        files: explicitFiles,
        usage: subUsage,
      },
    };
  }
}

/**
 * 11. complete_task ツールプラグイン (#50)
 */
export class CompleteTaskTool implements ITool<CompleteTaskArgs> {
  readonly name = 'complete_task';
  readonly category = 'control' as const;
  readonly riskLevel = 'low' as const;
  readonly declaration = {
    name: 'complete_task',
    description:
      'Declare that the goal/task has been fully completed and all deliverables are verified and finalized.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description:
            'A concise, professional summary of the completed work, key changes, and verification results.',
        },
      },
      required: ['summary'],
    },
  };

  async execute(args: CompleteTaskArgs): Promise<ToolExecutionResult> {
    const summary = String(args?.summary || 'Task completed successfully.');
    return {
      output: 'Task completion confirmed.',
      isTaskComplete: true,
      completionSummary: summary,
      metadata: { summary },
    };
  }
}

/**
 * 標準組み込みツール群を生成するファクトリ関数
 */
export function createBuiltinTools(): ITool<any>[] {
  return [
    new WriteFileTool(),
    new EditFileTool(),
    new ReadFileTool(),
    new ListFilesTool(),
    new GrepSearchTool(),
    new RunCommandTool(),
    new WebSearchTool(),
    new FetchUrlTool(),
    new ActivateSkillTool(),
    new DispatchSubagentTool(),
    new CompleteTaskTool(),
  ];
}
