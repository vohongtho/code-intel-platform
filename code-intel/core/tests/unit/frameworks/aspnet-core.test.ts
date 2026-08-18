import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aspnetCoreFrameworkAdapter } from '../../../src/frameworks/adapters/aspnet-core.js';

describe('aspnet core framework adapter', () => {
  it('extracts controller routes, mapped endpoints, and DI bindings', () => {
    const source = [
      'using Microsoft.AspNetCore.Mvc;',
      'using Microsoft.Extensions.DependencyInjection;',
      '[Route("users")]',
      'public class UsersController : ControllerBase {',
      '  [HttpGet("list")]',
      '  public IActionResult List() => Ok();',
      '}',
      'app.MapPost("/users", CreateUser);',
      'services.AddScoped<IUserService, UserService>();',
    ].join('\n');

    const detection = aspnetCoreFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['app.csproj', 'Program.cs'],
      fileCache: new Map([
        ['app.csproj', '<PackageReference Include="Microsoft.AspNetCore.Mvc.Core" /><PackageReference Include="Microsoft.Extensions.DependencyInjection" />'],
        ['Program.cs', source],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = aspnetCoreFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['Program.cs'],
      fileCache: new Map([['Program.cs', source]]),
    });

    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path.includes('users/list')));
    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path === '/users'));
    assert.ok(bundle.facts.some((fact) => 'bindingKind' in fact && 'contractRef' in fact && fact.contractRef === 'IUserService'));
  });
});
