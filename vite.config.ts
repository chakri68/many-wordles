/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const POOLS = new Set(['missing', 'define', 'events']);
const draftPath = (pool: string) => fileURLToPath(new URL(`./content/drafts/${pool}.json`, import.meta.url));

/** events: one object per line, so git diffs of a review session stay readable */
const serialize = (pool: string, items: unknown[]) =>
  pool === 'events'
    ? '[\n' + items.map((x) => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n'
    : JSON.stringify(items, null, 2) + '\n';

/**
 * Dev-only endpoint behind the #/review screen: GET/POST /__content/<pool>
 * reads and writes content/drafts/<pool>.json. Never part of a build.
 */
function contentReview(): Plugin {
  let writing = false;
  return {
    name: 'content-review',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__content/', (req, res) => {
        const pool = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!POOLS.has(pool)) {
          res.statusCode = 404;
          return res.end('unknown pool');
        }
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          return res.end(readFileSync(draftPath(pool)));
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const items = JSON.parse(body);
            if (!Array.isArray(items)) throw new Error('expected an array');
            writing = true;
            writeFileSync(draftPath(pool), serialize(pool, items));
            setTimeout(() => (writing = false), 500);
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
    // saving from the review screen shouldn't hot-reload the page you're on
    handleHotUpdate(ctx) {
      if (writing && ctx.file.includes('/content/drafts/')) return [];
    },
  };
}

// ---- SEO ------------------------------------------------------------------

interface GameMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
}
const GAMES: GameMeta[] = JSON.parse(readFileSync(new URL('./src/seo/games.json', import.meta.url), 'utf8'));
const FROZEN = JSON.parse(readFileSync(new URL('./src/content/frozen.json', import.meta.url), 'utf8'));
const POOL_OF: Record<string, string> = { missing: 'missing', define: 'define', chrono: 'events' };
/** content games only get a public page once their pool is reviewed + frozen */
const live = (g: GameMeta) => !POOL_OF[g.id] || FROZEN[POOL_OF[g.id]].length > 0;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * - %SITE_URL% -> absolute site URL (SITE_URL env, set by the Pages workflow)
 * - dist/<game>/index.html: same app, own <title>/description/social card.
 *   Hash routes are invisible to link unfurlers, so shared links point here.
 * - sitemap.xml listing the hub and every game page
 */
function seo(): Plugin {
  const site = (process.env.SITE_URL ?? '').replace(/\/?$/, '/').replace(/^\/$/, '');
  let outDir = 'dist';
  return {
    name: 'seo-pages',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', site),
    closeBundle() {
      if (!existsSync(`${outDir}/index.html`)) return; // dev / test
      const base = readFileSync(`${outDir}/index.html`, 'utf8');
      const pages: string[] = [site];
      for (const g of GAMES.filter(live)) {
        const url = `${site}${g.id}/`;
        const title = `${g.name} · Many Wordles`;
        const meta = (attr: string, key: string, value: string) => (h: string) =>
          h.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), `$1${esc(value)}$2`);
        let html = base;
        for (const f of [
          meta('name', 'description', g.description),
          meta('property', 'og:title', title),
          meta('property', 'og:description', g.tagline),
          meta('property', 'og:url', url),
          meta('property', 'og:image', `${site}og/${g.id}.png`),
          meta('property', 'og:image:alt', `${g.name}: ${g.tagline}`),
          meta('name', 'twitter:title', title),
          meta('name', 'twitter:description', g.tagline),
          meta('name', 'twitter:image', `${site}og/${g.id}.png`),
        ])
          html = f(html);
        html = html
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
          // assets are relative to the site root, one level up
          .replace('<head>', '<head>\n    <base href="../" />')
          // land straight in the game
          .replace('<script type="module"', `<script>if (!location.hash) location.hash = '/${g.id}';</script>\n    <script type="module"`);
        mkdirSync(`${outDir}/${g.id}`, { recursive: true });
        writeFileSync(`${outDir}/${g.id}/index.html`, html);
        pages.push(url);
      }
      if (site) {
        const urls = pages.map((u) => `  <url><loc>${u}</loc><changefreq>daily</changefreq></url>`).join('\n');
        writeFileSync(`${outDir}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
        writeFileSync(`${outDir}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`);
      }
    },
  };
}

export default defineConfig({
  base: './', // any static host, any sub-path
  build: { target: 'es2022' },
  worker: { format: 'es' },
  plugins: [contentReview(), seo()],
  test: { environment: 'node', setupFiles: ['src/test/setup.ts'] },
});
