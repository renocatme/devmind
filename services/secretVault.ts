// Simple encrypted session-backed vault using Web Crypto

const VAULT_KEY = 'project.vault.data';

function toUint8(str: string) {
  return new TextEncoder().encode(str);
}

function fromUint8(buf: ArrayBuffer) {
  return new TextDecoder().decode(buf);
}

function toBase64(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKey(password: string, salt: Uint8Array) {
  const pwKey = await (globalThis.crypto as any).subtle.importKey(
    'raw',
    toUint8(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return (globalThis.crypto as any).subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    pwKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function setSecrets(password: string, secrets: Record<string, string>) {
  if (typeof globalThis.crypto === 'undefined') throw new Error('Web Crypto not available');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = toUint8(JSON.stringify(secrets));
  const cipher = await (globalThis.crypto as any).subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  const payload = {
    salt: toBase64(salt.buffer),
    iv: toBase64(iv.buffer),
    cipher: toBase64(cipher)
  };

  sessionStorage.setItem(VAULT_KEY, JSON.stringify(payload));
}

export async function getSecrets(password: string): Promise<Record<string, string> | null> {
  const raw = sessionStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  const payload = JSON.parse(raw);
  const salt = new Uint8Array(fromBase64(payload.salt));
  const iv = new Uint8Array(fromBase64(payload.iv));
  const cipher = fromBase64(payload.cipher);
  const key = await deriveKey(password, salt);
  try {
    const plain = await (globalThis.crypto as any).subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    const text = fromUint8(plain);
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid password or corrupted vault');
  }
}

export function clearVault() {
  sessionStorage.removeItem(VAULT_KEY);
}

// Server-backed vault hooks
let backendUrl: string | null = null;

export function setBackendUrl(url: string | null) {
  backendUrl = url;
}

export async function saveSecretsToServer(token: string, secrets: Record<string, string>) {
  if (!backendUrl) throw new Error('No backend URL configured');
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/vault/secrets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(secrets),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Server error: ${res.status} ${txt}`);
  }

  return true;
}

export async function fetchSecretsFromServer(token: string): Promise<Record<string, string> | null> {
  if (!backendUrl) throw new Error('No backend URL configured');
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/vault/secrets`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Server error: ${res.status} ${txt}`);
  }

  return await res.json();
}
