#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { parseCliArgs } from './cli-args.js';

// Load .env if present in current working directory
try {
  (process as any).loadEnvFile?.();
} catch {}

const options = parseCliArgs(process.argv.slice(2));

const { waitUntilExit } = render(
  <App
    initialPrompt={options.initialPrompt}
    initialMode={options.initialMode}
    model={options.model}
    initialEffort={options.initialEffort}
    initialApiKey={options.initialApiKey}
    outDir={options.outDir}
    simulate={options.simulate}
    maxTurns={options.maxTurns}
    fsMode={options.fsMode}
    provider={options.provider}
  />
);

await waitUntilExit();
