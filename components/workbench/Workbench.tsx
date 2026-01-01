
import React, { useState, useEffect } from 'react';
import { useSession } from '../../contexts/SessionContext';
import { ActivityBar } from './ActivityBar';
import { SidePanel } from './SidePanel';
import StatusBar from './StatusBar';
import CodeEditor from '../CodeEditor';
import Terminal from '../Terminal';
import CliTerminalWrapper from '../CliTerminalWrapper';
import ChatInterface from '../chat/ChatInterface';
import PreviewPane from '../PreviewPane';
import { AgentBadge } from './AgentBadge';
import { clsx } from 'clsx';
import { PanelRightClose, PanelRightOpen, Terminal as TerminalIcon, X, Maximize2, Minimize2, Code2, LayoutTemplate, Settings } from 'lucide-react';
import LLMConfigPanel from './LLMConfigPanel';
import { readFileNode, writeFileNode } from '../../services/virtualFileSystem';

export default function Workbench() {
    const { sessionId, activeProfile, fs, setFs, terminalLines } = useSession();
    
    // Layout State
    const [leftPanelOpen, setLeftPanelOpen] = useState(true);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);
    const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
    const [activeActivity, setActiveActivity] = useState<'files' | 'git' | 'search'>('files');
    const [rightTab, setRightTab] = useState<'chat' | 'preview'>('chat');
    const [llmPanelOpen, setLlmPanelOpen] = useState(false);

    // Editor State
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [activeFileContent, setActiveFileContent] = useState('');

    const handleFileSelect = (path: string) => {
        const content = readFileNode(fs.root, path);
        if (!content.startsWith('Error')) {
            setActiveFile(path);
            setActiveFileContent(content);
            // Auto-switch to preview for HTML/MD
            if (path.endsWith('.html') || path.endsWith('.md')) {
                // Optional: setRightTab('preview'); 
            }
        }
    };

    const handleEditorChange = (value: string | undefined) => {
        if (value !== undefined && activeFile) {
            setActiveFileContent(value);
            // Auto-save to virtual FS
            setFs((prev: any) => ({ ...prev, root: writeFileNode(prev.root, activeFile, value) }));
        }
    };

    return (
        <div className="flex flex-col h-screen bg-[#09090b] text-gray-200 overflow-hidden font-sans selection:bg-blue-500/30">
            
            {/* Main Workspace Area */}
            <div className="flex-1 flex overflow-hidden">
                
                {/* 1. Activity Bar (Leftmost) */}
                <ActivityBar 
                    activeActivity={activeActivity} 
                    onActivityChange={(act) => { setActiveActivity(act); setLeftPanelOpen(true); }} 
                />

                {/* 2. Side Panel (Explorer/Git) */}
                {leftPanelOpen && (
                    <SidePanel 
                        width={260} 
                        activeActivity={activeActivity}
                        onClose={() => setLeftPanelOpen(false)} 
                        onFileSelect={handleFileSelect} 
                    />
                )}

                {/* 3. Center Editor & Terminal Group */}
                <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] border-r border-[#27272a] relative">
                    
                    {/* Editor Tabs / Breadcrumbs */}
                    <div className="h-9 bg-[#18181b] border-b border-[#27272a] flex items-center justify-between px-3 select-none">
                        <div className="flex items-center gap-3">
                            {!leftPanelOpen && (
                                <button onClick={() => setLeftPanelOpen(true)} className="text-neutral-500 hover:text-white transition-colors">
                                    <LayoutTemplate size={14} />
                                </button>
                            )}
                            <div className="flex items-center gap-2 text-xs text-neutral-400">
                                <Code2 size={12} className={activeFile ? "text-blue-400" : "text-neutral-600"} />
                                <span className="font-mono">{activeFile || 'Welcome'}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                             {/* Context indicator for Agent */}
                             {activeFile && (
                                 <span className="text-[9px] bg-blue-900/20 text-blue-400 border border-blue-900/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                                     <div className="w-1 h-1 rounded-full bg-blue-400 animate-pulse"></div>
                                     In Context
                                 </span>
                             )}
                        </div>
                    </div>

                    {/* Code Editor */}
                    <div className="flex-1 relative">
                        {activeFile ? (
                            <CodeEditor 
                                fileName={activeFile} 
                                content={activeFileContent} 
                                language={activeFile.endsWith('.py') ? 'python' : activeFile.endsWith('.tsx') ? 'typescript' : 'javascript'} 
                                onChange={handleEditorChange} 
                            />
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-neutral-600 gap-4 bg-[#1e1e1e]">
                                <div className="w-20 h-20 rounded-2xl bg-[#252525] border border-[#333] flex items-center justify-center shadow-2xl">
                                    <Code2 size={40} className="opacity-20" />
                                </div>
                                <div className="text-center">
                                    <p className="font-medium text-sm text-neutral-400">Omni-Engine</p>
                                    <p className="text-xs text-neutral-600 mt-1">Select a file or ask the agent to scaffold.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Bottom Panel (Terminal) */}
                    <div className={clsx("border-t border-[#27272a] bg-black flex flex-col transition-all duration-300 ease-out", bottomPanelOpen ? "h-64" : "h-8")}>
                        <div className="flex items-center justify-between px-3 h-8 bg-[#18181b] cursor-pointer hover:bg-[#202023]" onClick={() => setBottomPanelOpen(!bottomPanelOpen)}>
                            <div className="flex items-center gap-2 text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                                <TerminalIcon size={12} /> Terminal
                            </div>
                            <div className="flex items-center gap-2 text-neutral-500">
                                {bottomPanelOpen ? <Minimize2 size={12}/> : <Maximize2 size={12}/>}
                            </div>
                        </div>
                        {bottomPanelOpen && (
                            <div className="flex-1 p-1">
                                <CliTerminalWrapper />
                            </div>
                        )}
                    </div>
                </div>

                {/* 4. Right Panel (Agent / Preview) */}
                {rightPanelOpen ? (
                    <div className="w-[450px] bg-[#09090b] flex flex-col border-l border-[#27272a] shadow-2xl z-10">
                         {/* Right Panel Header */}
                         <div className="h-9 flex items-center border-b border-[#27272a] bg-[#18181b] px-2 gap-1">
                             <button 
                                onClick={() => setRightTab('chat')} 
                                className={clsx("flex-1 text-[11px] font-bold uppercase tracking-wide py-1.5 rounded-md transition-all", rightTab === 'chat' ? "bg-[#27272a] text-white shadow-sm" : "text-neutral-500 hover:text-neutral-300")}
                             >
                                 Agent Interface
                             </button>
                             <button 
                                onClick={() => setRightTab('preview')} 
                                className={clsx("flex-1 text-[11px] font-bold uppercase tracking-wide py-1.5 rounded-md transition-all", rightTab === 'preview' ? "bg-[#27272a] text-white shadow-sm" : "text-neutral-500 hover:text-neutral-300")}
                             >
                                 Live Preview
                             </button>
                             <button onClick={() => setLlmPanelOpen(v => !v)} className="p-1.5 text-neutral-500 hover:text-white hover:bg-[#27272a] rounded-md transition-colors" title="LLM Settings"><Settings size={14} /></button>
                             <button onClick={() => setRightPanelOpen(false)} className="p-1.5 text-neutral-500 hover:text-white hover:bg-red-900/20 rounded-md transition-colors"><X size={14}/></button>
                         </div>

                         {/* Right Panel Content */}
                         <div className="flex-1 overflow-hidden relative">
                             {llmPanelOpen ? (
                                 <LLMConfigPanel />
                             ) : rightTab === 'chat' ? (
                                 <div className="h-full flex flex-col">
                                     <div className="px-4 py-2 border-b border-[#27272a] bg-[#0c0c0e]">
                                         <AgentBadge profile={activeProfile} />
                                     </div>
                                     <div className="flex-1 overflow-hidden">
                                         <ChatInterface activeFileContext={activeFile ? { name: activeFile, content: activeFileContent } : undefined} />
                                     </div>
                                 </div>
                             ) : (
                                 <PreviewPane content={activeFileContent} fileName={activeFile || ''} />
                             )}
                         </div>
                    </div>
                ) : (
                    <div className="w-10 border-l border-[#27272a] bg-[#18181b] flex flex-col items-center py-4 gap-4">
                        <button onClick={() => setRightPanelOpen(true)} className="p-2 hover:bg-[#27272a] rounded text-neutral-400 hover:text-blue-400 transition-colors" title="Open Agent">
                            <PanelRightOpen size={18} className="rotate-180" />
                        </button>
                    </div>
                )}
            </div>

            {/* 5. Status Bar (Global) */}
            <StatusBar 
                sessionId={sessionId} 
                activeFile={activeFile} 
                isProcessing={false} 
                fileLanguage={activeFile ? activeFile.split('.').pop() || 'txt' : ''} 
            />
        </div>
    );
}
