import React, { useEffect, useState } from 'react';
import { DEFAULT_MODELS } from '../../sdk/config';
import * as secretVault from '../../services/secretVault';

const STORAGE_KEY = 'project.llm.config';

export default function LLMConfigPanel() {
  const [config, setConfig] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { gemini: '', openai: '', anthropic: '', ollama: '' , defaultProvider: '' };
    } catch {
      return { gemini: '', openai: '', anthropic: '', ollama: '', defaultProvider: '' };
    }
  });

  const [useVault, setUseVault] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [useServerVault, setUseServerVault] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverToken, setServerToken] = useState('');

  useEffect(() => {
    // expose to window so other modules (codeAnalysis) can pick them up
    try {
      (window as any).GEMINI_API_KEY = config.gemini || undefined;
      (window as any).OPENAI_API_KEY = config.openai || undefined;
      (window as any).ANTHROPIC_API_KEY = config.anthropic || undefined;
      (window as any).OLLAMA_BASE_URL = config.ollama || undefined;
    } catch {}
  }, [config]);

      const save = async () => {
    try {
      if (useServerVault && serverUrl && serverToken) {
        secretVault.setBackendUrl(serverUrl);
        await secretVault.saveSecretsToServer(serverToken, {
          gemini: config.gemini,
          openai: config.openai,
          anthropic: config.anthropic,
          ollama: config.ollama,
          defaultProvider: config.defaultProvider || ''
        });
        alert('Saved to server vault.');
      } else if (useVault && vaultPassword) {
        await secretVault.setSecrets(vaultPassword, {
          gemini: config.gemini,
          openai: config.openai,
          anthropic: config.anthropic,
          ollama: config.ollama,
          defaultProvider: config.defaultProvider || ''
        });
        alert('Saved into session vault.');
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        alert('LLM configuration saved to localStorage.');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save configuration.');
    }
  };

      const loadFromVault = async () => {
    try {
      if (useServerVault) {
        if (!serverUrl || !serverToken) return alert('Enter server URL and token');
        secretVault.setBackendUrl(serverUrl);
        const s = await secretVault.fetchSecretsFromServer(serverToken);
        if (!s) return alert('No vault data on server');
        setConfig({ gemini: s.gemini || '', openai: s.openai || '', anthropic: s.anthropic || '', ollama: s.ollama || '', defaultProvider: s.defaultProvider || '' });
        alert('Loaded keys from server vault into the form');
        return;
      }

      if (!vaultPassword) return alert('Enter vault password');
      const s = await secretVault.getSecrets(vaultPassword);
      if (!s) return alert('No vault data');
      setConfig({ gemini: s.gemini || '', openai: s.openai || '', anthropic: s.anthropic || '', ollama: s.ollama || '', defaultProvider: s.defaultProvider || '' });
      alert('Loaded keys from vault into the form');
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="p-3 h-full overflow-auto bg-[#09090b] text-sm">
      <h3 className="font-bold text-white mb-2">LLM Provider Configuration</h3>

      <label className="block text-xs text-neutral-400 mb-1">Default Provider</label>
      <select
        className="w-full mb-3 p-2 bg-[#0b0b0d] text-white rounded"
        value={config.defaultProvider}
        onChange={(e) => setConfig(c => ({ ...c, defaultProvider: e.target.value }))}
      >
        <option value="">(none)</option>
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
        <option value="ollama">Ollama</option>
      </select>

      <div className="grid grid-cols-1 gap-2">
        <div>
          <label className="block text-xs text-neutral-400">Gemini API Key</label>
          <input className="w-full p-2 bg-[#0b0b0d] text-white rounded" value={config.gemini}
            onChange={(e) => setConfig(c => ({ ...c, gemini: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-neutral-400">OpenAI API Key</label>
          <input className="w-full p-2 bg-[#0b0b0d] text-white rounded" value={config.openai}
            onChange={(e) => setConfig(c => ({ ...c, openai: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-neutral-400">Anthropic API Key</label>
          <input className="w-full p-2 bg-[#0b0b0d] text-white rounded" value={config.anthropic}
            onChange={(e) => setConfig(c => ({ ...c, anthropic: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-neutral-400">Ollama Base URL</label>
          <input className="w-full p-2 bg-[#0b0b0d] text-white rounded" value={config.ollama}
            onChange={(e) => setConfig(c => ({ ...c, ollama: e.target.value }))} />
        </div>
      </div>

      <div className="mt-3">
        <div className="flex gap-2 items-center">
          <button onClick={save} className="px-3 py-1 bg-blue-600 rounded text-white">Save</button>
          <label className="text-xs text-neutral-400 flex items-center gap-2">
            <input type="checkbox" checked={useVault} onChange={e => setUseVault(e.target.checked)} />
            Use Vault (session-encrypted)
          </label>
          <label className="text-xs text-neutral-400 flex items-center gap-2">
            <input type="checkbox" checked={useServerVault} onChange={e => setUseServerVault(e.target.checked)} />
            Use Server Vault
          </label>
        </div>
        {useVault && (
          <div className="mt-2 flex gap-2 items-center">
            <input type="password" placeholder="Vault password" value={vaultPassword} onChange={e => setVaultPassword(e.target.value)} className="p-2 bg-[#0b0b0d] text-white rounded" />
            <button onClick={loadFromVault} className="px-3 py-1 bg-green-600 rounded text-white">Load</button>
          </div>
        )}

        {useServerVault && (
          <div className="mt-2 grid grid-cols-1 gap-2">
            <input className="p-2 bg-[#0b0b0d] text-white rounded" placeholder="Server Vault URL (https://vault.example.com)" value={serverUrl} onChange={e => setServerUrl(e.target.value)} />
            <input className="p-2 bg-[#0b0b0d] text-white rounded" placeholder="Server API Token" value={serverToken} onChange={e => setServerToken(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={loadFromVault} className="px-3 py-1 bg-green-600 rounded text-white">Load from Server</button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs text-neutral-400 mb-1">Available Default Models</h4>
        <div className="bg-[#0b0b0d] p-2 rounded text-xs text-neutral-300">
          {Object.entries(DEFAULT_MODELS).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-[#111] last:border-0">
              <div className="text-sm text-white">{k}</div>
              <div className="text-neutral-400">{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 text-xs text-neutral-400">
        <h4 className="font-semibold text-white mb-1">Usage</h4>
        <p className="mb-1">Paste provider API keys above and press <strong>Save</strong>. Keys are stored in localStorage and exposed to the app via window globals so the in-app code-explain command can use them.</p>
        <p className="mb-1">Set <em>Default Provider</em> to prefer a provider when multiple keys are present. For local LLM (Ollama) set the Base URL.</p>
        <p className="text-neutral-500">Warning: storing keys in localStorage is convenient for local development but not secure for production.</p>
      </div>
    </div>
  );
}
