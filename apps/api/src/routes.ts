import type { Routes } from './http/types.js';
import { authRoutes } from './domain/auth/routes.js';
import { platformRoutes } from './domain/platform/routes.js';
import { tenantAdminRoutes } from './domain/tenant-admin/routes.js';

export const registerRoutes: Routes = async (app, { config }) => {
  const opts = { config };
  await app.register(authRoutes, opts);
  await app.register(platformRoutes, opts);
  await app.register(tenantAdminRoutes, opts);
};
