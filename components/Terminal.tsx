import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

interface TerminalProps {
  lines: string[];
  searchQuery?: string;
}

export type TerminalHandle = {
  scrollToLine: (lineIndex: number) => void;
};

const Terminal = forwardRef<TerminalHandle, TerminalProps>(({ lines, searchQuery }, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Initialize Terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      theme: {
        background: '#09090b', // zinc-950
        foreground: '#d4d4d8', // zinc-300
        cursor: '#22c55e', // green-500
        selectionBackground: '#27272a', // zinc-800
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      rows: 12,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();

    term.writeln('\x1b[1;32mAgent Terminal v1.0.0\x1b[0m');
    term.writeln('Sandbox Environment Initialized.');
    term.write('$ ');

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  // Use a ref to track printed index
  const lastPrintedIndex = useRef(0);
  useEffect(() => {
      if(!xtermRef.current) return;
     const newLines = lines.slice(lastPrintedIndex.current);
     if (newLines.length > 0) {
      // Clear the prompt line (mock)
      xtermRef.current.write('\r\x1b[K'); 

      // Use searchQuery prop for highlighting (passed from wrapper)
      let q = searchQuery || '';

      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');

      newLines.forEach(line => {
          let outLine = line;
          if (q) {
            try {
              const re = new RegExp(escapeRegex(q), 'ig');
              // ANSI highlight background yellow with black text
              outLine = outLine.replace(re, (m) => `\x1b[30;43m${m}\x1b[0m`);
            } catch {}
          }

          if (outLine.startsWith('>')) {
            xtermRef.current?.writeln(`\x1b[34m${outLine}\x1b[0m`);
          } else if (outLine.startsWith('$')) {
            xtermRef.current?.writeln(`\x1b[33m${outLine}\x1b[0m`);
          } else if (outLine.toLowerCase().includes('error')) {
            xtermRef.current?.writeln(`\x1b[31m${outLine}\x1b[0m`);
          } else if (outLine.toLowerCase().includes('success')) {
            xtermRef.current?.writeln(`\x1b[32m${outLine}\x1b[0m`);
          } else {
            xtermRef.current?.writeln(outLine);
          }
      });
      
      xtermRef.current.write('$ ');
      lastPrintedIndex.current = lines.length;
      fitAddonRef.current?.fit();
     }
  }, [lines]);

  useImperativeHandle(ref, () => ({
    scrollToLine: (lineIndex: number) => {
      const term = xtermRef.current;
      if (!term) return;

      try {
        const buf = (term as any).buffer?.active;
        if (!buf) return;
        const rows = (term as any).rows || 12;
        const base = buf.base || 0;
        const delta = Math.floor(lineIndex - base - rows / 2);
        if (typeof term.scrollLines === 'function') {
          term.scrollLines(delta);
        } else if (typeof (term as any).scrollToBottom === 'function' && delta > 0) {
          (term as any).scrollToBottom();
        }
      } catch (e) {
        // ignore
      }
    }
  }));

  return <div className="h-full w-full overflow-hidden" ref={terminalRef} />;
});

Terminal.displayName = 'Terminal';
export default Terminal;
