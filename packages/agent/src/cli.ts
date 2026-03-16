import { Command } from 'commander';
import { agentConfigSchema, loadConfig } from '@chq/shared';
import { Daemon } from './daemon.js';
import path from 'node:path';
import os from 'node:os';

const CONFIG_PATH = path.join(os.homedir(), '.chq', 'config.json');

const program = new Command();

program
  .name('chq')
  .description('Claude HQ Agent — manage Claude Code sessions across machines')
  .version('0.1.0');

// chq agent start
const agentCmd = program.command('agent').description('Agent daemon management');

agentCmd
  .command('start')
  .description('Start the agent daemon')
  .action(async () => {
    const config = loadConfig(agentConfigSchema, CONFIG_PATH, 'CHQ_AGENT_');
    const daemon = new Daemon(config);
    await daemon.start();
    // Daemon keeps running via event loop
  });

agentCmd
  .command('status')
  .description('Show agent status')
  .action(() => {
    console.log('Status check requires a running daemon. Use process inspection.');
    // TODO: implement IPC or HTTP for daemon status queries
  });

// chq run "prompt"
program
  .command('run')
  .description('Start a new Claude Code session')
  .argument('<prompt>', 'The prompt/task for Claude Code')
  .option('--cwd <path>', 'Working directory', process.cwd())
  .option('--flags <flags>', 'Custom Claude flags (comma-separated)')
  .action(async (prompt: string, opts: { cwd: string; flags?: string }) => {
    const config = loadConfig(agentConfigSchema, CONFIG_PATH, 'CHQ_AGENT_');
    const daemon = new Daemon(config);
    await daemon.start();
    // For now, the daemon handles session start from Hub messages
    // Direct CLI spawn will be added in a future iteration
    console.log(`Agent started. Session will be managed via Hub.`);
    console.log(`Prompt: ${prompt}`);
    console.log(`CWD: ${opts.cwd}`);
  });

// chq sessions
program
  .command('sessions')
  .description('List active sessions')
  .action(() => {
    console.log('Session listing requires a running daemon.');
  });

// chq kill <sessionId>
program
  .command('kill')
  .description('Kill a running session')
  .argument('<sessionId>', 'Session ID to kill')
  .action((sessionId: string) => {
    console.log(`Kill session: ${sessionId}`);
    console.log('Kill requires a running daemon.');
  });

program.parse();
