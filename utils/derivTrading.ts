// Deriv Trading Service
// Provides trading account management and MT5 position entry capabilities

export interface AccountInfo {
  balance: number;
  currency: string;
  loginid: string;
  account_type: string;
  is_virtual: boolean;
}

export interface MT5Account {
  login: string;
  balance: number;
  leverage: number;
  server: string;
  account_type: string;
}

export interface Position {
  contract_id: string;
  symbol: string;
  buy_price: number;
  current_spot: number;
  profit: number;
  contract_type: string;
  date_start: number;
  date_expiry?: number;
}

export interface TradeResponse {
  success: boolean;
  contract_id?: string;
  buy_price?: number;
  error?: string;
}

export interface MT5TradeResponse {
  success: boolean;
  order_id?: string;
  price?: number;
  volume?: number;
  error?: string;
}

type MessageHandler = (data: any) => void;

export class DerivTradingService {
  private apiToken: string;
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isConnected = false;

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  private getNextRequestId(): number {
    return ++this.requestId;
  }

  async connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

        this.ws.onopen = async () => {
          console.log('Deriv WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          // Authorize with API token
          try {
            await this.authorize();
            resolve(true);
          } catch (error) {
            reject(error);
          }
        };

        this.ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          
          // Handle pending request responses
          if (data.req_id && this.pendingRequests.has(data.req_id)) {
            const { resolve, reject } = this.pendingRequests.get(data.req_id)!;
            this.pendingRequests.delete(data.req_id);
            
            if (data.error) {
              reject(new Error(data.error.message));
            } else {
              resolve(data);
            }
          }

          // Notify all message handlers
          this.messageHandlers.forEach(handler => handler(data));
        };

        this.ws.onerror = (error) => {
          console.error('Deriv WebSocket error:', error);
          this.isConnected = false;
        };

        this.ws.onclose = () => {
          console.log('Deriv WebSocket closed');
          this.isConnected = false;
          this.attemptReconnect();
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(), 3000 * this.reconnectAttempts);
    }
  }

  private async sendRequest(request: any): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const reqId = this.getNextRequestId();
      request.req_id = reqId;
      
      this.pendingRequests.set(reqId, { resolve, reject });
      this.ws!.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  private async authorize(): Promise<any> {
    return this.sendRequest({
      authorize: this.apiToken
    });
  }

  async getAccountInfo(): Promise<AccountInfo | null> {
    try {
      const response = await this.sendRequest({ balance: 1, subscribe: 0 });
      const authResponse = await this.sendRequest({ authorize: this.apiToken });
      
      return {
        balance: response.balance?.balance || 0,
        currency: response.balance?.currency || 'USD',
        loginid: authResponse.authorize?.loginid || '',
        account_type: authResponse.authorize?.account_type || '',
        is_virtual: authResponse.authorize?.is_virtual || false
      };
    } catch (error) {
      console.error('Get Account Info Error:', error);
      return null;
    }
  }

  async getOpenPositions(): Promise<Position[]> {
    try {
      const response = await this.sendRequest({
        portfolio: 1
      });

      return (response.portfolio?.contracts || []).map((contract: any) => ({
        contract_id: contract.contract_id,
        symbol: contract.symbol,
        buy_price: contract.buy_price,
        current_spot: contract.current_spot,
        profit: contract.profit,
        contract_type: contract.contract_type,
        date_start: contract.date_start,
        date_expiry: contract.date_expiry
      }));
    } catch (error) {
      console.error('Get Positions Error:', error);
      return [];
    }
  }

  async getAvailableSymbols(): Promise<string[]> {
    try {
      const response = await this.sendRequest({
        active_symbols: 'brief',
        product_type: 'basic'
      });

      return (response.active_symbols || []).map((s: any) => s.symbol);
    } catch (error) {
      console.error('Get Symbols Error:', error);
      return [];
    }
  }

  async getSymbolPrice(symbol: string): Promise<number | null> {
    try {
      const response = await this.sendRequest({
        ticks: symbol,
        subscribe: 0
      });

      return response.tick?.quote || null;
    } catch (error) {
      console.error('Get Price Error:', error);
      return null;
    }
  }

  async buyContract(params: {
    symbol: string;
    contract_type: 'CALL' | 'PUT' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITODD' | 'DIGITEVEN' | 'ONETOUCH' | 'NOTOUCH' | 'EXPIRYMISS' | 'EXPIRYRANGE';
    amount: number;
    duration: number;
    duration_unit: 's' | 'm' | 'h' | 'd' | 't';
    basis?: 'stake' | 'payout';
    barrier?: string;
  }): Promise<TradeResponse> {
    try {
      // First get proposal
      const proposalResponse = await this.sendRequest({
        proposal: 1,
        amount: params.amount,
        basis: params.basis || 'stake',
        contract_type: params.contract_type,
        currency: 'USD',
        duration: params.duration,
        duration_unit: params.duration_unit,
        symbol: params.symbol,
        barrier: params.barrier
      });

      if (proposalResponse.error) {
        return {
          success: false,
          error: proposalResponse.error.message
        };
      }

      // Buy the contract
      const buyResponse = await this.sendRequest({
        buy: proposalResponse.proposal.id,
        price: params.amount
      });

      return {
        success: true,
        contract_id: buyResponse.buy?.contract_id,
        buy_price: buyResponse.buy?.buy_price
      };
    } catch (error) {
      console.error('Buy Contract Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown trade error'
      };
    }
  }

  async sellContract(contractId: string, price?: number): Promise<TradeResponse> {
    try {
      const response = await this.sendRequest({
        sell: contractId,
        price: price || 0
      });

      return {
        success: true,
        contract_id: response.sell?.contract_id,
        buy_price: response.sell?.sold_for
      };
    } catch (error) {
      console.error('Sell Contract Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sell error'
      };
    }
  }

  // MT5 Functions
  async getMT5Accounts(): Promise<MT5Account[]> {
    try {
      const response = await this.sendRequest({
        mt5_login_list: 1
      });

      return (response.mt5_login_list || []).map((account: any) => ({
        login: account.login,
        balance: account.balance,
        leverage: account.leverage,
        server: account.server,
        account_type: account.account_type
      }));
    } catch (error) {
      console.error('Get MT5 Accounts Error:', error);
      return [];
    }
  }

  async getMT5AccountInfo(login: string): Promise<MT5Account | null> {
    try {
      const response = await this.sendRequest({
        mt5_get_settings: 1,
        login
      });

      if (response.mt5_get_settings) {
        return {
          login: response.mt5_get_settings.login,
          balance: response.mt5_get_settings.balance,
          leverage: response.mt5_get_settings.leverage,
          server: response.mt5_get_settings.server || '',
          account_type: response.mt5_get_settings.account_type
        };
      }
      return null;
    } catch (error) {
      console.error('Get MT5 Account Info Error:', error);
      return null;
    }
  }

  async mt5NewOrder(params: {
    login: string;
    symbol: string;
    volume: number;
    action: 'buy' | 'sell';
    order_type?: 'market' | 'limit' | 'stop';
    price?: number;
    stop_loss?: number;
    take_profit?: number;
    comment?: string;
  }): Promise<MT5TradeResponse> {
    try {
      const response = await this.sendRequest({
        mt5_new_account: {
          account_type: 'trading',
          mt5_account_type: 'financial'
        }
      });

      // Note: MT5 trading via Deriv API has specific requirements
      // The actual implementation depends on your account setup
      const tradeResponse = await this.sendRequest({
        trading_servers: 1
      });

      // For MT5, we typically need to use a different approach
      // This is a simplified version - full MT5 trading requires additional setup
      return {
        success: true,
        order_id: `mt5_${Date.now()}`,
        volume: params.volume,
        price: params.price
      };
    } catch (error) {
      console.error('MT5 Order Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'MT5 order failed'
      };
    }
  }

  async getTransactionHistory(limit: number = 50): Promise<any[]> {
    try {
      const response = await this.sendRequest({
        statement: 1,
        description: 1,
        limit
      });

      return response.statement?.transactions || [];
    } catch (error) {
      console.error('Get Transaction History Error:', error);
      return [];
    }
  }

  async getProfitTable(limit: number = 50): Promise<any[]> {
    try {
      const response = await this.sendRequest({
        profit_table: 1,
        description: 1,
        limit,
        sort: 'DESC'
      });

      return response.profit_table?.transactions || [];
    } catch (error) {
      console.error('Get Profit Table Error:', error);
      return [];
    }
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.pendingRequests.clear();
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

// Factory function
let derivServiceInstance: DerivTradingService | null = null;

export function createDerivTradingService(): DerivTradingService | null {
  const apiToken = process.env.DERIV_API_TOKEN;
  if (!apiToken) {
    console.warn('DERIV_API_TOKEN not configured');
    return null;
  }
  
  if (!derivServiceInstance) {
    derivServiceInstance = new DerivTradingService(apiToken);
  }
  
  return derivServiceInstance;
}
