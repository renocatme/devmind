import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSandbox } from '../hooks/useSandbox';
import { AGENT_PROFILES } from '../lib/agent_profiles';
import { 
  AgentRole, 
  AgentProfile, 
  AgentContext, 
  FileSystemState, 
  Package, 
  Message, 
  Sender,
  TerminalLineType
} from '../types';

// ============================================
// TYPES
// ============================================

interface SessionContextType {
  sessionId: string;
  refreshSession: () => void;
  fs: FileSystemState;
  setFs: React.Dispatch<React.SetStateAction<FileSystemState>>;
  packages: Package[];
  setPackages: React.Dispatch<React.SetStateAction<Package[]>>;
  terminalLines: string[];
  addTerminalLine: (line: string, type?: TerminalLineType) => void;
  agentContext: AgentContext;
  activeProfile: AgentProfile;
  switchAgent: (role: AgentRole) => void;
  messages: Message[];
  addMessage: (msg: Message) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

// ============================================
// CONSTANTS
// ============================================

const STORAGE_KEYS = {
  SESSION_ID: 'project_sid',
  MESSAGES: (id: string) => `project_${id}_msgs`,
} as const;

const generateSessionId = () => `session_${Math.random().toString(36).substring(2, 11)}`;

const createInitialMessage = (): Message => ({
  id: 'init',
  sender: Sender.AI,
  text: "Ready. How can I help?",
  timestamp: Date.now()
});

// ============================================
// CONTEXT
// ============================================

const SessionContext = createContext<SessionContextType | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionId, setSessionId] = useState<string>(() => 
    localStorage.getItem(STORAGE_KEYS.SESSION_ID) || generateSessionId()
  );

  const sandbox = useSandbox(sessionId);
  const [activeProfile, setActiveProfile] = useState<AgentProfile>(AGENT_PROFILES.orchestrator);
  const [messages, setMessages] = useState<Message[]>([]);

  // Persist session ID
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
  }, [sessionId]);

  // Load messages on session change
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MESSAGES(sessionId));
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch {
        setMessages([createInitialMessage()]);
      }
    } else {
      setMessages([createInitialMessage()]);
    }
  }, [sessionId]);

  // Persist messages
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MESSAGES(sessionId), JSON.stringify(messages));
  }, [messages, sessionId]);

  const refreshSession = useCallback(() => {
    if (window.confirm("Reset Workspace?")) {
      const newId = generateSessionId();
      setSessionId(newId);
      sandbox.resetSandbox();
      setActiveProfile(AGENT_PROFILES.orchestrator);
    }
  }, [sandbox]);

  const switchAgent = useCallback((role: AgentRole) => {
    setActiveProfile(AGENT_PROFILES[role]);
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const value: SessionContextType = {
    sessionId,
    refreshSession,
    ...sandbox,
    activeProfile,
    switchAgent,
    messages,
    addMessage,
    setMessages
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = (): SessionContextType => {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
};
