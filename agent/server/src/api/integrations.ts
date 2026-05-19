import type { Hono } from 'hono';
import { getIntegrationStatuses } from '../integrations/catalog.ts';

export function mountIntegrationsRoutes(app: Hono): void {
  app.get('/integrations', (c) => {
    const items = getIntegrationStatuses();
    const summary = {
      total: items.length,
      connected: items.filter((i) => i.connected).length,
    };
    return c.json({ summary, integrations: items });
  });
}
