import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import {
  PAGES,
  applySeoToHtml,
  htmlFileName,
  pageByPath,
  renderSitemap,
  type SeoPage,
} from "./src/lib/seo.ts";

function pageFromUrl(raw: string | undefined, fallback: SeoPage): SeoPage {
  if (!raw) return fallback;
  return pageByPath(raw) ?? fallback;
}

const HOME = pageByPath("/")!;

export function seoPlugin(): Plugin {
  return {
    name: "accelute-seo",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.filename.endsWith("record.html")) return html;
        const url = ctx.server ? (ctx.originalUrl ?? ctx.path) : "/";
        return applySeoToHtml(html, pageFromUrl(url, HOME));
      },
    },
    writeBundle(options) {
      const dir = options.dir;
      if (!dir) return;
      const indexPath = resolve(dir, "index.html");
      const indexHtml = readFileSync(indexPath, "utf8");
      for (const page of PAGES) {
        if (page.slug === "index") continue;
        const filePath = resolve(dir, htmlFileName(page));
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, applySeoToHtml(indexHtml, page));
      }
      writeFileSync(resolve(dir, "sitemap.xml"), renderSitemap());
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const page = pageByPath(req.url ?? "");
        if (page && page.slug !== "index") {
          const suffix = req.url?.includes("?")
            ? req.url.slice(req.url.indexOf("?"))
            : "";
          req.url = `/${htmlFileName(page)}${suffix}`;
        }
        next();
      });
    },
  };
}
