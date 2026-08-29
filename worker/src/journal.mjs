import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export class JobJournal {
  constructor(dataDir) {
    this.path = resolve(dataDir, '..', 'completed-jobs.json');
    this.entries = new Map();
  }

  async load() {
    try {
      const rows = JSON.parse(await readFile(this.path, 'utf8'));
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row && typeof row.id === 'string' && typeof row.completedAt === 'string') this.entries.set(row.id, row.completedAt);
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  has(jobId) {
    return this.entries.has(jobId);
  }

  async add(jobId) {
    this.entries.set(jobId, new Date().toISOString());
    await this.#save();
  }

  async remove(jobId) {
    if (!this.entries.delete(jobId)) return;
    await this.#save();
  }

  async #save() {
    await mkdir(dirname(this.path), { recursive: true });
    const recent = [...this.entries.entries()]
      .sort((left, right) => right[1].localeCompare(left[1]))
      .slice(0, 500)
      .map(([id, completedAt]) => ({ id, completedAt }));
    this.entries = new Map(recent.map((row) => [row.id, row.completedAt]));
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(recent), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}
