import { getTableName, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Fully-qualified column reference for correlated subqueries. Drizzle renders `${table.col}` unqualified
 * when a query has a single table, which silently binds to the inner table inside a subquery.
 */
export const outer = (c: PgColumn) => sql.raw(`"${getTableName(c.table)}"."${c.name}"`);
