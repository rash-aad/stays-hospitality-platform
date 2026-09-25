import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const jobCounter = new client.Counter({
  name: 'jobs_processed_total',
  help: 'Background jobs processed',
  labelNames: ['queue', 'name', 'result'],
  registers: [registry],
});
