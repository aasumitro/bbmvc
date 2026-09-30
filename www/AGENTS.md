<!-- BEGIN:agent-rules -->

# www/ — the site

Site (`www/`, Astro 7, static output — no server runs it; the server's Caddy serves `dist/`):
- `npm run build` (`astro check`, then static pages in `dist/`: `/docs/modes` is `docs/modes.html`), `npm run lint` (eslint), `npm run check` (`src/lib/nakama/nakama.check.mts`: session rules, the header's name read, form error texts)
- Code files stay under 100 lines, one job each (a component, a hook, a helper); the guide's MDX is exempt. Pages in `src/pages/`, layouts in `src/layouts/` (Base: head + skip link; Site: header + footer), components in `src/components/{head,site,home,guide}/`, browser logic in `src/lib/`
- JavaScript only where the page needs it: header name and player counts are small scripts in their `.astro` components (no React, no Nakama client); React islands (`src/islands/`) only for the forms on login, register and account
- Home (`src/pages/index.astro`) is one full-screen scene: live player count (`components/site/PlayerCount.astro`, also in the footer), headline, one line, Play; the header laid over a looping gameplay video (`public/video/hero-v*.{webm,mp4}`, `lib/hero.ts`, poster `src/assets/hero-poster.jpg`; how it was cut: `.claude/work/www/WWW_IMPLEMENTATION_LOG.md`)
- The guide: `src/content/guide/*.mdx` (a content collection; frontmatter title + description), listed and ordered in `src/lib/guide.ts` (routes, sidebar, pager, sitemap), styled by `src/styles/guide.css`. Its facts come from the game's code (see the root `AGENTS.md`)
- SEO: every page states its title, description, canonical path and `index` to its layout (`lib/seo.ts`, `components/head/Seo.astro`); sitemap and robots are `src/pages/*.ts`; Google Analytics in `components/head/Analytics.astro` (`lib/analytics.ts`), only after a yes to the cookie banner (`components/site/ConsentBanner.astro`, every page; the footer's Cookies asks again; `lib/consent.ts`); what the site keeps: the FAQ's "What does the site keep about me?"
- `SITE_URL` (build time, see `.env.example`) for canonical links and the sitemap

## Where this project departs from the shared guides

- Tests: the plain-node `npm run check` above, not `ts/testing.md`'s Vitest conventions.
- Formatting: no formatter is configured; lint is eslint (`eslint.config.js`). `ts/README.md` rule 5 (prettier/biome) waits until one is added.
- tsconfig: extends `astro/tsconfigs/strict`; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (`ts/tooling-and-migration.md`) are off. Don't change the tsconfig to match the guide.
- File names: PascalCase components (`components/site/SiteHeader.astro`), camelCase modules (`src/lib/nakama/useSession.ts`), not `ts/patterns.md`'s kebab-case default.

<!-- END:agent-rules -->
