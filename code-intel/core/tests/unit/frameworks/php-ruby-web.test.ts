import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { phpRubyWebFrameworkAdapter } from '../../../src/frameworks/adapters/php-ruby-web.js';

describe('php and ruby web framework adapter', () => {
  it('extracts Laravel, Symfony, and Rails routes', () => {
    const laravel = "Route::get('/users', [UserController::class, 'index']);";
    const symfony = "$routes->get('/health', 'App\\Controller\\HealthController::index');";
    const rails = "get '/posts', to: 'posts#index'";

    const detection = phpRubyWebFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['composer.json', 'routes.rb'],
      fileCache: new Map([
        ['composer.json', '{"require":{"laravel/framework":"^10","symfony/framework-bundle":"^7"}}'],
        ['routes.rb', rails],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = phpRubyWebFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['routes/web.php', 'config/routes.php', 'config/routes.rb'],
      fileCache: new Map([
        ['routes/web.php', laravel],
        ['config/routes.php', symfony],
        ['config/routes.rb', rails],
      ]),
    });

    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/users'));
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/health'));
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/posts'));
  });
});
