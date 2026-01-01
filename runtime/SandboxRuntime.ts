import { FileSystemState, Package } from '../types';
import { getInitialFileSystem } from '../constants';

const STORAGE_KEYS = {
  FS_STATE: 'fs_state',
  PACKAGES: 'packages',
  CHAT_HISTORY: 'chat_history',
} as const;

export class SandboxRuntime {
  public readonly sessionId: string;
  private readonly storagePrefix: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.storagePrefix = `project_${sessionId}`;
  }

  private getKey(key: string): string {
    return `${this.storagePrefix}_${key}`;
  }

  private getFromStorage<T>(key: string, defaultValue: T): T {
    try {
      const saved = localStorage.getItem(this.getKey(key));
      if (saved) return JSON.parse(saved) as T;
    } catch (e) {
      console.error(`Failed to load ${key}:`, e);
    }
    return defaultValue;
  }

  private setToStorage<T>(key: string, value: T): void {
    localStorage.setItem(this.getKey(key), JSON.stringify(value));
  }

  public getFileSystem(): FileSystemState {
    return this.getFromStorage(STORAGE_KEYS.FS_STATE, { root: getInitialFileSystem() });
  }

  public saveFileSystem(fs: FileSystemState): void {
    this.setToStorage(STORAGE_KEYS.FS_STATE, fs);
  }

  public getPackages(): Package[] {
    return this.getFromStorage(STORAGE_KEYS.PACKAGES, []);
  }

  public savePackages(packages: Package[]): void {
    this.setToStorage(STORAGE_KEYS.PACKAGES, packages);
  }

  public installPackage(pkg: Package): Package[] {
    const current = this.getPackages();
    const exists = current.some(p => p.name === pkg.name && p.manager === pkg.manager);
    if (exists) return current;
    
    const updated = [...current, pkg];
    this.savePackages(updated);
    return updated;
  }

  public uninstallPackage(pkg: Package): Package[] {
    const current = this.getPackages();
    const updated = current.filter(p => !(p.name === pkg.name && p.manager === pkg.manager));
    this.savePackages(updated);
    return updated;
  }

  public reset(): void {
    this.saveFileSystem({ root: getInitialFileSystem() });
    this.savePackages([]);
    this.setToStorage(STORAGE_KEYS.CHAT_HISTORY, []);
  }

  public clearAll(): void {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(this.getKey(key));
    });
  }
}
