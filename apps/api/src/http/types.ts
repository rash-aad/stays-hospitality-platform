import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config.js';

export type RouteOpts = { config: Config };
export type Routes = FastifyPluginAsyncZod<RouteOpts>;
