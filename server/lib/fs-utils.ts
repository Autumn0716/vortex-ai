import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function walkDirectory(directoryPath: string): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(nextPath)));
      continue;
    }
    files.push(nextPath);
  }

  return files;
}
