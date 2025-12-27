
export interface Message {
  id: string;
  role: 'user' | 'jarvis';
  content: string;
  timestamp: Date;
}

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface SystemStats {
  cpu: number;
  memory: number;
  network: number;
  uptime: string;
}
