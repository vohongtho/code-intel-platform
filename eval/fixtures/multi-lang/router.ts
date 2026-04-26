// Multi-lang fixture: HTTP router layer
import { AuthService } from './auth.js';

export interface Request {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface Response {
  status: number;
  body: unknown;
}

export class Router {
  private routes: Map<string, (req: Request) => Response> = new Map();
  private auth: AuthService;

  constructor(auth: AuthService) {
    this.auth = auth;
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.routes.set('POST /login', (req) => this.handleLogin(req));
    this.routes.set('POST /logout', (req) => this.handleLogout(req));
    this.routes.set('GET /profile', (req) => this.handleProfile(req));
  }

  handle(req: Request): Response {
    const key = `${req.method} ${req.path}`;
    const handler = this.routes.get(key);
    if (!handler) return { status: 404, body: { error: 'Not found' } };
    return handler(req);
  }

  private handleLogin(req: Request): Response {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return { status: 400, body: { error: 'Missing credentials' } };
    try {
      const token = this.auth.login(email, password);
      return { status: 200, body: { token } };
    } catch {
      return { status: 401, body: { error: 'Unauthorized' } };
    }
  }

  private handleLogout(req: Request): Response {
    const token = req.headers?.['authorization'] ?? '';
    this.auth.logout(token);
    return { status: 200, body: { ok: true } };
  }

  private handleProfile(req: Request): Response {
    return { status: 200, body: { user: 'profile data' } };
  }
}

export class AuthService {
  login(email: string, password: string): string {
    return `tok_${email}`;
  }
  logout(token: string): void {}
}
