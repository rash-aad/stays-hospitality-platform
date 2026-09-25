import type { Routes } from './http/types.js';
import { authRoutes } from './domain/auth/routes.js';
import { platformRoutes } from './domain/platform/routes.js';
import { tenantAdminRoutes } from './domain/tenant-admin/routes.js';
import { propertyRoutes } from './domain/property/routes.js';
import { publicBookingRoutes } from './domain/bookings/public-routes.js';
import { adminBookingRoutes } from './domain/bookings/admin-routes.js';
import { paymentRoutes } from './domain/payments/routes.js';
import { guestAdminRoutes } from './domain/guests/admin-routes.js';

export const registerRoutes: Routes = async (app, { config }) => {
  const opts = { config };
  await app.register(authRoutes, opts);
  await app.register(platformRoutes, opts);
  await app.register(tenantAdminRoutes, opts);
  await app.register(propertyRoutes, opts);
  await app.register(publicBookingRoutes, opts);
  await app.register(adminBookingRoutes, opts);
  await app.register(paymentRoutes, opts);
  await app.register(guestAdminRoutes, opts);
};
