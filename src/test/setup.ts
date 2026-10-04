// Serve public/ to fetch() so variants' real init() runs under Node.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

vi.stubGlobal('location', { href: 'http://test.local/' });
vi.stubGlobal('fetch', async (input: string | URL) => {
  const path = new URL(String(input)).pathname.replace(/^\//, '');
  return new Response(readFileSync(PUBLIC + path), { status: 200 });
});

export const readPublic = (p: string) => readFileSync(PUBLIC + p, 'utf8');
