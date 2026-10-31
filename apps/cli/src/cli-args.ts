export interface CliOptions {
  initialPrompt?: string;
  initialMode: 'auto' | 'plan' | 'act';
  model: string;
  initialEffort: string;
  initialApiKey?: string;
  outDir: string;
  simulate?: boolean;
  maxTurns: number;
  fsMode: 'vfs' | 'disk';
  provider?: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let initialMode: 'auto' | 'plan' | 'act' = 'auto';
  let model = 'gemini-3.8-flash';
  let initialEffort = 'high';
  let initialApiKey: string | undefined = undefined;
  let outDir = process.cwd();
  let simulate: boolean | undefined = undefined;
  let maxTurns = 100;
  let fsMode: 'vfs' | 'disk' = 'vfs';
  let provider: string | undefined = undefined;
  const promptWords: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('--mode=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (val === 'plan' || val === 'act' || val === 'auto') {
        initialMode = val;
      }
    } else if (arg === '-m' || arg === '--mode') {
      const next = argv[++i]?.toLowerCase();
      if (next === 'plan' || next === 'act' || next === 'auto') {
        initialMode = next;
      }
    } else if (arg.startsWith('--model=')) {
      model = arg.split('=')[1];
    } else if (arg === '--model') {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        model = argv[++i];
      }
    } else if (arg.startsWith('--effort=') || arg.startsWith('--thinking=')) {
      initialEffort = arg.split('=')[1].toLowerCase();
    } else if (arg === '--effort' || arg === '--thinking') {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        initialEffort = argv[++i]?.toLowerCase();
      }
    } else if (arg.startsWith('--key=') || arg.startsWith('--api-key=')) {
      initialApiKey = arg.split('=')[1];
    } else if (arg === '-k' || arg === '--key' || arg === '--api-key') {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        initialApiKey = argv[++i];
      }
    } else if (arg.startsWith('--out-dir=') || arg.startsWith('--outDir=')) {
      outDir = arg.split('=')[1];
    } else if (arg === '--out-dir' || arg === '--outDir') {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        outDir = argv[++i];
      }
    } else if (arg.startsWith('--fs=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (val === 'disk' || val === 'vfs') {
        fsMode = val;
      }
    } else if (arg === '--fs') {
      const next = argv[++i]?.toLowerCase();
      if (next === 'disk' || next === 'vfs') {
        fsMode = next;
      }
    } else if (arg.startsWith('--provider=')) {
      provider = arg.split('=')[1].toLowerCase();
    } else if (arg === '--provider') {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        provider = argv[++i]?.toLowerCase();
      }
    } else if (arg.startsWith('--max-turns=') || arg.startsWith('--maxTurns=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        maxTurns = parsed;
      }
    } else if (arg === '--max-turns' || arg === '--maxTurns') {
      const next = parseInt(argv[i + 1], 10);
      if (!isNaN(next) && next > 0) {
        maxTurns = next;
        i++;
      }
    } else if (arg === '--simulate') {
      simulate = true;
    } else if (arg === '--no-simulate') {
      simulate = false;
    } else if (!arg.startsWith('-')) {
      promptWords.push(arg);
    }
  }

  const initialPrompt = promptWords.length > 0 ? promptWords.join(' ') : undefined;

  return {
    initialPrompt,
    initialMode,
    model,
    initialEffort,
    initialApiKey,
    outDir,
    simulate,
    maxTurns,
    fsMode,
    provider,
  };
}
