/** Permission catalog. Roles are tenant-scoped bundles of these keys. */
export const PERMISSIONS = {
  'tenant.settings': 'Manage tenant settings, modules and branding',
  'staff.manage': 'Invite staff and manage roles',
  'audit.read': 'Read the audit log',
  'property.manage': 'Manage property, rooms, rates and inventory',
  'bookings.read': 'View reservations',
  'bookings.write': 'Create and modify reservations',
  'guests.read': 'View guest profiles',
  'guests.write': 'Edit guest profiles',
  'payments.read': 'View payments',
  'payments.verify': 'Approve or reject manual UPI payments',
  'payments.refund': 'Issue refunds',
  'payments.settings': 'Configure payment methods and gateway keys',
  'restaurant.manage': 'Configure outlets, tables and menus',
  'restaurant.reservations': 'Manage restaurant reservations',
  'orders.manage': 'Work the kitchen queue and manage orders',
  'requests.manage': 'Handle guest service requests',
  'requests.configure': 'Configure service request types',
  'housekeeping.manage': 'Run housekeeping',
  'maintenance.manage': 'Run maintenance tickets',
  'experiences.manage': 'Manage experiences and bookings',
  'content.manage': 'Edit website, guide pages and announcements',
  'content.publish': 'Publish website changes',
  'messages.manage': 'Reply to guest messages',
  'reports.read': 'View reports',
  'integrations.manage': 'Manage integrations',
  'events.manage': 'Manage event and banquet enquiries',
  'frontoffice.audit': 'Run the night audit and close the business day',
  'cash.handle': 'Open and close a cash drawer shift',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** System roles created for every tenant. */
export const SYSTEM_ROLES: Record<string, { name: string; permissions: Permission[] | '*' }> = {
  owner: { name: 'Owner', permissions: '*' },
  manager: {
    name: 'General Manager',
    permissions: PERMISSION_KEYS.filter((p) => p !== 'payments.settings' && p !== 'staff.manage'),
  },
  front_desk: {
    name: 'Front Desk',
    permissions: [
      'bookings.read', 'bookings.write', 'guests.read', 'guests.write', 'payments.read',
      'payments.verify', 'requests.manage', 'messages.manage', 'restaurant.reservations',
      'frontoffice.audit', 'cash.handle',
    ],
  },
  restaurant_manager: {
    name: 'Restaurant Manager',
    permissions: ['restaurant.manage', 'restaurant.reservations', 'orders.manage', 'guests.read', 'reports.read', 'cash.handle'],
  },
  kitchen: { name: 'Kitchen', permissions: ['orders.manage'] },
  housekeeping: { name: 'Housekeeping', permissions: ['housekeeping.manage', 'requests.manage'] },
  maintenance: { name: 'Maintenance', permissions: ['maintenance.manage', 'requests.manage'] },
  concierge: {
    name: 'Concierge',
    permissions: ['requests.manage', 'experiences.manage', 'messages.manage', 'guests.read', 'restaurant.reservations'],
  },
};
