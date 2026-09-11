import type { PracticeData } from '../../domain/types';
import type { PracticeRepository } from './repository';

export class MemoryRepository implements PracticeRepository {
  private data: PracticeData | null = null;
  async load(): Promise<PracticeData | null> {
    return this.data;
  }
  async save(data: PracticeData): Promise<void> {
    this.data = data;
  }
  async clear(): Promise<void> {
    this.data = null;
  }
}
