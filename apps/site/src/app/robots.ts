import type { MetadataRoute } from 'next';
import { site } from '@/content/site';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  if (!site.indexable) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/' }, sitemap: `${site.url}/sitemap.xml` };
}
