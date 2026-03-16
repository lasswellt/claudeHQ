import type { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { dashboardToHubSchema } from '@chq/shared';
import type { DAL } from '../dal.js';


interface ConnectedDashboard {
  socket: WebSocket;
  subscriptions: Set<string>; // "session:*" or "session:abc123"
}

export class DashboardHandler {
  private clients = new Set<ConnectedDashboard>();
  private readonly dal: DAL;
  private readonly app: FastifyInstance;

  constructor(app: FastifyInstance, dal: DAL) {
    this.app = app;
    this.dal = dal;
  }

  handleConnection(socket: WebSocket): void {
    const client: ConnectedDashboard = {
      socket,
      subscriptions: new Set(),
    };
    this.clients.add(client);
    this.app.log.info('Dashboard client connected');

    socket.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as unknown;
        const msg = dashboardToHubSchema.parse(data);

        switch (msg.type) {
          case 'subscribe':
            this.handleSubscribe(client, msg);
            break;
          case 'unsubscribe':
            this.handleUnsubscribe(client, msg);
            break;
        }
      } catch (err) {
        this.app.log.warn({ err }, 'Failed to parse dashboard message');
      }
    });

    socket.on('close', () => {
      this.clients.delete(client);
      this.app.log.info('Dashboard client disconnected');
    });
  }

  broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.socket.readyState === 1) {
        client.socket.send(data);
      }
    }
  }

  broadcastToSubscribers(resource: string, id: string | undefined, msg: unknown): void {
    const data = JSON.stringify(msg);
    const wildcardKey = `${resource}:*`;
    const specificKey = id ? `${resource}:${id}` : null;

    for (const client of this.clients) {
      if (client.socket.readyState !== 1) continue;

      const isSubscribed =
        client.subscriptions.has(wildcardKey) ||
        (specificKey && client.subscriptions.has(specificKey));

      if (isSubscribed) {
        client.socket.send(data);
      }
    }
  }

  private handleSubscribe(
    client: ConnectedDashboard,
    msg: { resource: string; id?: string },
  ): void {
    const key = msg.id ? `${msg.resource}:${msg.id}` : `${msg.resource}:*`;
    client.subscriptions.add(key);

    // Send initial state
    this.sendInitialState(client, msg.resource, msg.id);
  }

  private handleUnsubscribe(
    client: ConnectedDashboard,
    msg: { resource: string; id?: string },
  ): void {
    const key = msg.id ? `${msg.resource}:${msg.id}` : `${msg.resource}:*`;
    client.subscriptions.delete(key);
  }

  private sendInitialState(client: ConnectedDashboard, resource: string, id?: string): void {
    if (client.socket.readyState !== 1) return;
    switch (resource) {
      case 'session':
        if (id) {
          const session = this.dal.getSession(id);
          if (session) {
            client.socket.send(JSON.stringify({ type: 'session:updated', session }));
          }
        } else {
          for (const session of this.dal.listSessions({})) {
            client.socket.send(JSON.stringify({ type: 'session:updated', session }));
          }
        }
        break;
      case 'machine':
        if (id) {
          const machine = this.dal.getMachine(id);
          if (machine) {
            client.socket.send(JSON.stringify({ type: 'machine:updated', machine }));
          }
        } else {
          for (const machine of this.dal.listMachines()) {
            client.socket.send(JSON.stringify({ type: 'machine:updated', machine }));
          }
        }
        break;
      case 'queue':
        if (id) {
          const tasks = this.dal.listQueueTasks(id);
          client.socket.send(JSON.stringify({ type: 'queue:updated', machineId: id, queue: tasks }));
        }
        break;
    }
  }

  dispose(): void {
    this.clients.clear();
  }
}
