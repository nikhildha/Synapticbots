import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pricing', '/landing-v2', '/login', '/signup'],
        disallow: [
          '/dashboard',
          '/dashboard/',
          '/admin',
          '/admin/',
          '/api/',
          '/settings',
          '/account',
          '/bots',
          '/trades',
          '/journal',
          '/alpha',
        ],
      },
    ],
    sitemap: 'https://synapticbots.in/sitemap.xml',
    host: 'https://synapticbots.in',
  };
}
