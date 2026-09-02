import * as SecureStore from 'expo-secure-store';

import type { ProviderId } from './types';

/**
 * API keys live in the device keystore — Keychain on iOS, EncryptedSharedPreferences
 * on Android — and nowhere else.
 *
 * Deliberately NOT in the resource cache: that tier persists to AsyncStorage,
 * which is plain text on disk and is dumped wholesale by the devtools panel.
 * Keys are never logged, never rendered in full, and never leave the device
 * except in the Authorization header of the provider the user chose.
 */

const PREFIX = 'llm-key.';

function slot(provider: ProviderId) {
  return `${PREFIX}${provider}`;
}

export async function saveKey(provider: ProviderId, key: string): Promise<void> {
  await SecureStore.setItemAsync(slot(provider), key.trim(), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadKey(provider: ProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(slot(provider));
  } catch {
    // A keystore read can fail on a locked or restored device. Treat it as
    // absent rather than crashing the screen.
    return null;
  }
}

export async function deleteKey(provider: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(slot(provider));
}

/**
 * Safe-to-render fingerprint: enough to recognise which key is stored, not
 * enough to reconstruct it. Short keys collapse entirely rather than leaking a
 * meaningful fraction of their characters.
 */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '•'.repeat(8);
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
