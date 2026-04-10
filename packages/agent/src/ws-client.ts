import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import {
  type AgentToHubMessage,
  type HubToAgentMessage,
  hubToAgentSchema,
} from '@chq/shared';

export type WsConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WsClientOptions {
  url: string;
  machineId: string;
  version: string;
  maxSessions: number;
  os: string;
  heartbeatIntervalMs?: number;
  agentToken?: string;
  onMessage: (msg: HubToAgentMessage) => void;
}

export class WsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private _state: WsConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly options: WsClientOptions;
  private destroyed = false;

  constructor(options: WsClientOptions) {
    super();
    this.options = options;
  }

  get state(): WsConnectionState {
    return this._state;
  }

  connect(): void {
    if (this.destroyed) return;
    this.setState('connecting');

    const connectUrl = this.options.url;
    const wsOptions: WebSocket.ClientOptions = {};
    if (this.options.agentToken) {
      wsOptions.headers = { 'x-agent-token': this.options.agentToken };
    }
    this.ws = new WebSocket(connectUrl, wsOptions);

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.setState('connected');

      // Send registration
      this.send({
        type: 'agent:register',
        machineId: this.options.machineId,
        version: this.options.version,
        maxSessions: this.options.maxSessions,
        os: this.options.os,
      });

      // Start heartbeat
      this.startHeartbeat();
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const data = JSON.parse(raw.toString()) as unknown;
        const msg = hubToAgentSchema.parse(data);
        this.options.onMessage(msg);
      } catch (err) {
        this.emit('parseError', err);
      }
    });

    this.ws.on('close', () => {
      this.stopHeartbeat();
      this.setState('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.emit('wsError', err);
      // 'close' will fire after 'error', triggering reconnect
    });
  }

  send(msg: AgentToHubMessage): void {
    if (this._state !== 'connected' || !this.ws) {
      this.emit('sendFailed', msg);
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  sendHeartbeat(cpuPercent: number, memPercent: number, activeSessions: number): void {
    this.send({
      type: 'agent:heartbeat',
      machineId: this.options.machineId,
      activeSessions,
      cpuPercent,
      memPercent,
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.removeAllListeners();
  }

  private setState(state: WsConnectionState): void {
    this._state = state;
    this.emit('stateChange', state);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    const baseDelay = 1000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalMs ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeatTick');
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
