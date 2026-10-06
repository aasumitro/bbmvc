// What every page says about the site. The public origin is Astro's `site`
// (SITE_URL at build time): canonical links, the sitemap and the social cards
// hang off it.
export const SITE = {
  name: 'Scrapyard',
  title: 'Scrapyard — car combat in your browser',
  description:
    'Armoured cars, a roof minigun or a rocket pod, and ten-minute matches in a walled scrapyard or a burning city. Free car combat in your browser, nothing to install.',
  card: { url: '/og.jpg', width: 1200, height: 630, alt: 'The Scrapyard logo over the yard at sunset' },
  themeColor: '#0c0e13',
  analytics: 'G-HN01PJVCB2', // Google Analytics measurement id
  repo: 'https://github.com/aasumitro/bbmvc', // the source, linked from the home page
}
