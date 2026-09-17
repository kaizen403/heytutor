/**
 * Landing SEO catalog must stay internally consistent: unique titles and
 * descriptions, sane lengths, crawlable routes, and matching footer/sitemap
 * /Vercel rewrites.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAGES,
  SITE,
  applySeoToHtml,
  articleWordCount,
  canonicalUrl,
  htmlFileName,
  jsonLdGraph,
  pageByPath,
} from "../../src/lib/seo.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const indexHtml = read("index.html");
const footer = read("src/components/Footer.tsx");
const vercel = read("vercel.json");
const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const llms = read("public/llms.txt");

assert.match(indexHtml, /<!--seo-head-->/);
assert.match(indexHtml, /<!--\/seo-head-->/);
assert.match(indexHtml, /<!--seo-noscript-->/);
assert.match(indexHtml, /<!--\/seo-noscript-->/);
assert.match(indexHtml, /id="seo-jsonld"/);

assert.equal(pageByPath("/")?.title.includes("Accelute"), true);
assert.equal(pageByPath("/")?.title.toLowerCase().includes("ai whiteboard"), true);

const titles = new Set<string>();
const descriptions = new Set<string>();
const paths = new Set<string>();

for (const page of PAGES) {
  assert.equal(paths.has(page.path), false, `duplicate path ${page.path}`);
  paths.add(page.path);

  assert.equal(titles.has(page.title), false, `duplicate title ${page.title}`);
  titles.add(page.title);

  assert.equal(
    descriptions.has(page.description),
    false,
    `duplicate description ${page.path}`,
  );
  descriptions.add(page.description);

  assert.ok(
    page.title.length >= 25 && page.title.length <= 65,
    `${page.path} title length ${page.title.length}`,
  );
  assert.ok(
    page.description.length >= 110 && page.description.length <= 170,
    `${page.path} description length ${page.description.length}`,
  );
  assert.match(page.title, /Accelute/);
  assert.equal(canonicalUrl(page.path).startsWith(SITE.origin), true);

  const graph = jsonLdGraph(page);
  assert.equal(graph["@context"], "https://schema.org");
  assert.ok(Array.isArray(graph["@graph"]));
  JSON.stringify(graph);

  const stamped = applySeoToHtml(indexHtml, page);
  assert.ok(stamped.includes(`<title>${page.title}</title>`));
  assert.ok(stamped.includes(`href="${canonicalUrl(page.path)}"`));
  assert.ok(stamped.includes(page.headline));

  if (page.kind === "article") {
    assert.ok(
      articleWordCount(page) >= 250,
      `${page.path} is too thin (${articleWordCount(page)} words)`,
    );
    assert.ok((page.sections?.length ?? 0) >= 3, `${page.path} needs more sections`);
    assert.ok(page.faqs.length >= 3, `${page.path} needs FAQs`);
    assert.ok(
      footer.includes(`href: '${page.path}'`) || footer.includes(`"${page.path}"`),
      `footer must link ${page.path}`,
    );
    assert.ok(
      vercel.includes(`"/ ${page.slug}"`.replace(" ", "")) ||
        vercel.includes(`"/${page.slug}"`),
      `vercel rewrite missing for ${page.slug}`,
    );
    assert.ok(
      vercel.includes(`/${page.slug}.html`),
      `vercel destination missing ${page.slug}.html`,
    );
  }

  if (page.slug !== "index") {
    assert.equal(htmlFileName(page), `${page.slug}.html`);
  }

  assert.ok(sitemap.includes(canonicalUrl(page.path)), `sitemap missing ${page.path}`);
}

assert.ok(robots.includes("Sitemap: https://accelute.co/sitemap.xml"));
assert.ok(robots.includes("Disallow: /record.html"));
assert.ok(llms.includes("Accelute is an AI whiteboard tutor"));
assert.ok(llms.includes("https://accelute.co/ai-whiteboard"));
assert.ok(llms.includes("https://accelute.co/ai-tutor"));
assert.ok(llms.includes("https://accelute.co/ai-study"));
assert.ok(llms.includes("https://accelute.co/about"));

const home = pageByPath("/")!;
assert.ok(home.faqs.some((faq) => /whiteboard/i.test(faq.question)));
assert.ok(home.faqs.some((faq) => /tutor/i.test(faq.question)));
assert.ok(home.faqs.some((faq) => /Accelute/i.test(faq.question)));

assert.ok(footer.includes("href: '/about'"));
assert.ok(footer.includes("href: '/ai-whiteboard'"));
assert.ok(footer.includes("href: '/ai-tutor'"));
assert.ok(footer.includes("href: '/ai-study'"));
assert.ok(footer.includes("href: '/#faq'"));

console.log(
  `seo ok: ${PAGES.length} urls, home title "${home.title}" (${home.title.length} chars)`,
);
