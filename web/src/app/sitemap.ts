import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

const PAGES = ['', '/features', '/privacy-and-location', '/faq', '/download', '/support', '/privacy', '/terms'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(p => ({ url: SITE_URL + p, changeFrequency: 'monthly', priority: p === '' ? 1 : 0.6 }));
}
