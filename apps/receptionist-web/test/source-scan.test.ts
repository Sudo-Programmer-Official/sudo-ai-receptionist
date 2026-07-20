import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(currentDir, '..');

const forbidden = [
  'OPENAI_API_KEY',
  'SALONFLOW_INTEGRATION_TOKEN',
  'RECEPTIONIST_INTEGRATION_TOKEN_SECRET',
  'process.env',
];

const walk = async (dir: string): Promise<string[]> => {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') {
        continue;
      }
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('frontend source scan', () => {
  test('does not reference secret env names or process.env in browser source', async () => {
    const sourceFiles = (await walk(join(webRoot, 'src'))).concat([
      join(webRoot, 'index.html'),
      join(webRoot, 'vite.config.ts'),
      join(webRoot, 'vercel.json'),
    ]);

    for (const file of sourceFiles) {
      const contents = await readFile(file, 'utf8');
      for (const pattern of forbidden) {
        expect(contents, `${file} should not reference ${pattern}`).not.toContain(pattern);
      }
    }
  });
});
