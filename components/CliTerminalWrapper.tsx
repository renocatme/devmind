import React, { useState, useCallback, useEffect, useRef } from 'react';
import Terminal, { TerminalHandle } from './Terminal';
import { useWebContainer } from '../runtime/webcontainer/useWebContainer';
import { handleCommand } from '../cli/commandHandler';
import { useSession } from '../contexts/SessionContext';

import * as idb from '../services/indexedDB';

const LINES_KEY = 'project.terminal.lines';
const HISTORY_KEY = 'project.terminal.history';
const MODE_KEY = 'project.terminal.mode';
const SEARCH_KEY = 'project.terminal.searchQuery';

const CliTerminalWrapper: React.FC = () => {
  const { boot, readFile, writeFile, readDir, isBooted } = useWebContainer();
  const { terminalLines, addTerminalLine } = useSession();

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [mode, setMode] = useState<'cli' | 'raw'>('cli');
  const [persistedSearch, setPersistedSearch] = useState('');

  const histIndex = useRef<number>(history.length);

  // Load persisted values from IDB/localStorage fallback
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rawHist = await idb.getItem(HISTORY_KEY);
        if (mounted && rawHist) setHistory(JSON.parse(rawHist));
      } catch {}

      try {
        const rawMode = await idb.getItem(MODE_KEY);
        if (mounted && rawMode) setMode(rawMode as 'cli' | 'raw');
      } catch {}

      try {
        const rawSearch = await idb.getItem(SEARCH_KEY);
        if (mounted && rawSearch) setPersistedSearch(rawSearch);
      } catch {}

      try {
        const rawLines = await idb.getItem(LINES_KEY);
        // We don't set terminalLines here; session manages lines. But keep for compatibility.
      } catch {}
    })();

    return () => { mounted = false; };
  }, []);

  // Persist history when it changes
  useEffect(() => {
    try { idb.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
    histIndex.current = history.length;
  }, [history]);

  useEffect(() => { try { idb.setItem(MODE_KEY, mode); } catch {} }, [mode]);

  // Persist terminal lines when they change (session still holds canonical state)
  useEffect(() => {
    try { idb.setItem(LINES_KEY, JSON.stringify(terminalLines)); } catch {}
  }, [terminalLines]);

  const append = useCallback((l: string) => addTerminalLine(l), [addTerminalLine]);

  const onSubmit = async () => {
    const value = input.trim();
    if (!value) return;
    setInput('');
    setHistory(h => [...h, value]);
    append(`$ ${value}`);

    // Ensure runtime is booted
    if (!isBooted) {
      const ok = await boot();
      if (!ok) {
        append('error: runtime failed to boot');
        return;
      }
    }

    // Handle command via handler using runtime actions
    await handleCommand({ readFile, writeFile, readDir } as any, value, append);
  };

  // History navigation (up/down)
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      histIndex.current = Math.max(0, histIndex.current - 1);
      setInput(history[histIndex.current] || '');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      histIndex.current = Math.min(history.length, histIndex.current + 1);
      setInput(history[histIndex.current] || '');
      return;
    }
  };

  const clearTerminal = () => {
    append('\x1b[1;32mTerminal cleared\x1b[0m');
    try { localStorage.removeItem(LINES_KEY); } catch {}
    // Add a visual separator
    append('\x1b[1;32m---\x1b[0m');
  };

  const copyTerminal = async () => {
    try {
      await navigator.clipboard.writeText(terminalLines.join('\n'));
      append('> copied terminal to clipboard');
    } catch (e) {
      append('error: failed to copy to clipboard');
    }
  };

  const exportTerminal = () => {
    try {
      const blob = new Blob([terminalLines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `terminal-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      append('> exported terminal to file');
    } catch (e) {
      append('error: export failed');
    }
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const runSearch = () => {
    if (!searchQuery) return;
    // Persist search query so Terminal can highlight matches
    try { idb.setItem(SEARCH_KEY, searchQuery); setPersistedSearch(searchQuery); } catch {}
    const q = searchQuery.toLowerCase();
    const matches = terminalLines.filter(l => l.toLowerCase().includes(q));
    append(`> search: ${matches.length} matches for "${searchQuery}"`);
    for (const m of matches.slice(0, 50)) {
      append(`> ${m}`);
    }
    setSearchOpen(false);
  };

  const [matchIndex, setMatchIndex] = useState<number>(-1);
  const terminalHandle = useRef<TerminalHandle | null>(null);

  const computeMatchIndices = () => {
    const q = (persistedSearch || '').toLowerCase();
    if (!q) return [] as number[];
    return terminalLines.map((l, i) => l.toLowerCase().includes(q) ? i : -1).filter(i => i >= 0);
  };

  const gotoMatch = (idx: number) => {
    const matches = computeMatchIndices();
    if (matches.length === 0) {
      append('> no matches');
      setMatchIndex(-1);
      return;
    }
    const normalized = ((idx % matches.length) + matches.length) % matches.length;
    setMatchIndex(normalized);
    const targetLine = matches[normalized];
    append(`> match ${normalized + 1}/${matches.length}: ${terminalLines[targetLine]}`);
    // scroll the xterm to that buffer line
    try { terminalHandle.current?.scrollToLine(targetLine); } catch {}
  };

  const nextMatch = () => gotoMatch(matchIndex + 1);
  const prevMatch = () => gotoMatch(matchIndex - 1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#27272a] bg-[#0c0c0e]">
        <div className="text-xs text-neutral-400 font-bold flex items-center gap-2">
          <span>Terminal</span>
          <button onClick={() => setMode(m => m === 'cli' ? 'raw' : 'cli')}
            className="px-2 py-0.5 text-[11px] bg-[#1f1f23] rounded">
            {mode === 'cli' ? 'CLI Mode' : 'Raw Mode'}
          </button>
          <div className="ml-2 text-[11px] text-neutral-300">Matches: {computeMatchIndices().length}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSearchOpen(s => !s)} className="text-sm text-neutral-400 hover:text-white px-2">Search</button>
          <button onClick={prevMatch} className="text-sm text-neutral-400 hover:text-white px-2">◀</button>
          <button onClick={nextMatch} className="text-sm text-neutral-400 hover:text-white px-2">▶</button>
          <button onClick={copyTerminal} className="text-sm text-neutral-400 hover:text-white px-2">Copy</button>
          <button onClick={exportTerminal} className="text-sm text-neutral-400 hover:text-white px-2">Export</button>
          <button onClick={clearTerminal} className="text-sm text-neutral-400 hover:text-white px-2">Clear</button>
        </div>
      </div>

      <div className="flex-1">
        <Terminal ref={terminalHandle as any} lines={terminalLines} />
      </div>

      {searchOpen && (
        <div className="p-2 border-t bg-[#09090b] flex gap-2 items-center">
          <input className="flex-1 p-2 bg-black text-white" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search terminal..." />
          <button onClick={runSearch} className="px-3 py-1 bg-blue-600 rounded text-white">Find</button>
          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="px-3 py-1 bg-[#333] rounded text-white">Close</button>
        </div>
      )}

      {mode === 'cli' && !searchOpen && (
        <div className="p-2 border-t bg-[#09090b]">
          <input
            className="w-full p-2 bg-black text-white"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command, e.g. 'file read /path/to/file' (ArrowUp for history)"
          />
        </div>
      )}
    </div>
  );
};

export default CliTerminalWrapper;
