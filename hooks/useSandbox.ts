import { useState, useEffect, useCallback, useMemo } from 'react';
import { SandboxRuntime } from '../runtime/SandboxRuntime';
import { FileSystemState, Package, AgentContext, TerminalLineType } from '../types';
import { getInitialFileSystem } from '../constants';

const INITIAL_TERMINAL_MESSAGE = '\x1b[1;32mRuntime Initialized\x1b[0m';

export const useSandbox = (sessionId: string) => {
    const runtime = useMemo(() => new SandboxRuntime(sessionId), [sessionId]);

    const [fs, setFs] = useState<FileSystemState>(() => runtime.getFileSystem());
    const [packages, setPackages] = useState<Package[]>(() => runtime.getPackages());
    const [terminalLines, setTerminalLines] = useState<string[]>([INITIAL_TERMINAL_MESSAGE]);

    // Sync state when session changes
    useEffect(() => {
        setFs(runtime.getFileSystem());
        setPackages(runtime.getPackages());
        setTerminalLines([INITIAL_TERMINAL_MESSAGE, `$ Session: ${sessionId}`]);
    }, [runtime, sessionId]);

    // Persist file system changes
    useEffect(() => {
        runtime.saveFileSystem(fs);
    }, [fs, runtime]);

    // Persist package changes
    useEffect(() => {
        runtime.savePackages(packages);
    }, [packages, runtime]);

    const addTerminalLine = useCallback((line: string, type?: TerminalLineType) => {
        setTerminalLines(prev => [...prev, line]);
    }, []);

    const resetSandbox = useCallback(() => {
        runtime.reset();
        setFs({ root: getInitialFileSystem() });
        setPackages([]);
        setTerminalLines(['\x1b[1;32mSandbox Reset Complete\x1b[0m']);
    }, [runtime]);

    const agentContext: AgentContext = useMemo(() => ({
        fs,
        setFs,
        addTerminalLine,
        packages,
        setPackages
    }), [fs, packages, addTerminalLine]);

    return {
        fs,
        setFs,
        packages,
        setPackages,
        terminalLines,
        addTerminalLine,
        agentContext,
        resetSandbox
    };
};
