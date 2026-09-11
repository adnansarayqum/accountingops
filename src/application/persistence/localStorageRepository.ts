import type { PracticeData } from '../../domain/types';
import { SCHEMA_VERSION, type PracticeRepository } from './repository';

interface Envelope {
  version: number;
  savedAt: string;
  data: PracticeData;
}

export class LocalStorageRepository implements PracticeRepository {
  constructor(private readonly key = 'practiceops.data') {}

  async load(): Promise<PracticeData | null> {
    try {
      const raw = globalThis.localStorage?.getItem(this.key);
      if (!raw) return null;
      const env = JSON.parse(raw) as Envelope;
      if (env.version !== SCHEMA_VERSION) return null;
      return env.data;
    } catch {
      return null;
    }
  }

  /**
   * Throws when the browser refuses the write (most often the storage quota,
   * or storage disabled in a private window). The store turns that into the
   * "couldn't save" toast — swallowing it here would leave the change on
   * screen looking saved when it isn't.
   */
  async save(data: PracticeData): Promise<void> {
    const env: Envelope = { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), data };
    try {
      globalThis.localStorage?.setItem(this.key, JSON.stringify(env));
    } catch (err) {
      throw new Error(`Could not persist practice data: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }

  async clear(): Promise<void> {
    try {
      globalThis.localStorage?.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}
