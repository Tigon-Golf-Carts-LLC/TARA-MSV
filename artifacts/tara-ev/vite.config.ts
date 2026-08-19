import path from 'path';
import fs from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const port = Number(process.env.PORT || 4173);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const rawBasePath = process.env.BASE_PATH || '/';
const basePath = `/${rawBasePath.replace(/^\/|\/$/g, '')}${
  rawBasePath === '/' ? '' : '/'
}`;
const siteDomain = (process.env.SITE_DOMAIN || 'https://taramsv.com').replace(
  /\/$/,
  '',
);
const siteBaseUrl = `${siteDomain}${basePath === '/' ? '' : basePath.slice(0, -1)}`;

const DEV_REDIRECTS: Record<string, string> = {
  // Percent-encoding case duplicate: lowercase hex → uppercase canonical.
  // Matched against the raw request URL before any decoding.
  '/news/a-complete-analysis-of-lsvs-what-are-low-speed-%e2%80%8b%e2%80%8bvehicles/':
    '/news/a-complete-analysis-of-lsvs-what-are-low-speed-%E2%80%8B%E2%80%8Bvehicles/',
  '/explorer-2-2-product/': '/explorer-2-2-golf-cart-product/',
  '/horizon-4-product/': '/horizon-4-golf-cart-product/',
  '/horizon-6-product/': '/horizon-6-golf-cart-product/',
  '/lander-4-product/': '/lander-4-golf-cart-product/',
  '/lander-6-product/': '/lander-6-golf-cart-product/',
  '/spirit-plus-product/': '/spirit-plus-fleet-golf-cart-product/',
  '/t3-2-2-product/': '/t3-2-2-golf-cart-product/',
  '/t3-22-product/': '/t3-2-2-golf-cart-product/',
  '/t3-2-2-lifted-product/': '/t3-2-2-lifted-golf-cart-product/',
  '/t3-22-lifted-product/': '/t3-2-2-lifted-golf-cart-product/',
  '/varranty-terms/': '/warranty-terms/',
  '/mainitenance-support/': '/maintenance-support/',
  '/techncal-support/': '/technical-support/',
};
const absoluteOgUrls = () => ({
  name: 'absolute-og-urls',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    return html.replace(
      /(<meta\s+property="og:(?:image|url)"\s+content=")(\/[^"]*)(")/g,
      (_m, pre, urlPath, post) => `${pre}${siteBaseUrl}${urlPath}${post}`,
    );
  },
});

// ─── Per-route metadata helpers (shared by dev middleware + prerender) ─────────

function escHtml(str: string) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractDescription(html: string): string {
  const cleaned = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const pMatches = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length < 50 || text.includes(' / ')) continue;
    return text.length > 158 ? text.slice(0, 157) + '…' : text;
  }
  const fallback = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return fallback.length > 158 ? fallback.slice(0, 157) + '…' : fallback;
}

function extractOgImage(html: string): string {
  const SKIP = /logo|favicon|menu-image|icon/i;
  for (const m of html.matchAll(/src=["']([^"']+\.(?:webp|jpg|jpeg|png))["']/gi)) {
    const src = m[1];
    if (SKIP.test(src)) continue;
    if (src.startsWith('/images/') || src.startsWith('/uploads/')) return src;
  }
  return '/images/og-image.png';
}

function injectRouteMeta(
  shellHtml: string,
  routePath: string,
  routeTitle: string,
  contentHtml: string,
  origin: string,
): string {
  const description = extractDescription(contentHtml);
  const ogImage = extractOgImage(contentHtml);
  const canonicalUrl = `${origin}${routePath}`;
  const absoluteOgImage = ogImage.startsWith('http') ? ogImage : `${origin}${ogImage}`;

  let html = shellHtml;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(routeTitle)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[^>]*\/?>/i,
    `<meta name="description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${escHtml(routeTitle)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"[^>]*\/?>/i,
    `<meta property="og:description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:image"[^>]*\/?>/i,
    `<meta property="og:image" content="${absoluteOgImage}" />`,
  );
  const canonicalBlock = [
    `  <link rel="canonical" href="${canonicalUrl}" />`,
    `  <meta property="og:url" content="${canonicalUrl}" />`,
  ].join('\n');
  html = html.replace('</head>', `${canonicalBlock}\n</head>`);
  // Embed page content for crawlers
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="1">${contentHtml}</div>`,
  );
  return html;
}

// ─── Dev middleware: serves per-route pre-rendered HTML ───────────────────────

type RouteMeta = { file: string; title: string; bodyClass: string };
type Routes = Record<string, RouteMeta>;

const spaMetaMiddleware = (): Plugin => ({
  name: 'spa-meta-middleware',
  apply: 'serve' as const,
  configureServer(server: ViteDevServer) {
    const artifactDir = path.resolve(import.meta.dirname);
    const publicContentDir = path.join(artifactDir, 'public', 'content');
    const routesPath = path.join(publicContentDir, 'routes.json');

    server.middlewares.use(async (req, res, next) => {
      // Only intercept HTML navigation requests (not assets)
      const accept = req.headers['accept'] ?? '';
      if (!accept.includes('text/html')) return next();

      let reqPath = req.url?.split('?')[0] ?? '/';
      // Strip base path prefix so we match routes.json keys
      const base = basePath.replace(/\/$/, '');
      if (base && reqPath.startsWith(base)) {
        reqPath = reqPath.slice(base.length) || '/';
      }
      if (reqPath !== '/' && !reqPath.endsWith('/')) reqPath += '/';

      // Don't intercept Vite internal requests
      if (reqPath.startsWith('/@') || reqPath.startsWith('/node_modules/')) {
        return next();
      }

      let routes: Routes;
      try {
        routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      } catch {
        return next();
      }

      const meta = routes[reqPath];
      if (!meta) return next();

      const contentFile = path.join(publicContentDir, meta.file);
      if (!fs.existsSync(contentFile)) return next();

      try {
        const contentHtml = fs.readFileSync(contentFile, 'utf8');
        // Get the shell HTML from Vite's index transform pipeline
        let shellHtml = fs.readFileSync(
          path.join(artifactDir, 'index.html'),
          'utf8',
        );
        // Run Vite's own HTML transforms (so script tags are correct)
        shellHtml = await server.transformIndexHtml(reqPath, shellHtml);

        const devOrigin = req.headers.host
          ? `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`
          : 'http://localhost';

        const pageHtml = injectRouteMeta(
          shellHtml,
          reqPath,
          meta.title,
          contentHtml,
          devOrigin,
        );

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(pageHtml);
      } catch {
        return next();
      }
    });
  },
});

export default defineConfig({
  base: basePath,
  define: {
    __SITE_BASE_URL__: JSON.stringify(siteBaseUrl),
  },
  plugins: [
    redirectPlugin(),
    absoluteOgUrls(),
    spaMetaMiddleware(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});

function redirectPlugin() {
  const handler = (
    server: import('vite').ViteDevServer | import('vite').PreviewServer,
  ) => {
    server.middlewares.use((req, res, next) => {
      const raw = req.url?.split('?')[0] ?? '/';
      // Strip base path prefix so lookup keys always start with '/'.
      const stripped =
        basePath !== '/' && raw.startsWith(basePath.replace(/\/$/, ''))
          ? raw.slice(basePath.replace(/\/$/, '').length) || '/'
          : raw;
      const normalized =
        !stripped.includes('.') && !stripped.endsWith('/')
          ? stripped + '/'
          : stripped;
      const target = DEV_REDIRECTS[normalized];
      if (target) {
        res.writeHead(301, { Location: target });
        res.end();
        return;
      }
      next();
    });
  };
  return {
    name: 'canonical-redirects',
    configureServer: handler,
    configurePreviewServer: handler,
  };
}
