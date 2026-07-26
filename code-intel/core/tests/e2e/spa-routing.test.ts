import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../../src/http/app.js';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import type { Server } from 'node:http';

/**
 * E2E tests for SPA routing.
 * 
 * These tests verify that:
 * 1. Direct access to SPA routes returns HTML (not 404)
 * 2. Browser reload behavior works correctly
 * 3. API routes still return JSON (not affected by SPA catch-all)
 * 4. Static assets are served correctly
 * 5. Error handling works as expected
 * 
 * Tests run against real Express server in production mode.
 * 
 * Context: This fixes SPA reload/direct-access regressions by keeping the
 * runtime-valid Express 5 catch-all ('/{*path}') correctly ordered after API/admin routes.
 */
describe('SPA Routing E2E', () => {
  let server: Server;
  let baseUrl: string;
  
  before(async () => {
    // Start test server with production-like setup
    const graph = createKnowledgeGraph();
    const app = createApp(graph, 'test-repo');
    
    // Use random port to avoid conflicts
    server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' ? addr?.port : 4747;
    baseUrl = `http://localhost:${port}`;
  });
  
  after(() => {
    // Clean up
    server?.close();
  });

  // ────────────────────────────────────────────────────────────────────────
  // SPA Routes: Should return HTML on direct access
  // ────────────────────────────────────────────────────────────────────────
  
  const spaRoutes = [
    '/login',
    '/connect',
    '/loading',
    '/explore',              // User-reported issue (CI-1002 on reload)
    '/settings',
    '/settings/profile',
    '/settings/appearance'
  ];

  for (const route of spaRoutes) {
    it(`GET ${route} should return HTML (200)`, async () => {
      const response = await fetch(`${baseUrl}${route}`);
      
      // Verify status
      assert.strictEqual(
        response.status, 
        200,
        `Expected 200 for ${route}, got ${response.status}`
      );
      
      // Verify content type
      const contentType = response.headers.get('content-type');
      assert.ok(
        contentType?.includes('text/html'),
        `Expected HTML for ${route}, got ${contentType}`
      );
      
      // Verify HTML structure
      const body = await response.text();
      assert.ok(
        body.includes('<html'),
        `Expected <html> tag in ${route} response`
      );
      assert.ok(
        body.includes('id="root"'),
        `Expected React root div in ${route} response`
      );
      assert.ok(
        body.includes('/assets/') || body.includes('script'),
        `Expected asset references in ${route} response`
      );
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // API Routes: Should return JSON (not HTML)
  // ────────────────────────────────────────────────────────────────────────
  
  it('GET /api/v1/health should return JSON', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    
    const contentType = response.headers.get('content-type');
    assert.ok(
      contentType?.includes('application/json'),
      `Expected JSON, got ${contentType}`
    );
    
    const body = await response.text();
    assert.doesNotThrow(
      () => JSON.parse(body),
      'Should be valid JSON'
    );
    assert.ok(
      !body.includes('<html'),
      'API should not return HTML'
    );
  });

  it('GET /api/v1/repos should return JSON or 401', async () => {
    const response = await fetch(`${baseUrl}/api/v1/repos`);
    
    // May be 200 or 401 depending on auth config
    assert.ok(
      response.status === 200 || response.status === 401,
      `Expected 200 or 401, got ${response.status}`
    );
    
    const contentType = response.headers.get('content-type');
    assert.ok(
      contentType?.includes('application/json'),
      `Expected JSON, got ${contentType}`
    );
    
    const body = await response.text();
    assert.ok(
      !body.includes('<html'),
      'API should not return HTML'
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Static Assets: Should have correct content-type
  // ────────────────────────────────────────────────────────────────────────
  
  it('Referenced static JS assets should not return HTML', async () => {
    const shellResponse = await fetch(`${baseUrl}/explore`);
    const shellHtml = await shellResponse.text();
    const assetMatch = shellHtml.match(/src="(\/assets\/[^"]+\.js)"/);

    assert.ok(assetMatch, 'Expected SPA shell to reference a JS asset');

    const assetResponse = await fetch(`${baseUrl}${assetMatch[1]}`);
    assert.strictEqual(assetResponse.status, 200, 'Referenced JS asset should exist');

    const contentType = assetResponse.headers.get('content-type');
    assert.ok(
      !contentType?.includes('text/html'),
      `Static assets should not return HTML, got ${contentType}`
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Error Handling: API 404 vs SPA catch-all
  // ────────────────────────────────────────────────────────────────────────
  
  it('Non-existent API route should return JSON and never HTML', async () => {
    const response = await fetch(`${baseUrl}/api/v1/nonexistent`);
    
    assert.ok(
      response.status === 401 || response.status === 404,
      `Expected 401 or 404 for unauthenticated missing API route, got ${response.status}`
    );
    
    const contentType = response.headers.get('content-type');
    assert.ok(
      contentType?.includes('application/json'),
      `API error should be JSON, got ${contentType}`
    );
    
    const text = await response.text();
    assert.ok(
      !text.includes('<html'),
      'API error should never return HTML'
    );
    
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    assert.ok(body.error?.code, 'Should have error code');
    assert.ok(body.error?.message, 'Should have error message');
  });

  it('Non-existent SPA route should return HTML (catch-all)', async () => {
    const response = await fetch(`${baseUrl}/some/random/spa/path`);
    
    // SPA catch-all handles it - React Router will show 404 page client-side
    assert.strictEqual(
      response.status, 
      200,
      'Unknown SPA routes should return 200 (let React Router handle 404)'
    );
    
    const contentType = response.headers.get('content-type');
    assert.ok(
      contentType?.includes('text/html'),
      `Unknown routes should be handled by SPA, got ${contentType}`
    );
    
    const body = await response.text();
    assert.ok(
      body.includes('<html'),
      'SPA catch-all should serve HTML'
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Admin Routes: Should return JSON (not HTML)
  // ────────────────────────────────────────────────────────────────────────
  
  it('GET /admin/users should return JSON or 401/403', async () => {
    const response = await fetch(`${baseUrl}/admin/users`);
    
    // Will be 401 or 403 without proper auth
    assert.ok(
      response.status === 401 || response.status === 403 || response.status === 200,
      `Expected 200/401/403, got ${response.status}`
    );
    
    const contentType = response.headers.get('content-type');
    assert.ok(
      contentType?.includes('application/json'),
      `Admin routes should return JSON, got ${contentType}`
    );
    
    const body = await response.text();
    assert.ok(
      !body.includes('<html'),
      'Admin API should not return HTML'
    );
  });
});
