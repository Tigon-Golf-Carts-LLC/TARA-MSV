/**
 * JSON-LD structured data generator for TARA Medium Speed Vehicles.
 *
 * Produces schema.org markup as a plain object (to be serialised via
 * JSON.stringify).  One schema block is injected into <head> per route
 * navigation; the helper `injectStructuredData` handles the DOM write.
 */

const SITE_URL = 'https://www.taramsv.com';
const SITE_NAME = 'TARA Medium Speed Vehicles';
const LOGO_URL = `${SITE_URL}/images/tara-nev-logo.png`;
const PHONE = '+1-844-844-3432';

// ---------------------------------------------------------------------------
// Route classification helpers
// ---------------------------------------------------------------------------

function isProductPage(path: string): boolean {
  return path.endsWith('-product/') || path.includes('-product/');
}

function isBlogPost(path: string): boolean {
  return path.startsWith('/blog/') && path !== '/blog/';
}

function isSeriesPage(path: string): path is '/t1-series/' | '/t2-series/' | '/t3-series/' {
  return path === '/t1-series/' || path === '/t2-series/' || path === '/t3-series/';
}

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

function buildOrganization() {
  return {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: LOGO_URL,
    },
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: PHONE,
      contactType: 'sales',
      areaServed: 'US',
      availableLanguage: 'English',
    },
    sameAs: [
      'https://www.facebook.com/taramsv',
      'https://www.instagram.com/taramsv',
    ],
  };
}

function buildWebSite() {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

function buildBreadcrumb(path: string, pageTitle: string) {
  // Build a simple 2-level breadcrumb: Home > Page
  const items = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: SITE_URL,
    },
  ];

  if (path !== '/') {
    // For blog posts add an intermediate Blog crumb
    if (isBlogPost(path)) {
      items.push({
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: `${SITE_URL}/blog/`,
      });
      items.push({
        '@type': 'ListItem',
        position: 3,
        name: stripSiteSuffix(pageTitle),
        item: `${SITE_URL}${path}`,
      });
    } else {
      items.push({
        '@type': 'ListItem',
        position: 2,
        name: stripSiteSuffix(pageTitle),
        item: `${SITE_URL}${path}`,
      });
    }
  }

  return {
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}

/** Strip common site-name suffixes from route titles to get a clean page name. */
function stripSiteSuffix(title: string): string {
  return title
    .replace(/\s*[-|]\s*TARA (MEDIUM SPEED VEHICLE(S)?|Medium Speed Vehicles).*$/i, '')
    .replace(/\s*[-|]\s*TARA$/i, '')
    .trim();
}

function buildProduct(path: string, title: string) {
  const name = stripSiteSuffix(title).replace(/\s*\|\s*.*$/, '').trim();

  // Choose a category label based on the path
  let category = 'Electric Medium Speed Vehicle';
  if (path.includes('turfman') || path.includes('utility')) {
    category = 'Electric Utility Vehicle';
  } else if (path.includes('t3') || path.includes('roadster') || path.includes('explorer')) {
    category = 'Street Legal Medium Speed Vehicle';
  }

  // We are an independent authorized dealership — we do not manufacture the
  // vehicles. `brand` identifies the vehicle brand; no `manufacturer` or
  // `offers` fields are included because pricing is not published on-page.
  return {
    '@type': 'Product',
    name,
    brand: {
      '@type': 'Brand',
      name: 'TARA',
    },
    category,
    url: `${SITE_URL}${path}`,
  };
}

/** Hardcoded FAQ pairs extracted from /faqs/ page content. */
const FAQ_PAIRS = [
  {
    q: 'How much do TARA vehicles cost?',
    a: 'Pricing depends on the model, battery option, and accessories you choose. Contact us for a current quote — our team will walk you through the lineup and put together straightforward, no-pressure pricing.',
  },
  {
    q: 'Do you offer financing?',
    a: 'Yes. We can connect you with financing options to fit your budget. Reach out and one of our specialists will go over terms and monthly payment estimates with you.',
  },
  {
    q: 'Can I take a test drive before buying?',
    a: 'Absolutely — we encourage it. Contact us to schedule a test drive, and we\'ll help you compare models so you can find the right fit for your community, course, or property.',
  },
  {
    q: 'How long does delivery take?',
    a: 'In-stock vehicles are typically ready quickly, and we arrange delivery to customers across the United States. When you order, we\'ll confirm availability and give you a specific delivery timeline for your area.',
  },
  {
    q: 'What warranty comes with my vehicle?',
    a: 'Your vehicle is covered by a 1-year warranty, and lithium batteries carry an 8-year warranty. All warranty claims are handled directly through our dealership — just contact us and we\'ll take care of the rest.',
  },
  {
    q: 'Do you service the vehicles you sell?',
    a: 'Yes. We support every vehicle we sell with maintenance guidance, genuine parts, and service assistance. Visit our Maintenance Support page or give us a call any day between 9am and 5pm.',
  },
];

function buildFAQPage() {
  return {
    '@type': 'FAQPage',
    mainEntity: FAQ_PAIRS.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: a,
      },
    })),
  };
}

function buildBlogPosting(path: string, title: string) {
  const headline = stripSiteSuffix(title);
  // datePublished/dateModified are omitted: the blog HTML and route metadata
  // carry no verified publication dates, so fabricating them would produce
  // false Article structured data.
  return {
    '@type': 'BlogPosting',
    headline,
    url: `${SITE_URL}${path}`,
    author: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: LOGO_URL,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}${path}`,
    },
  };
}

// Series → product list mappings.
// Derived from the item_title links rendered in each series page's main content.
const SERIES_ITEMS: Record<string, { name: string; url: string }[]> = {
  // t1-series.html lists (in order): Spirit Plus, Spirit Pro, Roadster 2+2,
  // Explorer 2+2, Harmony.
  '/t1-series/': [
    { name: 'Spirit Plus',   url: `${SITE_URL}/spirit-plus-fleet-golf-cart-product/` },
    { name: 'Spirit Pro',    url: `${SITE_URL}/spirit-pro-fleet-golf-cart-product/` },
    { name: 'Roadster 2+2', url: `${SITE_URL}/roadster-2-2-golf-cart-product/` },
    { name: 'Explorer 2+2', url: `${SITE_URL}/explorer-2-2-golf-cart-product/` },
    { name: 'Harmony',      url: `${SITE_URL}/harmony-fleet-golf-cart-product/` },
  ],
  // t2-series.html lists: Turfman 700, Turfman 700 EEC, Turfman 1000, Turfman 450.
  '/t2-series/': [
    { name: 'Turfman 700',     url: `${SITE_URL}/turfman-700-utility-vehicle-product/` },
    { name: 'Turfman 700 EEC', url: `${SITE_URL}/turfman-700-eec-utility-vehicle-product/` },
    { name: 'Turfman 1000',    url: `${SITE_URL}/turfman-1000-utility-vehicle-product/` },
    { name: 'Turfman 450',     url: `${SITE_URL}/turfman-450-utility-vehicle-product/` },
  ],
  // t3-series.html currently lists only T3 2+2.
  '/t3-series/': [
    { name: 'T3 2+2', url: `${SITE_URL}/t3-2-2-golf-cart-product/` },
  ],
};

function buildItemList(path: string, title: string) {
  const items = SERIES_ITEMS[path] ?? [];
  return {
    '@type': 'ItemList',
    name: stripSiteSuffix(title),
    url: `${SITE_URL}${path}`,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate the full JSON-LD graph for the given route. */
export function buildSchema(
  path: string,
  title: string,
): Record<string, unknown> {
  const graph: unknown[] = [];

  // Organization and WebSite are emitted on every page so that inner-page
  // graphs are self-contained and crawlers can always resolve the sitewide
  // entity IDs without needing to visit the home page first.
  graph.push(buildOrganization());
  graph.push(buildWebSite());

  // Breadcrumb on every page
  graph.push(buildBreadcrumb(path, title));

  // Page-type-specific schema
  if (path === '/faqs/') {
    graph.push(buildFAQPage());
  } else if (isBlogPost(path)) {
    graph.push(buildBlogPosting(path, title));
  } else if (isSeriesPage(path)) {
    graph.push(buildItemList(path, title));
  } else if (isProductPage(path)) {
    graph.push(buildProduct(path, title));
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

/** Inject (or replace) the JSON-LD <script> tag in <head>. */
export function injectStructuredData(path: string, title: string): void {
  const schema = buildSchema(path, title);
  const json = JSON.stringify(schema, null, 0);

  let tag = document.getElementById('tara-ld-json') as HTMLScriptElement | null;
  if (!tag) {
    tag = document.createElement('script');
    tag.id = 'tara-ld-json';
    tag.type = 'application/ld+json';
    document.head.appendChild(tag);
  }
  tag.textContent = json;
}
