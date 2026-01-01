export interface ParsedCommand {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Very small CLI parser: splits by whitespace, supports flags like --key=value and -f
 */
export function parseCommand(input: string): ParsedCommand {
  const parts = input.trim().match(/(?:"[^"]+"|'[^']+'|\S)+/g) || [];
  const tokens = parts.map(p => {
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      return p.slice(1, -1);
    }
    return p;
  });

  const command = tokens[0] || '';
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const [k, v] = t.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else if (t.startsWith('-') && t.length > 1) {
      for (let j = 1; j < t.length; j++) {
        flags[t[j]] = true;
      }
    } else {
      args.push(t);
    }
  }

  return { command, args, flags };
}

export default parseCommand;
