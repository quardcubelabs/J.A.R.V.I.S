
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
// MT5 Trading Types
export interface MT5OrderParams {
  login: string;
  symbol: string;
  volume: number;
  action: 'buy' | 'sell';
  order_type?: 'market' | 'limit' | 'stop';
  price?: number;
  stop_loss?: number;
  take_profit?: number;
  comment?: string;
}

export interface MT5PositionInfo {
  position_id: string;
  symbol: string;
  volume: number;
  price_open: number;
  price_current: number;
  profit: number;
  type: 'buy' | 'sell';
  time_open: number;
  stop_loss?: number;
  take_profit?: number;
  comment?: string;
}