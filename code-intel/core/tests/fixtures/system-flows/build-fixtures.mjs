/**
 * build-fixtures.mjs
 *
 * Writes small multi-repository fixtures for system-flow / protocol-boundary
 * end-to-end tests. Each repo is a Git repository whose functions use the
 * style the TypeScript semantic adapter declares (exported, explicit return
 * type), so call edges and stable local flows exist after `code-intel analyze`.
 *
 * Usage (from tests): import { writeFixtureRepos } and call with a temp root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const FIXTURES = {
  web: {
    'package.json': JSON.stringify({ name: 'web', private: true }),
    'src/checkout.ts': [
      'export function submit(amount: number): Promise<string> {',
      '  return checkout(amount);',
      '}',
      '',
      'export function checkout(amount: number): Promise<string> {',
      '  return capturePayment(amount);',
      '}',
      '',
      'export function capturePayment(amount: number): Promise<string> {',
      "  return fetch('/payments/capture', { method: 'POST', body: JSON.stringify({ amount }) })",
      '    .then((response) => response.json())',
      '    .then((body) => body.receiptId);',
      '}',
      '',
    ].join('\n'),
  },
  payments: {
    'package.json': JSON.stringify({ name: 'payments', private: true, dependencies: { express: '^4.18.0' } }),
    'src/app.ts': [
      "import express from 'express';",
      'const app = express();',
      "app.post('/payments/capture', capture);",
      '',
      'export function capture(req: Req, res: Res): void {',
      '  recordPayment(req.body.amount);',
      "  res.status(200).json({ receiptId: 'r-1', amount: req.body.amount });",
      '}',
      '',
      'export function recordPayment(amount: number): void {',
      '  publishCaptured(amount);',
      '}',
      '',
      'export function publishCaptured(amount: number): void {',
      "  bus.publish('payment.captured', { amount });",
      '}',
      '',
    ].join('\n'),
  },
  notifications: {
    'package.json': JSON.stringify({ name: 'notifications', private: true }),
    'src/receipts.ts': [
      'export function handleCaptured(event: Evt): void {',
      '  sendReceipt(event.amount);',
      '}',
      '',
      'export function sendReceipt(amount: number): void {',
      '  formatReceipt(amount);',
      '}',
      '',
      'export function formatReceipt(amount: number): string {',
      '  return String(amount);',
      '}',
      '',
      'export function start(bus: Bus): void {',
      "  bus.subscribe('payment.captured', handleCaptured);",
      '}',
      '',
    ].join('\n'),
  },
  gateway: {
    'package.json': JSON.stringify({ name: 'gateway', private: true }),
    'src/orders.ts': [
      'const GET_ORDER = gql`',
      '  query GetOrder($id: ID!) { order(id: $id) { id total } }',
      '`;',
      '',
      'export function page(id: string): Promise<unknown> {',
      '  return view(id);',
      '}',
      '',
      'export function view(id: string): Promise<unknown> {',
      '  return loadOrder(id);',
      '}',
      '',
      'export function loadOrder(id: string): Promise<unknown> {',
      '  return client.query({ query: GET_ORDER, variables: { id } });',
      '}',
      '',
    ].join('\n'),
  },
  orders: {
    'package.json': JSON.stringify({ name: 'orders', private: true }),
    'src/resolvers.ts': [
      "import * as grpc from '@grpc/grpc-js';",
      "const billing = new proto.BillingService('localhost:50051', grpc.credentials.createInsecure());",
      '',
      'export const resolvers = {',
      '  Query: {',
      '    order: resolveOrder,',
      '  },',
      '};',
      '',
      'export function resolveOrder(parent: unknown, args: Args): unknown {',
      '  return priceOrder(args.id);',
      '}',
      '',
      'export function priceOrder(id: string): unknown {',
      '  return chargeFor(id);',
      '}',
      '',
      'export function chargeFor(id: string): unknown {',
      '  return billing.charge({ id });',
      '}',
      '',
    ].join('\n'),
  },
  billing: {
    'package.json': JSON.stringify({ name: 'billing', private: true }),
    'src/server.ts': [
      'server.addService(proto.BillingService.service, { charge: chargeImpl });',
      '',
      'export function chargeImpl(call: Call, done: Done): void {',
      '  record(call);',
      '  done(null, {});',
      '}',
      '',
      'export function record(call: Call): void {',
      '  persist(call);',
      '}',
      '',
      'export function persist(call: Call): void {',
      '  console.log(call);',
      '}',
      '',
    ].join('\n'),
  },
  // Same-named function as billing's provider, but no protocol evidence: must never link.
  decoy: {
    'package.json': JSON.stringify({ name: 'decoy', private: true }),
    'src/charge.ts': [
      'export function chargeImpl(call: Call, done: Done): void {',
      '  done(null, call);',
      '}',
      '',
    ].join('\n'),
  },
};

export function writeFixtureRepo(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.code-intel/\nAGENTS.md\nCLAUDE.md\n.codeintelignore.local\n');
  for (const [file, content] of Object.entries(FIXTURES[name])) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}
