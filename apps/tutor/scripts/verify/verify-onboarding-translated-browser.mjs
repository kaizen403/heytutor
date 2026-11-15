/**
 * Real DOM counterpart of verify-onboarding-translated-dom.ts (HEYTUTOR-21/25).
 * No server, account, external requests or translation service is needed.
 * Supply an installed playwright-core directory, as in scripts/live/sync/lesson-probe.mjs:
 * PLAYWRIGHT_CORE_DIR=/path/to/playwright-core node scripts/verify/verify-onboarding-translated-browser.mjs
 * Install that Playwright version's chromium and webkit browsers first.
 * Pass chromium or webkit as the first argument to check only that engine.
 * Text replacement models a translator; it does not invoke Safari's translator.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const load = createRequire(import.meta.url);
assert(process.env.PLAYWRIGHT_CORE_DIR, "set PLAYWRIGHT_CORE_DIR to an installed playwright-core directory");
const { chromium, webkit } = load(process.env.PLAYWRIGHT_CORE_DIR);
const { build } = createRequire(load.resolve("tsx/package.json"))("esbuild");
const app = fileURLToPath(new URL("../../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { OnboardingScreen } from './features/account/OnboardingScreen';
      import { LoginScreen } from './features/account/LoginScreen';
      window.renderOnboarding = () => createRoot(document.getElementById('root'), {
        onUncaughtError: error => window.crashes.push({ name: error.name, message: error.message }),
      }).render(<OnboardingScreen initialName="Synthetic learner" nextPath="/" suggestedRole="college" />);
      window.renderLogin = () => {
        window.accountRoot = createRoot(document.getElementById('root'), {
          onUncaughtError: error => window.crashes.push({ name: error.name, message: error.message }),
        });
        window.accountRoot.render(<LoginScreen nextPath="/" googleEnabled={false} emailEnabled={true} devLoginEnabled={false} />);
      };
      window.renderAccountOnboarding = () => window.accountRoot.render(<OnboardingScreen initialName="Synthetic learner" nextPath="/" suggestedRole="college" />);
    `,
    resolveDir: app,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  tsconfig: `${app}/tsconfig.json`,
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [{
    name: "onboarding-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^(next\/navigation|next-auth\/react|@heytutor\/tutor-core)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "next-auth/react"
        ? "export const signIn = (...args) => window.signInFixture(...args);"
        : path === "next/navigation"
        ? "export const useRouter = () => ({ replace: path => window.destination = path, refresh() {} });"
        : "export const DEFAULT_ACCENT = 'india', DEFAULT_AUDIO_LANGUAGE = 'en', DEFAULT_FAMILIARITY = 'normal';" }));
    },
  }],
});

const engines = [["chromium", chromium], ["webkit", webkit]].filter(([name]) => !process.argv[2] || process.argv[2] === name);
assert(engines.length, "expected chromium or webkit");
for (const [engine, launcher] of engines) {
  const browser = await launcher.launch();
  try {
    for (const replacement of ["none", "font", "span"]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.abort());
      await page.setContent('<div id="root"></div>');
      await page.evaluate(() => { window.crashes = []; });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      assert.deepEqual(errors, [], "browser bundle loads");
      await page.evaluate(() => window.renderOnboarding());
      const submit = () => page.locator('button[type="submit"]').click();
      await submit();
      await page.getByRole("radio", { name: "13–17", exact: true }).click();
      await page.getByRole("textbox", { name: "Guardian email" }).fill("guardian@synthetic.invalid");
      await page.locator('button[aria-haspopup="listbox"]').click();
      await page.getByRole("option", { name: "First year", exact: true }).click();
      await submit();
      await page.getByRole("button", { name: "Physics", exact: true }).waitFor();
      if (replacement !== "none") {
        await page.locator("fieldset").evaluateAll((fields, tag) => {
          for (const field of fields) {
            const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
            const texts = [];
            while (walker.nextNode()) if (walker.currentNode.textContent.trim()) texts.push(walker.currentNode);
            for (const text of texts) {
              const outer = document.createElement(tag);
              const inner = document.createElement(tag);
              inner.textContent = `译 ${text.textContent}`;
              outer.append(inner);
              text.replaceWith(outer);
            }
          }
        }, replacement);
      }
      const choice = label => page.getByRole("button", { name: replacement === "none" ? label : `译 ${label}`, exact: true });
      for (const [label, previous] of [["Physics", null], ["UK", "India"], ["New", "Normal"]]) {
        await choice(label).click();
        const crashes = await page.evaluate(() => window.crashes);
        assert.deepEqual(crashes, [], `${engine}/${replacement}: ${JSON.stringify(crashes)}`);
        assert.equal(await choice(label).getAttribute("aria-pressed"), "true", `${label} selected`);
        assert.equal(await choice(label).locator("svg").count(), 1, `${label} has a checkmark`);
        if (previous) assert.equal(await choice(previous).getAttribute("aria-pressed"), "false");
      }
      await choice("Physics").click();
      assert.equal(await choice("Physics").getAttribute("aria-pressed"), "false");
      assert.equal(await choice("Physics").locator("svg").count(), 0);
      await choice("Physics").click();
      await page.evaluate(() => {
        window.fetch = async (_url, init) => {
          window.saved = JSON.parse(init.body);
          return new Response("{}", { status: 200 });
        };
      });
      await submit();
      await page.waitForFunction(() => window.destination === "/");
      const saved = await page.evaluate(() => window.saved);
      assert.deepEqual(saved.subjects, ["physics"]);
      assert.equal(saved.accent, "uk");
      assert.equal(saved.familiarity, "new");
      assert.deepEqual(await page.evaluate(() => window.crashes), []);
      assert.deepEqual(errors, [], `${engine}/${replacement}: browser errors`);
      await page.close();
      console.log(`onboarding ${engine}/${replacement}: selection, deselection and save passed`);
    }
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {
      window.crashes = [];
      window.rejectEmail = true;
      window.signInFixture = async () => {
        if (window.rejectEmail) throw new TypeError("synthetic connection failure");
        return { ok: true };
      };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.renderLogin());
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("learner@synthetic.invalid");
    const email = page.getByRole("button", { name: "Email me a sign-in link", exact: true });
    await email.click();
    await page.getByRole("alert").filter({ hasText: "Could not send the sign-in email" }).waitFor();
    assert.equal(await email.isEnabled(), true);
    await page.evaluate(() => { window.rejectEmail = false; });
    await email.click();
    await page.getByRole("status").filter({ hasText: "Check your inbox" }).waitFor();
    await page.evaluate(() => window.renderAccountOnboarding());
    await page.locator('button[type="submit"]').click();
    await page.getByRole("radio", { name: /under 13/i }).click();
    await page.evaluate(() => {
      window.fetch = async (_url, init) => {
        window.refusal = JSON.parse(init.body);
        throw new TypeError("synthetic connection failure");
      };
    });
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.destination === "/login?refused=1");
    assert.deepEqual(await page.evaluate(() => window.refusal), { ageBand: "under_13" });
    assert.deepEqual(await page.evaluate(() => window.crashes), []);
    assert.deepEqual(errors, [], `${engine}: account network rejection is handled`);
    await page.close();
    console.log(`account ${engine}: email retry and refusal redirect passed`);
  } finally { await browser.close(); }
}
