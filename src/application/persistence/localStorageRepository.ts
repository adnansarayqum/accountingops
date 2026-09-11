import type { PracticeData } from '../../domain/types';
import { SCHEMA_VERSION, type PracticeRepository } from './repository';

interface Envelope {
  version: number;
  savedAt: string;
  data: PracticeData;
}

export class LocalStorageRepository implements PracticeRepository {
  constructor(private readonly key = 'practiceops.demo') {}

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

  async save(data: PracticeData): Promise<void> {
    try {
      const env: Envelope = { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), data };
      globalThis.localStorage?.setItem(this.key, JSON.stringify(env));
    } catch (err) {
      console.warn('Could not persist demo data', err);
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
