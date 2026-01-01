import { describe, it, expect } from 'vitest';
import { startVaultServer } from '../../server/vaultServer';
import * as secretVault from '../secretVault';

describe('server-backed vault integration', async () => {
  it('saves and fetches secrets from the server', async () => {
    const token = 'integ-token-123';
    const server = await startVaultServer({ token });

    try {
      secretVault.setBackendUrl(server.url);

      const secrets = { gemini: 'g1', openai: 'o1', anthropic: 'a1', ollama: 'u1', defaultProvider: 'gemini' };
      const saved = await secretVault.saveSecretsToServer(token, secrets);
      expect(saved).toBe(true);

      const fetched = await secretVault.fetchSecretsFromServer(token);
      expect(fetched).toEqual(secrets);
    } finally {
      await server.stop();
    }
  });
});
