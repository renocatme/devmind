
import React from 'react';
import { GitBranch, Wifi, Bell, Check } from 'lucide-react';

interface StatusBarProps {
  sessionId: string;
  activeFile: string | null;
  isProcessing: boolean;
  fileLanguage: string;
}

const StatusBar: React.FC<StatusBarProps> = ({ sessionId, activeFile, fileLanguage }) => {
  return (
    <div className="h-6 bg-[#007acc] text-white flex items-center px-3 text-[11px] justify-between select-none z-30">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 hover:bg-white/20 px-1 rounded cursor-pointer transition-colors">
                <GitBranch size={10} />
                <span>main</span>
            </div>
            <div className="flex items-center gap-1 px-1">
                <span className="opacity-80">0 errors</span>
                <span className="opacity-80">0 warnings</span>
            </div>
        </div>
        
        <div className="flex items-center gap-4">
             {activeFile && (
                 <div className="flex items-center gap-3">
                    <span className="cursor-pointer hover:text-white/80">Ln 1, Col 1</span>
                    <span className="cursor-pointer hover:text-white/80">UTF-8</span>
                    <span className="font-bold cursor-pointer hover:text-white/80">{fileLanguage.toUpperCase()}</span>
                 </div>
             )}
            <div className="flex items-center gap-2 hover:bg-white/20 px-1 rounded cursor-pointer transition-colors">
                <Wifi size={10} />
                <span>Connected</span>
            </div>
            <Bell size={10} className="cursor-pointer hover:text-white/80" />
        </div>
    </div>
  );
};

export default StatusBar;
