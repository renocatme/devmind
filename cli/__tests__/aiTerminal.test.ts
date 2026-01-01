import { describe, it, expect } from 'vitest';
import { suggestCommands } from '../aiTerminal';

describe('aiTerminal', () => {
  it('suggests install commands when prompt mentions install', async () => {
    const s = await suggestCommands('please install dependencies');
    expect(s[0].command).toContain('install');
  });

  it('returns fallback suggestion when nothing matched', async () => {
    const s = await suggestCommands('unknown task');
    expect(s[0].command).toContain('No suggestion');
  });
});
