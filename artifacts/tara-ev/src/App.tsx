import { useEffect, useRef, useState } from 'react';
import { injectStructuredData } from './structuredData';

declare const __SITE_BASE_URL__: string;

const BASE = import.meta.env.BASE_URL; // e.g. "/"
const BASE_PREFIX = BASE === '/' ? '' : BASE.replace(/\/$/, '');
const URL_ATTRIBUTES = [
  'href',
  'src',
  'action',
  'poster',
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-bg',
  'data-background',
] as const;

type RouteMeta = { file: string; title: string; description?: string; bodyClass: string; redirect?: never };

type RouteRedirect = { redirect: string };
type Routes = Record<string, RouteEntry>;

function prefixRootRelativeUrl(value: string): string {
  if (
    !BASE_PREFIX ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value === BASE_PREFIX ||
    value.startsWith(`${BASE_PREFIX}/`)
  ) {
    return value;
  }
  return `${BASE_PREFIX}${value}`;
}

function rewriteInlineCssForBasePath(style: string): string {
  return style.replace(
    /url\((["']?)(\/(?!\/)[^)"']*)\1\)/gi,
    (_match, quote, url) =>
      `url(${quote}${prefixRootRelativeUrl(String(url))}${quote})`,
  );
}

function normalizePath(p: string): string {
  let path = p;
  if (BASE !== '/' && path.startsWith(BASE.replace(/\/$/, ''))) {
    path = path.slice(BASE.replace(/\/$/, '').length) || '/';
  }
  if (!path.startsWith('/')) path = '/' + path;
  if (path !== '/' && !path.endsWith('/')) path += '/';
  return path;
}

/**
 * Keep cloned, root-relative links inside a GitHub Pages project base path.
 * External, protocol-relative, mailto, tel, hash, and data URLs are untouched.
 */
function applyBasePath(root: ParentNode) {
  if (!BASE_PREFIX) return;
  root
    .querySelectorAll<HTMLElement>(
      URL_ATTRIBUTES.map((attribute) => `[${attribute}]`)
        .concat('[srcset]', '[data-srcset]', '[style]')
        .join(', '),
    )
    .forEach((element) => {
      for (const attribute of URL_ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value) {
          element.setAttribute(attribute, prefixRootRelativeUrl(value));
        }
      }

      for (const attribute of ['srcset', 'data-srcset']) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        element.setAttribute(
          attribute,
          value
            .split(',')
            .map((candidate) => {
              const [url, ...descriptor] = candidate.trim().split(/\s+/);
              const nextUrl = prefixRootRelativeUrl(url);
              return [nextUrl, ...descriptor].join(' ');
            })
            .join(', '),
        );
      }

      const style = element.getAttribute('style');
      if (style) {
        element.setAttribute('style', rewriteInlineCssForBasePath(style));
      }
    });
}

/** Prefix cloned URLs before insertion so lazy images cannot request "/" first. */
function rewriteHtmlForBasePath(html: string): string {
  if (!BASE_PREFIX) return html;
  const attributes = URL_ATTRIBUTES.join('|');
  let result = html.replace(
    new RegExp(`\\b(${attributes})=([\"'])(\\/(?!\\/)[^\"']*)\\2`, 'gi'),
    (_match, attribute, quote, value) =>
      `${attribute}=${quote}${prefixRootRelativeUrl(String(value))}${quote}`,
  );
  result = result.replace(
    /\b(srcset|data-srcset)=(["'])([^"']*)\2/gi,
    (_match, attribute, quote, value) => {
      const nextValue = String(value)
        .split(',')
        .map((candidate) => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [
            prefixRootRelativeUrl(url),
            ...descriptor,
          ].join(' ');
        })
        .join(', ');
      return `${attribute}=${quote}${nextValue}${quote}`;
    },
  );
  return rewriteInlineCssForBasePath(result);
}

/** Replace the removed PHP search endpoint with a backend-free site search. */
function makeSearchFormsStatic(root: ParentNode) {
  root
    .querySelectorAll<HTMLFormElement>('form[action="/search.php"]')
    .forEach((form) => {
      form.action = 'https://www.google.com/search';
      form.method = 'get';
      form.querySelector<HTMLInputElement>('input[name="s"]')?.setAttribute(
        'name',
        'q',
      );
      const category = form.querySelector<HTMLInputElement>('input[name="cat"]');
      if (category) {
        category.name = 'sitesearch';
        category.value = 'taramsv.com';
      } else {
        const siteSearch = document.createElement('input');
        siteSearch.type = 'hidden';
        siteSearch.name = 'sitesearch';
        siteSearch.value = 'taramsv.com';
        form.appendChild(siteSearch);
      }
    });
}

function lookupRoute(routes: Routes, path: string): RouteEntry | null {
  if (routes[path]) return routes[path];
  // tolerate percent-encoding case differences
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  for (const key of Object.keys(routes)) {
    try {
      if (decodeURIComponent(key) === decoded) return routes[key];
    } catch {
      /* skip malformed keys */
    }
  }
  return null;
}

/** Wire the product color list to the vehicle image slides (one image per color). */
function initProductColorPicker(root: HTMLElement) {
  const slides = root.querySelectorAll<HTMLElement>('.pro_img .swiper-slide');
  const colors = root.querySelectorAll<HTMLElement>('.pro_color li');
  if (slides.length === 0) return;

  const select = (idx: number) => {
    slides.forEach((s, i) => s.classList.toggle('color-active', i === idx));
    colors.forEach((c, i) => c.classList.toggle('color-active', i === idx));
  };
  select(0);
  colors.forEach((li, i) => li.addEventListener('click', () => select(i)));
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>(
    'loading',
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const path = normalizePath(window.location.pathname);
      try {
        const routesRes = await fetch(`${BASE}content/routes.json`);
        const routes: Routes = await routesRes.json();
        const entry = lookupRoute(routes, path);
        if (!entry) {
          // No 404 page — send unknown URLs to the home page.
          if (!cancelled && path !== '/') window.location.replace(BASE);
          if (!cancelled) setStatus('notfound');
          return;
        }
        // Handle client-side redirect for duplicate/alias routes.
        if ('redirect' in entry) {
          const target = BASE.replace(/\/$/, '') + entry.redirect;
          window.location.replace(target);
          return;
        }
        const meta: RouteMeta = entry;
        const res = await fetch(
          `${BASE}content/${encodeURIComponent(meta.file)}`,
        );
        if (!res.ok) {
          if (!cancelled) setStatus('notfound');
          return;
        }
        const html = await res.text();
        if (cancelled || !containerRef.current) return;

        document.title = meta.title;
        injectStructuredData(path, meta.title);

        // Update per-route meta: canonical, description, OG, Twitter Card.
        const canonicalUrl = `${__SITE_BASE_URL__}${path}`;

        // Canonical link tag
        let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!canonical) {
          canonical = document.createElement('link');
          canonical.setAttribute('rel', 'canonical');
          document.head.appendChild(canonical);
        }
        canonical.setAttribute('href', canonicalUrl);

        // Meta description
        if (meta.description) {
          const descEl = document.querySelector<HTMLMetaElement>('meta[name="description"]');
          if (descEl) descEl.setAttribute('content', meta.description);
        }

        // Open Graph: og:title, og:description, og:url
        const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
        if (ogTitle) ogTitle.setAttribute('content', meta.title);
        const ogDesc = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
        if (ogDesc && meta.description) ogDesc.setAttribute('content', meta.description);
        const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
        if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);

        // Twitter Card: twitter:title, twitter:description
        const twTitle = document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]');
        if (twTitle) twTitle.setAttribute('content', meta.title);
        const twDesc = document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]');
        if (twDesc && meta.description) twDesc.setAttribute('content', meta.description);

        if (meta.bodyClass) document.body.className = meta.bodyClass;
        containerRef.current.innerHTML = rewriteHtmlForBasePath(html);
        makeSearchFormsStatic(containerRef.current);
        applyBasePath(containerRef.current);
        setStatus('ready');

        // Load the site's original behavior script (menus, sliders, tabs).
        const siteScript = document.createElement('script');
        siteScript.src = `${BASE}js/jquery.min_index.js`;
        siteScript.async = false;
        // The site script attaches its menu/slider handlers on
        // DOMContentLoaded / load, which already fired before we injected
        // the page content — so re-dispatch them once the script is ready.
        siteScript.onload = () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          window.dispatchEvent(new Event('load'));
        };
        document.body.appendChild(siteScript);

        // Financing page: payment calculator behavior.
        if (document.getElementById('fin-price')) {
          const finScript = document.createElement('script');
          finScript.src = `${BASE}js/financing.js`;
          document.body.appendChild(finScript);
        }

        // Site-wide 0% financing CTA — last section before the footer.
        if (!document.getElementById('tara-financing-cta')) {
          const cta = document.createElement('section');
          cta.id = 'tara-financing-cta';
          cta.innerHTML = `
            <div class="tfc-inner">
              <div class="tfc-rate">
                <span class="tfc-rate-num">0<sup>%</sup></span>
                <span class="tfc-rate-label">APR Financing</span>
              </div>
              <div class="tfc-copy">
                <p class="tfc-kicker">&#9733; Limited-Time Offer</p>
                <h2 class="tfc-title">0% Financing on TARA Medium Speed Vehicles</h2>
                <p class="tfc-sub">Drive home your TARA today &mdash; 0% financing options for up to <strong>36 months</strong>.</p>
              </div>
              <div class="tfc-action">
                <a class="tfc-button" href="/financing/">Get 0% Financing &#8594;</a>
                <span class="tfc-note">On approved credit</span>
              </div>
            </div>`;
          containerRef.current.appendChild(cta);
        }

        // Site-wide footer (client-requested; original footer was removed).
        if (!document.getElementById('tara-footer')) {
          const footer = document.createElement('footer');
          footer.id = 'tara-footer';
          footer.innerHTML = `
            <div class="tf-inner">
              <div class="tf-col tf-brand">
                <img src="${BASE}images/tara-nev-logo.png" alt="TARA Medium Speed Vehicles" />
                <p>TARA Medium Speed Vehicles — your authorized TARA Dealership for sales, service, and support of electric medium speed vehicles, MSVs, and utility vehicles.</p>
                <p class="tf-disclaimer">We are an independent, authorized TARA Dealership selling TARA vehicles. We are not TARA, the manufacturer.</p>
                <a class="tf-phone" href="tel:8448443432">&#9742; 844-844-3432</a>
              </div>
              <div class="tf-col">
                <h4>Vehicles</h4>
                <a href="/t1-series/">T1 Medium Speed Vehicle Series</a>
                <a href="/t2-series/">T2 Utility Medium Speed Vehicle Series</a>
                <a href="/t3-series/">T3 Street Legal Series</a>
                <a href="/fleet-golf-carts/">Fleet Medium Speed Vehicles</a>
                <a href="/accessories/">Accessories</a>
              </div>
              <div class="tf-col">
                <h4>Popular Models</h4>
                <a href="/harmony-fleet-golf-cart-product/">Harmony</a>
                <a href="/spirit-pro-fleet-golf-cart-product/">Spirit Pro</a>
                <a href="/spirit-plus-fleet-golf-cart-product/">Spirit Plus</a>
                <a href="/roadster-2-2-golf-cart-product/">Roadster 2+2</a>
                <a href="/explorer-2-2-golf-cart-product/">Explorer 2+2</a>
                <a href="/turfman-700-utility-vehicle-product/">Turfman 700</a>
                <a href="/t3-2-2-golf-cart-product/">T3 2+2</a>
              </div>
              <div class="tf-col">
                <h4>Support</h4>
                <a href="/technical-support/">Technical Support</a>
                <a href="/maintenance-support/">Maintenance</a>
                <a href="/warranty-terms/">Warranty Terms</a>
                <a href="/safety-information/">Safety Information</a>
                <a href="/recall-information/">Recall Information</a>
                <a href="/emergency-response-guides/">Emergency Guides</a>
                <a href="/faqs/">FAQs</a>
                <a href="/financing/">Financing</a>
              </div>
              <div class="tf-col">
                <h4>Company</h4>
                <a href="/">Home</a>
                <a href="/about-us/">About Us</a>
                <a href="/cases/">Customer Cases</a>
                <a href="/blog/">Blog</a>
                <a href="/contact/">Contact</a>
              </div>
            </div>
            <div class="tf-bottom">
              <span>&copy; ${new Date().getFullYear()} <a href="https://tigongolfcarts.com/tara-ev">TARA Medium Speed Vehicles</a>. All rights reserved.</span>
              <span class="tf-legal">
                <a href="/privacy-policy/">Privacy Policy</a>
                <a href="/terms-and-conditions/">Terms &amp; Conditions</a>
              </span>
            </div>`;
          // Append inside the content container so the footer sits directly
          // after the page content (JS-injected drawers live at body end).
          containerRef.current.appendChild(footer);
        }

        applyBasePath(containerRef.current);

        // Site-wide "Call Now" button (dealership phone line).
        if (!document.getElementById('tara-call-now')) {
          const call = document.createElement('a');
          call.id = 'tara-call-now';
          call.href = 'tel:8448443432';
          call.innerHTML = '<span class="call-icon">&#9742;</span> Call Now';
          call.setAttribute('aria-label', 'Call TARA at 844-844-3432');
          document.body.appendChild(call);
        }

        // Product pages: show one vehicle image per selected color.
        // The original site used a Swiper synced to the color list; the
        // cloned bundle doesn't initialize it, so wire it up directly.
        initProductColorPicker(containerRef.current);

      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus('notfound');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div ref={containerRef} />
      {status === 'loading' && (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          Loading…
        </div>
      )}
    </>
  );
}

type RouteEntry = RouteMeta | RouteRedirect;
