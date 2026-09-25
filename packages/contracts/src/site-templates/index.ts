import type { SiteTemplate } from './factory';
import { beach, heritage, hill, luxury, urban } from './templates-a';
import { backwaters, business, desert, jungle, wellness } from './templates-b';

export type { SiteTemplate } from './factory';

/** The ten starter templates tenants choose from in the website builder. */
export const SITE_TEMPLATES: SiteTemplate[] = [beach, luxury, hill, heritage, urban, jungle, backwaters, desert, wellness, business];

export function getTemplate(key: string): SiteTemplate | undefined {
  return SITE_TEMPLATES.find((t) => t.key === key);
}
