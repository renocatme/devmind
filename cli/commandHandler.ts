import { parseCommand } from './commandParser';
import { suggestCommands } from './aiTerminal';
import { explainFile } from './codeAnalysis';
import { KnowledgeBase } from '../knowledge/KnowledgeBase';

export type RuntimeLike = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  readDir: (path: string) => Promise<string[]>;
};

export type OutputFn = (line: string) => void;

export async function handleCommand(runtime: RuntimeLike, input: string, out: OutputFn) {
  const parsed = parseCommand(input);
  const cmd = parsed.command;
  const flags = parsed.flags;

  if (!cmd) return out('No command');

  if (cmd === 'help') {
    return out('Commands: file read|write|preview|ls, help, suggest');
  }

  if (cmd === 'suggest') {
    const suggestions = await suggestCommands(parsed.args.join(' '), 3);
    for (const s of suggestions) out(`> suggest: ${s.command} — ${s.reason || ''}`);
    return;
  }

  if (cmd === 'file') {
    const sub = parsed.args[0];
    if (!sub) return out('file: missing subcommand (read/write/preview/ls)');

    if (sub === 'read') {
      const path = parsed.args[1];
      if (!path) return out('file read: missing path');
      try {
        const content = await runtime.readFile(path);
        out(`$ file:${path}`);
        out(content);
      } catch (e) {
        out(`error: ${String(e)}`);
      }
      return;
    }

    if (sub === 'preview') {
      const path = parsed.args[1];
      const lines = Number(flags.lines || flags.n || 10);
      if (!path) return out('file preview: missing path');
      try {
        const content = await runtime.readFile(path);
        const arr = content.split(/\r?\n/).slice(0, lines);
        out(`$ preview:${path} (${arr.length} lines)`);
        out(arr.join('\n'));
      } catch (e) {
        out(`error: ${String(e)}`);
      }
      return;
    }

    if (sub === 'write') {
      const path = parsed.args[1];
      const data = parsed.args.slice(2).join(' ');
      const confirmed = flags.confirm || flags.yes || flags.y === true;
      if (!path) return out('file write: missing path');
      if (!data) return out('file write: missing content');
      if (!confirmed) return out(`file write: add --confirm to actually write to ${path}`);
      try {
        await runtime.writeFile(path, data);
        out(`success: wrote ${path}`);
      } catch (e) {
        out(`error: ${String(e)}`);
      }
      return;
    }

    if (sub === 'ls' || sub === 'dir') {
      const path = parsed.args[1] || '/';
      try {
        const entries = await runtime.readDir(path);
        out(`$ ls:${path}`);
        out(entries.join('\n'));
      } catch (e) {
        out(`error: ${String(e)}`);
      }
      return;
    }

    return out(`file: unknown subcommand ${sub}`);
  }

  // Code analysis commands
  if (cmd === 'code') {
    const sub = parsed.args[0];
    if (!sub) return out('code: missing subcommand (explain)');

    if (sub === 'explain') {
      const path = parsed.args[1];
      if (!path) return out('code explain: missing path');
      try {
        const content = await runtime.readFile(path);
        // Use a singleton-ish KB within the handler module for caching/indexing
        (handleCommand as any)._kb = (handleCommand as any)._kb || new KnowledgeBase();
        const kb: KnowledgeBase = (handleCommand as any)._kb;
        const llmClient = (handleCommand as any)._llmClient;
        const explanation = await explainFile(kb, path, content, llmClient);
        out(`$ code:explain ${path}`);
        out(explanation);
      } catch (e) {
        out(`error: ${String(e)}`);
      }
      return;
    }

    return out(`code: unknown subcommand ${sub}`);
  }

  return out(`unknown command: ${cmd}`);
}

export default handleCommand;
