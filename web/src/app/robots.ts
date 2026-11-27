import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Signed-in pages and family tracking links are private, so keep them out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/app', '/track/', '/login', '/register', '/forgot-password', '/reset-password'] },
    sitemap: SITE_URL + '/sitemap.xml',
  };
}
