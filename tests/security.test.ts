import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createAuthGuard } from '../src/security.ts';

const secret = 'test_secret_with_more_than_sixteen_characters';
const issuer = 'auth-service';

async function request(method: string, path: string, token?: string) {
  const app = express();
  app.use(createAuthGuard({ secret, issuer }));
  app.all('/perfiles/:id', (_request, response) => response.status(204).end());
  app.all('/empleados', (_request, response) => response.status(204).end());
  app.all('/auth/login', (_request, response) => response.status(204).end());
  app.all('/auth/change-password', (_request, response) => response.status(204).end());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function token(role: 'ADMIN' | 'USER', sub = 'E001') {
  return jwt.sign({ sub, role }, secret, { algorithm: 'HS256', issuer });
}

test('allows public login without a token', async () => {
  assert.equal((await request('POST', '/auth/login')).status, 204);
});

test('rejects protected routes without a valid token', async () => {
  const response = await request('POST', '/empleados');
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNAUTHORIZED');
});

test('allows administrators on protected routes', async () => {
  assert.equal((await request('POST', '/empleados', token('ADMIN'))).status, 204);
});

test('limits a user to its own profile while allowing reads', async () => {
  assert.equal((await request('PUT', '/perfiles/E001', token('USER', 'E001'))).status, 204);
  assert.equal((await request('PUT', '/perfiles/E002', token('USER', 'E001'))).status, 403);
  assert.equal((await request('GET', '/empleados', token('USER'))).status, 204);
});
