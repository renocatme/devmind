# LLM Configuration (DevMind)

This document explains how to configure LLM providers for DevMind.

## Options

- You can provide API keys for Gemini, OpenAI, Anthropic and an Ollama Base URL.
- Keys can be stored in two ways:
  - LocalStorage (default) — convenient for local development, not secure.
  - Session Vault — encrypted and stored in `sessionStorage` (cleared when the browser session ends). The vault uses a password and Web Crypto AES-GCM to encrypt values.

## Using the UI

1. Open the right panel and click the settings (gear) icon to open the LLM Settings panel.
2. Paste provider keys in the appropriate fields.
3. Optionally enable `Use Vault (session-encrypted)` and provide a strong password.
4. Click `Save` to persist keys. If using vault, keys are encrypted into session storage; otherwise saved to localStorage.
5. The app exposes keys as browser globals so the in-app `code explain` command can use them. For local/experimental usage this is acceptable; do not use for production workloads.

## Security notes

- LocalStorage is persistent and not secure; avoid storing production API keys there.
- The session vault stores encrypted secrets in `sessionStorage`; the encryption key is derived from your password and not stored. If you forget the password, the vault data is unrecoverable.
- For production usage, integrate a secure secret manager or server-side key store. This UI is a developer convenience.

## Programmatic access

The `LLMConfigPanel` exposes values to `window` globals so client-side code can pick them up. Alternatively, you can call the in-app `secretVault` service (see `services/secretVault.ts`) to set/get secrets programmatically with a password.

