/**
 * WsServer — WebSocket push server for live graph-update notifications.
 *
 * Attaches to an existing Node.js HTTP server (same port as Express).
 * Auth: checks the `code_intel_session` cookie, `Authorization: Bearer <token>`,
 *       or `?token=<token>` query param via the existing websocket-auth module.
 *
 * On file change: caller calls broadcast() to push a `graph:updated` message
 * to all authenticated connected clients.
 *
 * Client auto-reconnect is the client's responsibility.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { verifyWebSocketHandshake } from './websocket-auth.js';
import Logger from '../shared/logger.js';

export interface GraphUpdatedMessage {
  type: 'graph:updated';
  indexVersion: string;
  stats: { nodes: number; edges: number };
  changedFiles: string[];
  timestamp: string;
}

export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      // Authenticate the handshake
      const user = verifyWebSocketHandshake(req);
      if (!user) {
        Logger.warn('[ws] rejected unauthenticated connection');
        ws.close(4401, 'Unauthorized');
        return;
      }

      Logger.info(`[ws] client connected: ${user.username}`);
      this.clients.add(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
        Logger.info(`[ws] client disconnected: ${user.username}`);
      });

      ws.on('error', (err) => {
        Logger.warn('[ws] client error:', err.message);
        this.clients.delete(ws);
      });
    });

    this.wss.on('error', (err) => {
      Logger.warn('[ws] server error:', err.message);
    });
  }

  /** Broadcast a message to all authenticated connected clients. */
  broadcast(msg: GraphUpdatedMessage): void {
    const payload = JSON.stringify(msg);
    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent++;
      }
    }
    Logger.info(`[ws] broadcast → ${sent} client(s)`);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    for (const client of this.clients) {
      try { client.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.wss.close();
  }
}
