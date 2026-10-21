import type { MetadataRoute } from 'next';
import { site } from '@/content/site';

export const dynamic = 'force-static';

const PATHS = ['', '/susu', '/micro-credit', '/welfare', '/how-to-join', '/stay-safe', '/contact', '/privacy', '/accessibility'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: `${site.url}${path}`, changeFrequency: 'monthly', priority: path === '' ? 1 : 0.7 }));
}
