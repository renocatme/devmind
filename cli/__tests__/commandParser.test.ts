import { describe, it, expect } from 'vitest';
import { parseCommand } from '../commandParser';

describe('commandParser', () => {
  it('parses simple command with args', () => {
    const p = parseCommand('echo hello world');
    expect(p.command).toBe('echo');
    expect(p.args).toEqual(['hello', 'world']);
    expect(p.flags).toEqual({});
  });

  it('parses flags --key=value and short flags', () => {
    const p = parseCommand('deploy --env=prod -ab file.txt');
    expect(p.command).toBe('deploy');
    expect(p.args).toEqual(['file.txt']);
    expect(p.flags).toEqual({ env: 'prod', a: true, b: true });
  });

  it('handles quoted args', () => {
    const p = parseCommand('say "hello world"');
    expect(p.args).toEqual(['hello world']);
  });
});
