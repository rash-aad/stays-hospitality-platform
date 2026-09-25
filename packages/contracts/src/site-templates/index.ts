import type { SiteTemplate } from './factory.js';
import { beach, heritage, hill, luxury, urban } from './templates-a.js';
import { backwaters, business, desert, jungle, wellness } from './templates-b.js';

export type { SiteTemplate } from './factory.js';

/** The ten starter templates tenants choose from in the website builder. */
export const SITE_TEMPLATES: SiteTemplate[] = [beach, luxury, hill, heritage, urban, jungle, backwaters, desert, wellness, business];

export function getTemplate(key: string): SiteTemplate | undefined {
  return SITE_TEMPLATES.find((t) => t.key === key);
}
