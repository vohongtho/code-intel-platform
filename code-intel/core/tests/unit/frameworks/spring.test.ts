import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { springFrameworkAdapter } from '../../../src/frameworks/adapters/spring.js';

describe('spring framework adapter', () => {
  it('extracts mappings, beans, and bounded injection facts', () => {
    const source = [
      'import org.springframework.web.bind.annotation.*;',
      'import org.springframework.beans.factory.annotation.Autowired;',
      '@RestController',
      '@RequestMapping("users")',
      'public class UsersController {',
      '  @Autowired',
      '  private UserService service;',
      '  @GetMapping("list")',
      '  public User list() { return null; }',
      '}',
      '@Configuration',
      'public class AppConfig {',
      '  @Bean',
      '  public UserService userService() { return new UserService(); }',
      '}',
    ].join('\n');

    const detection = springFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['pom.xml', 'src/App.java'],
      fileCache: new Map([
        ['pom.xml', '<groupId>org.springframework</groupId>'],
        ['src/App.java', source],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = springFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['src/App.java'],
      fileCache: new Map([['src/App.java', source]]),
    });

    assert.ok(bundle.facts.some((fact) => 'routeKind' in fact && fact.path.includes('users/list')));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'bean'));
    assert.ok(bundle.facts.some((fact) => 'bindingKind' in fact && 'contractRef' in fact && fact.contractRef === 'UserService'));
    assert.equal(bundle.facts.some((fact) => fact.frameworkEvidence?.exact === false), true);
  });
});
