import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCommand } from '../commandHandler';

describe('commandHandler', () => {
  let runtime: any;
  let out: any;

  beforeEach(() => {
    runtime = {
      readFile: vi.fn().mockResolvedValue('line1\nline2\nline3'),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readDir: vi.fn().mockResolvedValue(['a.txt', 'b.txt']),
    };
    out = vi.fn();
  });

  it('reads file', async () => {
    await handleCommand(runtime, 'file read /foo.txt', out);
    expect(runtime.readFile).toHaveBeenCalledWith('/foo.txt');
    expect(out).toHaveBeenCalledWith('$ file:/foo.txt');
  });

  it('previews file with custom lines', async () => {
    await handleCommand(runtime, 'file preview /foo.txt --lines=2', out);
    expect(runtime.readFile).toHaveBeenCalled();
    expect(out).toHaveBeenCalledWith('$ preview:/foo.txt (2 lines)');
  });

  it('write requires confirmation', async () => {
    await handleCommand(runtime, 'file write /x.txt hello', out);
    expect(out).toHaveBeenCalledWith('file write: add --confirm to actually write to /x.txt');
  });

  it('write performs when confirmed', async () => {
    await handleCommand(runtime, 'file write /x.txt hello --confirm', out);
    expect(runtime.writeFile).toHaveBeenCalledWith('/x.txt', 'hello');
    expect(out).toHaveBeenCalledWith('success: wrote /x.txt');
  });

  it('lists directory', async () => {
    await handleCommand(runtime, 'file ls /', out);
    expect(runtime.readDir).toHaveBeenCalledWith('/');
    expect(out).toHaveBeenCalledWith('$ ls:/');
  });
});
