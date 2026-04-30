import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseOpenAPIContracts } from '../../../src/multi-repo/schema-parsers/openapi-parser.js';
import { parseGraphQLContracts } from '../../../src/multi-repo/schema-parsers/graphql-parser.js';
import { parseProtoContracts } from '../../../src/multi-repo/schema-parsers/proto-parser.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-parsers-'));

describe('OpenAPI parser', () => {
  it('parses JSON spec and extracts endpoints', async () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users/{id}': { get: { responses: { '200': {} } } },
        '/users': { post: { requestBody: {}, responses: { '200': {} } } }
      }
    };
    const dir = fs.mkdtempSync(path.join(tmpDir, 'openapi-'));
    fs.writeFileSync(path.join(dir, 'openapi.json'), JSON.stringify(spec));
    const contracts = await parseOpenAPIContracts(dir);
    assert.ok(contracts.some(c => c.name === 'GET /users/{id}'));
    assert.ok(contracts.some(c => c.name === 'POST /users'));
  });

  it('all endpoints extracted with correct method + path', async () => {
    const spec = { openapi: '3.0.0', paths: { '/items': { get: {}, post: {}, delete: {} } } };
    const dir = fs.mkdtempSync(path.join(tmpDir, 'openapi2-'));
    fs.writeFileSync(path.join(dir, 'openapi.json'), JSON.stringify(spec));
    const contracts = await parseOpenAPIContracts(dir);
    assert.equal(contracts.filter(c => c.path === '/items').length, 3);
  });

  it('no spec files → returns empty array', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'empty-'));
    const contracts = await parseOpenAPIContracts(dir);
    assert.deepEqual(contracts, []);
  });
});

describe('GraphQL parser', () => {
  it('extracts Query and Mutation fields', async () => {
    const schema = `
type Query {
  getUser(id: ID!): User
  listUsers: [User]
}
type Mutation {
  createUser(input: CreateUserInput!): User
}
type User {
  id: ID!
  name: String!
}
`;
    const dir = fs.mkdtempSync(path.join(tmpDir, 'gql-'));
    fs.writeFileSync(path.join(dir, 'schema.graphql'), schema);
    const contracts = await parseGraphQLContracts(dir);
    assert.ok(contracts.some(c => c.name === 'query.getUser'));
    assert.ok(contracts.some(c => c.name === 'mutation.createUser'));
  });

  it('custom types stored', async () => {
    const schema = `type Product { id: ID! price: Float! }`;
    const dir = fs.mkdtempSync(path.join(tmpDir, 'gql2-'));
    fs.writeFileSync(path.join(dir, 'types.graphql'), schema);
    const contracts = await parseGraphQLContracts(dir);
    assert.ok(contracts.some(c => c.name === 'type.Product'));
  });
});

describe('Protobuf parser', () => {
  it('extracts service RPC methods', async () => {
    const proto = `
syntax = "proto3";
service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc CreateUser(CreateUserRequest) returns (User);
}
message User { string id = 1; }
`;
    const dir = fs.mkdtempSync(path.join(tmpDir, 'proto-'));
    fs.writeFileSync(path.join(dir, 'user.proto'), proto);
    const contracts = await parseProtoContracts(dir);
    assert.ok(contracts.some(c => c.name === 'UserService.GetUser'));
    assert.ok(contracts.some(c => c.name === 'UserService.CreateUser'));
  });

  it('message types stored (inputType/outputType)', async () => {
    const proto = `service PayService { rpc Pay(PayRequest) returns (PayResponse); }`;
    const dir = fs.mkdtempSync(path.join(tmpDir, 'proto2-'));
    fs.writeFileSync(path.join(dir, 'pay.proto'), proto);
    const contracts = await parseProtoContracts(dir);
    const c = contracts.find(x => x.name === 'PayService.Pay');
    assert.ok(c);
    assert.equal(c!.inputType, 'PayRequest');
    assert.equal(c!.outputType, 'PayResponse');
  });
});
