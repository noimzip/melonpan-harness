#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

// Load .env if present in current working directory
try {
  (process as any).loadEnvFile?.();
} catch {}

// Parse command line arguments
const args = process.argv.slice(2);
let initialMode: 'auto' | 'plan' | 'act' = 'auto';
let model = 'gemini-3.8-flash';
let initialEffort = 'high';
let initialApiKey: string | undefined = undefined;
let outDir = process.cwd();
let simulate: boolean | undefined = undefined;
let maxTurns = 100;
const promptWords: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--mode=')) {
    const val = arg.split('=')[1].toLowerCase();
    if (val === 'plan' || val === 'act' || val === 'auto') {
      initialMode = val;
    }
  } else if (arg === '-m' || arg === '--mode') {
    const next = args[i + 1]?.toLowerCase();
    if (next === 'plan' || next === 'act' || next === 'auto') {
      initialMode = next;
      i++;
    }
  } else if (arg.startsWith('--model=')) {
    model = arg.split('=')[1];
  } else if (arg.startsWith('--effort=') || arg.startsWith('--thinking=')) {
    initialEffort = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--key=') || arg.startsWith('--api-key=')) {
    initialApiKey = arg.split('=')[1];
  } else if (arg === '-k' || arg === '--key') {
    initialApiKey = args[i + 1];
    i++;
  } else if (arg.startsWith('--out-dir=') || arg.startsWith('--outDir=')) {
    outDir = arg.split('=')[1];
  } else if (arg.startsWith('--max-turns=') || arg.startsWith('--maxTurns=')) {
    const parsed = parseInt(arg.split('=')[1], 10);
    if (!isNaN(parsed) && parsed > 0) {
      maxTurns = parsed;
    }
  } else if (arg === '--max-turns' || arg === '--maxTurns') {
    const next = parseInt(args[i + 1], 10);
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

const { waitUntilExit } = render(
  <App
    initialPrompt={initialPrompt}
    initialMode={initialMode}
    model={model}
    initialEffort={initialEffort}
    initialApiKey={initialApiKey}
    outDir={outDir}
    simulate={simulate}
    maxTurns={maxTurns}
  />
);

await waitUntilExit();
