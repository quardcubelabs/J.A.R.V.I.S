
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  Cpu, 
  Mic, 
  MicOff, 
  Terminal, 
  Wind, 
  Power, 
  ShieldCheck, 
  Zap, 
  Database, 
  MessageSquare, 
  RefreshCw, 
  MapPin, 
  FileCode, 
  Upload, 
  Battery, 
  Menu, 
  X,
  Search,
  TrendingUp,
  Globe
} from 'lucide-react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob as GenAIBlob, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionStatus, Message, SystemStats } from './types';
import { encode, decode, decodeAudioData, downsample } from './utils/audioHelpers';
import { createAIService } from './utils/aiService';
import { createWebSearchService, WebSearchService } from './utils/webSearch';
import { createResearchService, ResearchService } from './utils/research';
import { createDerivTradingService, DerivTradingService } from './utils/derivTrading';

// Define interface for attached files to ensure type safety and avoid 'unknown' errors
interface AttachedFile {
  name: string;
  type: string;
  size: number;
  content: string | ArrayBuffer | null;
}

// Constants
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const MAX_RECONNECT_ATTEMPTS = 3;

// Function Declarations for Gemini Tools
const deactivateAssistantFunctionDeclaration: FunctionDeclaration = {
  name: 'deactivate_assistant',
  description: 'Deactivates the assistant and puts it into standby mode.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const webSearchFunctionDeclaration: FunctionDeclaration = {
  name: 'web_search',
  description: 'Search the web for current information, news, or any topic. Use this when user asks about recent events, needs current data, or wants to look something up online.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The search query to look up on the web'
      },
      search_type: {
        type: Type.STRING,
        description: 'Type of search: "general", "news", or "images"'
      }
    },
    required: ['query']
  }
};

const researchFunctionDeclaration: FunctionDeclaration = {
  name: 'deep_research',
  description: 'Conduct deep research on a topic with comprehensive analysis. Use this for in-depth questions, academic queries, or when detailed information with sources is needed.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The research question or topic to investigate deeply'
      },
      topic_type: {
        type: Type.STRING,
        description: 'Type of research: "general", "news", or "finance"'
      }
    },
    required: ['query']
  }
};

const getDerivAccountFunctionDeclaration: FunctionDeclaration = {
  name: 'get_deriv_account',
  description: 'Get Deriv trading account information including balance, account type, and status.',
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

const getOpenPositionsFunctionDeclaration: FunctionDeclaration = {
  name: 'get_open_positions',
  description: 'Get all currently open trading positions on the Deriv account.',
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

const getSymbolPriceFunctionDeclaration: FunctionDeclaration = {
  name: 'get_symbol_price',
  description: 'Get the current price/quote for a trading symbol.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: {
        type: Type.STRING,
        description: 'The trading symbol (e.g., "R_100" for Volatility 100, "frxEURUSD" for EUR/USD)'
      }
    },
    required: ['symbol']
  }
};

const buyContractFunctionDeclaration: FunctionDeclaration = {
  name: 'buy_contract',
  description: 'Buy a trading contract on Deriv. Supports various contract types like CALL (Rise), PUT (Fall), and digit contracts.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: {
        type: Type.STRING,
        description: 'Trading symbol (e.g., "R_100", "R_50", "frxEURUSD")'
      },
      contract_type: {
        type: Type.STRING,
        description: 'Contract type: "CALL" (Rise), "PUT" (Fall), "DIGITOVER", "DIGITUNDER", "DIGITDIFF", "DIGITMATCH", "DIGITODD", "DIGITEVEN"'
      },
      amount: {
        type: Type.NUMBER,
        description: 'Stake amount in USD'
      },
      duration: {
        type: Type.NUMBER,
        description: 'Contract duration (number)'
      },
      duration_unit: {
        type: Type.STRING,
        description: 'Duration unit: "s" (seconds), "m" (minutes), "h" (hours), "d" (days), "t" (ticks)'
      },
      barrier: {
        type: Type.STRING,
        description: 'Barrier/prediction value for digit contracts (optional)'
      }
    },
    required: ['symbol', 'contract_type', 'amount', 'duration', 'duration_unit']
  }
};

const sellContractFunctionDeclaration: FunctionDeclaration = {
  name: 'sell_contract',
  description: 'Sell/close an open contract before expiry.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      contract_id: {
        type: Type.STRING,
        description: 'The ID of the contract to sell'
      }
    },
    required: ['contract_id']
  }
};

const getMT5AccountsFunctionDeclaration: FunctionDeclaration = {
  name: 'get_mt5_accounts',
  description: 'Get list of MT5 trading accounts linked to the Deriv account.',
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

const mt5PlaceOrderFunctionDeclaration: FunctionDeclaration = {
  name: 'mt5_place_order',
  description: 'Place a new trading position on MetaTrader 5. Supports buy and sell orders with optional stop loss and take profit.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      login: {
        type: Type.STRING,
        description: 'MT5 account login ID. Get this from get_mt5_accounts first.'
      },
      symbol: {
        type: Type.STRING,
        description: 'Trading symbol (e.g., "Volatility 75 Index", "EURUSD", "XAUUSD", "Step Index")'
      },
      action: {
        type: Type.STRING,
        description: 'Trade direction: "buy" or "sell"'
      },
      volume: {
        type: Type.NUMBER,
        description: 'Lot size/volume for the trade (e.g., 0.01, 0.1, 1.0)'
      },
      stop_loss: {
        type: Type.NUMBER,
        description: 'Optional stop loss price level'
      },
      take_profit: {
        type: Type.NUMBER,
        description: 'Optional take profit price level'
      },
      comment: {
        type: Type.STRING,
        description: 'Optional trade comment (e.g., "JARVIS trade")'
      }
    },
    required: ['login', 'symbol', 'action', 'volume']
  }
};

const mt5ClosePositionFunctionDeclaration: FunctionDeclaration = {
  name: 'mt5_close_position',
  description: 'Close an open MT5 position.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      login: {
        type: Type.STRING,
        description: 'MT5 account login ID'
      },
      ticket: {
        type: Type.NUMBER,
        description: 'Position ticket number to close'
      },
      volume: {
        type: Type.NUMBER,
        description: 'Optional partial volume to close. Leave empty to close entire position.'
      }
    },
    required: ['login', 'ticket']
  }
};

const mt5GetOpenPositionsFunctionDeclaration: FunctionDeclaration = {
  name: 'mt5_get_open_positions',
  description: 'Get all currently open positions on an MT5 account.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      login: {
        type: Type.STRING,
        description: 'MT5 account login ID. Get this from get_mt5_accounts first.'
      }
    },
    required: ['login']
  }
};

const mt5ModifyPositionFunctionDeclaration: FunctionDeclaration = {
  name: 'mt5_modify_position',
  description: 'Modify stop loss or take profit on an existing MT5 position.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      login: {
        type: Type.STRING,
        description: 'MT5 account login ID'
      },
      ticket: {
        type: Type.NUMBER,
        description: 'Position ticket number to modify'
      },
      stop_loss: {
        type: Type.NUMBER,
        description: 'New stop loss price level'
      },
      take_profit: {
        type: Type.NUMBER,
        description: 'New take profit price level'
      }
    },
    required: ['login', 'ticket']
  }
};

const mt5GetSymbolsFunctionDeclaration: FunctionDeclaration = {
  name: 'mt5_get_symbols',
  description: 'Get available trading symbols/instruments for MT5 trading.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      login: {
        type: Type.STRING,
        description: 'MT5 account login ID'
      }
    },
    required: ['login']
  }
};

const getProfitTableFunctionDeclaration: FunctionDeclaration = {
  name: 'get_profit_table',
  description: 'Get the profit/loss history of recent trades.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      limit: {
        type: Type.NUMBER,
        description: 'Number of transactions to retrieve (default 20)'
      }
    }
  }
};

// All function declarations for Gemini
const allFunctionDeclarations: FunctionDeclaration[] = [
  deactivateAssistantFunctionDeclaration,
  webSearchFunctionDeclaration,
  researchFunctionDeclaration,
  getDerivAccountFunctionDeclaration,
  getOpenPositionsFunctionDeclaration,
  getSymbolPriceFunctionDeclaration,
  buyContractFunctionDeclaration,
  sellContractFunctionDeclaration,
  getMT5AccountsFunctionDeclaration,
  mt5PlaceOrderFunctionDeclaration,
  mt5ClosePositionFunctionDeclaration,
  mt5GetOpenPositionsFunctionDeclaration,
  mt5ModifyPositionFunctionDeclaration,
  mt5GetSymbolsFunctionDeclaration,
  getProfitTableFunctionDeclaration
];

const App: React.FC = () => {
  // State
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [stats, setStats] = useState<SystemStats>({
    cpu: 12,
    memory: 42,
    network: 150,
    uptime: "00:00:00"
  });
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isWakeWordListening, setIsWakeWordListening] = useState(false);
  const [isAudioDetected, setIsAudioDetected] = useState(false);
  const [isWakeWordSupported, setIsWakeWordSupported] = useState(true);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [systemAlert, setSystemAlert] = useState<string | null>(null);
  const [standbyTranscript, setStandbyTranscript] = useState<string>('');
  
  // UI Visibility States
  const [showLogs, setShowLogs] = useState(true);
  const [showStats, setShowStats] = useState(true);

  // Refs for Audio/Socket
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const isSessionActiveRef = useRef<boolean>(false);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const shouldRestartRecognition = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  
  // Visualizer Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Audio Queue
  const audioProcessingQueue = useRef<string[]>([]);
  const isProcessingAudio = useRef(false);

  // Service Refs
  const webSearchServiceRef = useRef<WebSearchService | null>(null);
  const researchServiceRef = useRef<ResearchService | null>(null);
  const derivServiceRef = useRef<DerivTradingService | null>(null);

  // Initialize services
  useEffect(() => {
    webSearchServiceRef.current = createWebSearchService();
    researchServiceRef.current = createResearchService();
    derivServiceRef.current = createDerivTradingService();
    
    // Connect to Deriv if service is available
    if (derivServiceRef.current) {
      derivServiceRef.current.connect().then(() => {
        console.log('Deriv trading service connected');
      }).catch(err => {
        console.warn('Deriv connection failed:', err);
      });
    }

    return () => {
      if (derivServiceRef.current) {
        derivServiceRef.current.disconnect();
      }
    };
  }, []);

  // --- Helpers ---

  const getDynamicSystemInstruction = useCallback(() => {
    const now = new Date();
    const batteryStr = batteryLevel !== null ? `${Math.round(batteryLevel)}%` : "Unknown";
    const fileList = attachedFiles.map(f => `- ${f.name} (${f.type}, ${Math.round(f.size/1024)}KB)`).join('\n');
    const derivConnected = derivServiceRef.current?.getConnectionStatus() ? 'Connected' : 'Disconnected';
    
    return `You are J.A.R.V.I.S., Tony Stark's AI assistant. You are sophisticated, British, and polite. Address user as 'Framan'. 

CURRENT STATUS:
- Power: ${batteryStr}
- Time: ${now.toLocaleTimeString()}
- Date: ${now.toLocaleDateString()}
- Files Loaded: ${fileList || "None"}
- Deriv Trading: ${derivConnected}

CAPABILITIES:
1. WEB SEARCH (web_search): Search the internet for current information, news, images
2. DEEP RESEARCH (deep_research): Conduct comprehensive research with citations on any topic

3. DERIV TRADING (Binary Options):
   - get_deriv_account: Check account balance and status
   - get_open_positions: View current open Deriv trades
   - get_symbol_price: Get real-time prices for symbols
   - buy_contract: Enter CALL/PUT positions, digit trades
   - sell_contract: Close positions early
   - get_profit_table: View trading history and P&L

4. METATRADER 5 (MT5) TRADING - Full CFD/Forex trading:
   - get_mt5_accounts: List all MT5 accounts (ALWAYS call this first to get login ID)
   - mt5_place_order: Place buy/sell positions on MT5 (requires login from get_mt5_accounts)
   - mt5_get_open_positions: View all open MT5 positions
   - mt5_close_position: Close an MT5 position by ticket number
   - mt5_modify_position: Modify stop loss/take profit on MT5 positions
   - mt5_get_symbols: Get available MT5 trading symbols

MT5 TRADING WORKFLOW:
1. First call get_mt5_accounts to get the MT5 login ID
2. Then use that login to place orders with mt5_place_order
3. Example: To buy EURUSD on MT5, first get accounts, then call mt5_place_order with login, symbol="EURUSD", action="buy", volume=0.01

POPULAR MT5 SYMBOLS:
- Forex: EURUSD, GBPUSD, USDJPY, XAUUSD (Gold)
- Synthetics: Volatility 75 Index, Volatility 100 Index, Step Index, Boom 1000, Crash 1000

DERIV BINARY SYMBOLS: R_100 (Volatility 100), R_50 (Volatility 50), R_25 (Volatility 25), R_10 (Volatility 10), frxEURUSD, frxGBPUSD

Important Protocol: If the user says "thanks bye", say a very brief, polite farewell and acknowledge that you are entering standby mode.`;
  }, [batteryLevel, attachedFiles]);

  // --- Core Lifecycle ---

  const deactivateVoice = useCallback(() => {
    console.log("JARVIS: Entering standby protocol.");
    isSessionActiveRef.current = false;
    
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
    }

    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    audioProcessingQueue.current = [];

    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }

    setIsVoiceActive(false);
    setStatus(ConnectionStatus.DISCONNECTED);
    shouldRestartRecognition.current = true;
    
    // Log deactivation to system logs
    setMessages(prev => [...prev, {
      id: `sys-deactivated-${Date.now()}`,
      role: 'jarvis',
      content: "[SYSTEM] Voice uplink terminated. Returning to standby.",
      timestamp: new Date()
    }]);
    
    // Clear any leftover transcripts
    setStandbyTranscript('');
    
    // Resume listening strictly for activation phrase
    startWakeWordDetection();
  }, []);

  const startWakeWordDetection = useCallback(() => {
    // Check for SpeechRecognition support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    // Detect mobile platforms
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(navigator.userAgent);
    const isMobile = isIOS || isAndroid;
    
    if (!SpeechRecognition) {
      console.log("SpeechRecognition not supported on this device");
      setIsWakeWordSupported(false);
      return;
    }

    // Try to enable wake word on all platforms
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }

    const recognition = new SpeechRecognition();
    // Enable continuous mode - works on Android, limited on iOS but we'll try
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsWakeWordListening(true);
      setIsWakeWordSupported(true);
      setSystemAlert(null); // Clear any previous alerts
      console.log("Acoustic trigger active: Monitoring for 'Hello JARVIS'...");
    };

    recognition.onresult = (event: any) => {
      setIsAudioDetected(true);
      
      // We look at the most recent segments to detect the wake word reliably
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        setStandbyTranscript(transcript);

        // Check for the specific activation word "hello jarvis"
        if (transcript.includes('hello jarvis') || transcript.includes('hello jarvis.') || transcript.includes('hey jarvis')) {
          console.log("Core activation detected via transcript segment:", transcript);
          
          setMessages(prev => [...prev, { 
            id: `sys-wake-${Date.now()}`, 
            role: 'jarvis', 
            content: "[SYSTEM] 'Hello JARVIS' detected. Core re-initialized.", 
            timestamp: new Date() 
          }]);
          
          shouldRestartRecognition.current = false;
          recognition.onend = null; 
          recognition.onresult = null;
          try { recognition.stop(); } catch(e) {}
          
          activateVoice();
          return;
        }
      }

      // Reset audio detection visual after a short delay if no word matched
      setTimeout(() => setIsAudioDetected(false), 1200);
    };

    recognition.onerror = (e: any) => {
      console.warn("SpeechRecognition error:", e.error);
      
      // Handle different error types gracefully
      if (e.error === 'not-allowed') {
        // Microphone permission denied
        setMessages(prev => [...prev, {
          id: `sys-mic-${Date.now()}`,
          role: 'jarvis',
          content: "[SYSTEM] Microphone permission needed for wake word. Please allow and tap RESET_TRIGGER.",
          timestamp: new Date()
        }]);
        setIsWakeWordSupported(false);
      } else if (e.error === 'no-speech' || e.error === 'aborted') {
        // These are normal on mobile, don't show alerts - just restart
      } else if (e.error === 'network') {
        console.log("SpeechRecognition network error - may need online connection");
      }
      
      setIsWakeWordListening(false);
    };

    recognition.onend = () => {
      setIsWakeWordListening(false);
      setIsAudioDetected(false);
      // Continuous restart on ALL platforms unless we are transitioning to active mode
      if (shouldRestartRecognition.current && !isSessionActiveRef.current) {
        setTimeout(() => {
           if (shouldRestartRecognition.current && !isSessionActiveRef.current) {
             try { recognition.start(); } catch(e) {
               console.warn("Failed to restart recognition:", e);
             }
           }
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    try { 
      recognition.start(); 
    } catch (e) { 
      console.warn("SpeechRecognition failed to start:", e);
      setIsWakeWordSupported(false);
    }
  }, []);

  const processAudioQueue = async () => {
    if (isProcessingAudio.current || audioProcessingQueue.current.length === 0) return;
    if (!audioContextRef.current) return;
    
    isProcessingAudio.current = true;
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();

    while (audioProcessingQueue.current.length > 0) {
      const audioData = audioProcessingQueue.current.shift();
      if (!audioData) continue;
      try {
        const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        
        const destination = outputAnalyserRef.current || ctx.destination;
        source.connect(destination);
        
        const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        
        source.addEventListener('ended', () => {
          sourcesRef.current.delete(source);
        });
        sourcesRef.current.add(source);
      } catch (err) {
        console.error("Audio Decoding Error:", err);
      }
    }
    isProcessingAudio.current = false;
  };

  const handleMessage = useCallback(async (message: LiveServerMessage) => {
    if (!isSessionActiveRef.current) return;

    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      audioProcessingQueue.current.push(audioData);
      processAudioQueue();
    }

    // "Thanks Bye" detection via input transcription
    if (message.serverContent?.inputTranscription) {
      const transcript = message.serverContent.inputTranscription.text.toLowerCase();
      if (transcript.includes('thanks bye')) {
        setMessages(prev => [...prev, { 
          id: `sys-shutdown-${Date.now()}`, 
          role: 'jarvis', 
          content: "[SYSTEM] 'Thanks Bye' confirmed. Engaging core standby.", 
          timestamp: new Date() 
        }]);
        // Delay to allow JARVIS to say goodbye
        setTimeout(deactivateVoice, 3000);
      }
    }

    if (message.toolCall) {
      for (const fc of message.toolCall.functionCalls) {
        let result: any = { status: "success" };
        const args = fc.args as Record<string, any> || {};
        
        try {
          switch (fc.name) {
            case 'deactivate_assistant':
              setTimeout(deactivateVoice, 1000);
              result = { confirmation: "Standby sequence initialized." };
              break;

            case 'web_search':
              if (webSearchServiceRef.current) {
                const searchType = String(args.search_type || 'general');
                const query = String(args.query || '');
                let searchResult;
                
                if (searchType === 'news') {
                  searchResult = await webSearchServiceRef.current.searchNews(query);
                } else if (searchType === 'images') {
                  searchResult = await webSearchServiceRef.current.searchImages(query);
                } else {
                  searchResult = await webSearchServiceRef.current.search(query);
                }
                
                result = {
                  query: searchResult.query,
                  answer_box: searchResult.answer_box,
                  knowledge_graph: searchResult.knowledge_graph,
                  results: searchResult.results.slice(0, 5).map(r => ({
                    title: r.title,
                    link: r.link,
                    snippet: r.snippet
                  }))
                };
                
                setMessages(prev => [...prev, {
                  id: `search-${Date.now()}`,
                  role: 'jarvis',
                  content: `[WEB SEARCH] Query: "${query}" - Found ${searchResult.results.length} results`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Web search service not configured" };
              }
              break;

            case 'deep_research':
              if (researchServiceRef.current) {
                const topicType = String(args.topic_type || 'general');
                const query = String(args.query || '');
                let researchResult;
                
                if (topicType === 'news') {
                  researchResult = await researchServiceRef.current.researchNews(query);
                } else if (topicType === 'finance') {
                  researchResult = await researchServiceRef.current.researchFinance(query);
                } else {
                  researchResult = await researchServiceRef.current.research(query);
                }
                
                result = {
                  query: researchResult.query,
                  answer: researchResult.answer,
                  sources: researchResult.results.slice(0, 5).map(r => ({
                    title: r.title,
                    url: r.url,
                    content: r.content.substring(0, 500)
                  })),
                  follow_up_questions: researchResult.follow_up_questions
                };
                
                setMessages(prev => [...prev, {
                  id: `research-${Date.now()}`,
                  role: 'jarvis',
                  content: `[RESEARCH] Topic: "${query}" - Analysis complete`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Research service not configured" };
              }
              break;

            case 'get_deriv_account':
              if (derivServiceRef.current) {
                const accountInfo = await derivServiceRef.current.getAccountInfo();
                result = accountInfo || { error: "Could not retrieve account info" };
                
                setMessages(prev => [...prev, {
                  id: `deriv-account-${Date.now()}`,
                  role: 'jarvis',
                  content: `[DERIV] Account balance: ${accountInfo?.balance} ${accountInfo?.currency}`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'get_open_positions':
              if (derivServiceRef.current) {
                const positions = await derivServiceRef.current.getOpenPositions();
                result = { positions, count: positions.length };
                
                setMessages(prev => [...prev, {
                  id: `deriv-positions-${Date.now()}`,
                  role: 'jarvis',
                  content: `[DERIV] Open positions: ${positions.length}`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'get_symbol_price':
              if (derivServiceRef.current && args.symbol) {
                const symbol = String(args.symbol);
                const price = await derivServiceRef.current.getSymbolPrice(symbol);
                result = { symbol, price };
                
                setMessages(prev => [...prev, {
                  id: `deriv-price-${Date.now()}`,
                  role: 'jarvis',
                  content: `[DERIV] ${symbol} price: ${price}`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Deriv service not connected or symbol not provided" };
              }
              break;

            case 'buy_contract':
              if (derivServiceRef.current) {
                const tradeSymbol = String(args.symbol || 'R_100');
                const contractType = String(args.contract_type || 'CALL') as 'CALL' | 'PUT' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITODD' | 'DIGITEVEN' | 'ONETOUCH' | 'NOTOUCH' | 'EXPIRYMISS' | 'EXPIRYRANGE';
                const amount = Number(args.amount || 1);
                const duration = Number(args.duration || 5);
                const durationUnit = String(args.duration_unit || 't') as 's' | 'm' | 'h' | 'd' | 't';
                const barrier = args.barrier ? String(args.barrier) : undefined;
                
                const tradeResult = await derivServiceRef.current.buyContract({
                  symbol: tradeSymbol,
                  contract_type: contractType,
                  amount,
                  duration,
                  duration_unit: durationUnit,
                  barrier
                });
                
                result = tradeResult;
                
                setMessages(prev => [...prev, {
                  id: `deriv-buy-${Date.now()}`,
                  role: 'jarvis',
                  content: tradeResult.success 
                    ? `[TRADE] Bought ${contractType} on ${tradeSymbol} - Contract ID: ${tradeResult.contract_id}`
                    : `[TRADE ERROR] ${tradeResult.error}`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'sell_contract':
              if (derivServiceRef.current && args.contract_id) {
                const contractId = String(args.contract_id);
                const sellResult = await derivServiceRef.current.sellContract(contractId);
                result = sellResult;
                
                setMessages(prev => [...prev, {
                  id: `deriv-sell-${Date.now()}`,
                  role: 'jarvis',
                  content: sellResult.success 
                    ? `[TRADE] Sold contract ${contractId}`
                    : `[TRADE ERROR] ${sellResult.error}`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Deriv service not connected or contract ID not provided" };
              }
              break;

            case 'get_mt5_accounts':
              if (derivServiceRef.current) {
                const mt5Accounts = await derivServiceRef.current.getMT5Accounts();
                result = { accounts: mt5Accounts, count: mt5Accounts.length };
                
                setMessages(prev => [...prev, {
                  id: `deriv-mt5-${Date.now()}`,
                  role: 'jarvis',
                  content: `[MT5] Found ${mt5Accounts.length} MT5 account(s): ${mt5Accounts.map(a => a.login).join(', ')}`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'mt5_place_order':
              if (derivServiceRef.current) {
                const mt5Login = String(args.login || '');
                const mt5Symbol = String(args.symbol || '');
                const mt5Action = String(args.action || 'buy') as 'buy' | 'sell';
                const mt5Volume = Number(args.volume || 0.01);
                const mt5StopLoss = args.stop_loss ? Number(args.stop_loss) : undefined;
                const mt5TakeProfit = args.take_profit ? Number(args.take_profit) : undefined;
                const mt5Comment = args.comment ? String(args.comment) : 'JARVIS Trade';

                if (!mt5Login) {
                  result = { error: "MT5 login required. Please call get_mt5_accounts first to get the login ID." };
                } else if (!mt5Symbol) {
                  result = { error: "Symbol is required for MT5 order." };
                } else {
                  const orderResult = await derivServiceRef.current.mt5NewOrder({
                    login: mt5Login,
                    symbol: mt5Symbol,
                    volume: mt5Volume,
                    action: mt5Action,
                    stop_loss: mt5StopLoss,
                    take_profit: mt5TakeProfit,
                    comment: mt5Comment
                  });
                  
                  result = orderResult;
                  
                  setMessages(prev => [...prev, {
                    id: `mt5-order-${Date.now()}`,
                    role: 'jarvis',
                    content: orderResult.success 
                      ? `[MT5 TRADE] ${mt5Action.toUpperCase()} ${mt5Volume} lots of ${mt5Symbol} - Ticket: ${orderResult.ticket || orderResult.order_id}`
                      : `[MT5 ERROR] ${orderResult.error}`,
                    timestamp: new Date()
                  }]);
                }
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'mt5_close_position':
              if (derivServiceRef.current) {
                const closeLogin = String(args.login || '');
                const closeTicket = Number(args.ticket || 0);
                const closeVolume = args.volume ? Number(args.volume) : undefined;

                if (!closeLogin || !closeTicket) {
                  result = { error: "Both login and ticket are required to close a position." };
                } else {
                  const closeResult = await derivServiceRef.current.mt5ClosePosition({
                    login: closeLogin,
                    ticket: closeTicket,
                    volume: closeVolume
                  });
                  
                  result = closeResult;
                  
                  setMessages(prev => [...prev, {
                    id: `mt5-close-${Date.now()}`,
                    role: 'jarvis',
                    content: closeResult.success 
                      ? `[MT5] Position #${closeTicket} closed successfully`
                      : `[MT5 ERROR] ${closeResult.error}`,
                    timestamp: new Date()
                  }]);
                }
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'mt5_get_open_positions':
              if (derivServiceRef.current) {
                const posLogin = String(args.login || '');
                
                if (!posLogin) {
                  result = { error: "MT5 login required. Please call get_mt5_accounts first." };
                } else {
                  const positions = await derivServiceRef.current.getMT5OpenPositions(posLogin);
                  result = { 
                    positions, 
                    count: positions.length,
                    summary: positions.map(p => `${p.type.toUpperCase()} ${p.volume} ${p.symbol} @ ${p.price_open} (P/L: ${p.profit})`).join('\n')
                  };
                  
                  setMessages(prev => [...prev, {
                    id: `mt5-positions-${Date.now()}`,
                    role: 'jarvis',
                    content: `[MT5] ${positions.length} open position(s)`,
                    timestamp: new Date()
                  }]);
                }
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'mt5_modify_position':
              if (derivServiceRef.current) {
                const modLogin = String(args.login || '');
                const modTicket = Number(args.ticket || 0);
                const modSL = args.stop_loss ? Number(args.stop_loss) : undefined;
                const modTP = args.take_profit ? Number(args.take_profit) : undefined;

                if (!modLogin || !modTicket) {
                  result = { error: "Both login and ticket are required to modify a position." };
                } else {
                  const modResult = await derivServiceRef.current.mt5ModifyPosition({
                    login: modLogin,
                    ticket: modTicket,
                    stop_loss: modSL,
                    take_profit: modTP
                  });
                  
                  result = modResult;
                  
                  setMessages(prev => [...prev, {
                    id: `mt5-modify-${Date.now()}`,
                    role: 'jarvis',
                    content: modResult.success 
                      ? `[MT5] Position #${modTicket} modified - SL: ${modSL || 'unchanged'}, TP: ${modTP || 'unchanged'}`
                      : `[MT5 ERROR] ${modResult.error}`,
                    timestamp: new Date()
                  }]);
                }
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'mt5_get_symbols':
              if (derivServiceRef.current) {
                const symLogin = String(args.login || '');
                
                if (!symLogin) {
                  result = { error: "MT5 login required." };
                } else {
                  const symbols = await derivServiceRef.current.getMT5Symbols(symLogin);
                  result = { 
                    symbols: symbols.slice(0, 50), // Limit to 50 symbols
                    count: symbols.length 
                  };
                  
                  setMessages(prev => [...prev, {
                    id: `mt5-symbols-${Date.now()}`,
                    role: 'jarvis',
                    content: `[MT5] Retrieved ${symbols.length} available trading symbols`,
                    timestamp: new Date()
                  }]);
                }
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            case 'get_profit_table':
              if (derivServiceRef.current) {
                const limit = Number(args.limit || 20);
                const profitTable = await derivServiceRef.current.getProfitTable(limit);
                result = { transactions: profitTable, count: profitTable.length };
                
                setMessages(prev => [...prev, {
                  id: `deriv-profit-${Date.now()}`,
                  role: 'jarvis',
                  content: `[DERIV] Retrieved ${profitTable.length} transactions from profit table`,
                  timestamp: new Date()
                }]);
              } else {
                result = { error: "Deriv trading service not connected" };
              }
              break;

            default:
              result = { error: `Unknown function: ${fc.name}` };
          }
        } catch (error) {
          console.error(`Tool execution error for ${fc.name}:`, error);
          result = { error: error instanceof Error ? error.message : 'Tool execution failed' };
        }
        
        if (sessionRef.current && isSessionActiveRef.current) {
          try {
            sessionRef.current.sendToolResponse({
              functionResponses: [{ id: fc.id, name: fc.name, response: result }]
            });
          } catch (e) { console.error("Tool Response Error", e); }
        }
      }
    }

    if (message.serverContent?.interrupted) {
      audioProcessingQueue.current = [];
      sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
      sourcesRef.current.clear();
      nextStartTimeRef.current = 0;
    }
  }, [deactivateVoice]);

  const activateVoice = async () => {
    if (isVoiceActive || status === ConnectionStatus.CONNECTING) return;
    
    console.log("JARVIS: Initiating core activation...");
    setStatus(ConnectionStatus.CONNECTING);
    isSessionActiveRef.current = true;

    // Add a message so user knows something is happening
    setMessages(prev => [...prev, {
      id: `sys-init-${Date.now()}`,
      role: 'jarvis',
      content: "[SYSTEM] Initializing voice uplink...",
      timestamp: new Date()
    }]);

    // Track connection timeout at function scope
    let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
    let isConnecting = true;

    try {
      shouldRestartRecognition.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onresult = null;
        try { recognitionRef.current.stop(); } catch (e) {}
        recognitionRef.current = null;
      }
      
      setIsWakeWordListening(false);
      setIsAudioDetected(false);
      setStandbyTranscript('');
      
      // Check API key
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY not configured");
      }
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
      }

      if (audioContextRef.current) await audioContextRef.current.close().catch(() => {});
      if (inputAudioContextRef.current) await inputAudioContextRef.current.close().catch(() => {});
      
      // Create output AudioContext
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      // Resume AudioContext (required on mobile after user gesture)
      if (outCtx.state === 'suspended') {
        await outCtx.resume();
      }
      audioContextRef.current = outCtx;
      const outAnalyser = outCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outAnalyser.connect(outCtx.destination);
      outputAnalyserRef.current = outAnalyser;
      
      // Create input AudioContext
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (inCtx.state === 'suspended') {
        await inCtx.resume();
      }
      inputAudioContextRef.current = inCtx;
      const inAnalyser = inCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;
      
      // Get microphone access
      if (!streamRef.current) {
        console.log("JARVIS: Requesting microphone access...");
        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (micErr: any) {
          console.error("Microphone access denied:", micErr);
          setMessages(prev => [...prev, {
            id: `sys-mic-err-${Date.now()}`,
            role: 'jarvis',
            content: "[ERROR] Microphone access denied. Please allow microphone permission and try again.",
            timestamp: new Date()
          }]);
          throw micErr;
        }
      }
      const stream = streamRef.current;
      
      console.log("JARVIS: Connecting to Gemini Live API...");
      
      // Create a timeout for connection
      connectionTimeout = setTimeout(() => {
        if (isConnecting) {
          console.error("Connection timeout");
          isConnecting = false;
          setMessages(prev => [...prev, {
            id: `sys-timeout-${Date.now()}`,
            role: 'jarvis',
            content: "[ERROR] Connection timeout. Please check your internet connection and try again.",
            timestamp: new Date()
          }]);
          deactivateVoice();
          setStatus(ConnectionStatus.ERROR);
        }
      }, 15000); // 15 second timeout
      
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: getDynamicSystemInstruction(),
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          tools: [{functionDeclarations: allFunctionDeclarations}],
        },
        callbacks: {
          onopen: () => {
            if (!isSessionActiveRef.current) return;
            clearTimeout(connectionTimeout); // Clear the timeout on successful connection
            console.log("JARVIS: Connection established.");
            reconnectAttemptsRef.current = 0;
            setStatus(ConnectionStatus.CONNECTED);
            setIsVoiceActive(true);
            setSystemAlert(null);
            
            sessionPromise.then(s => {
                if (isSessionActiveRef.current) {
                    s.sendClientContent({
                      turns: [{ role: 'user', parts: [{ text: "Hello JARVIS. System initialized. Give Framan a status update." }] }],
                      turnComplete: true
                    });
                }
            }).catch(() => {});

            setTimeout(() => {
                if (!isSessionActiveRef.current || !inCtx || !stream) return;
                const source = inCtx.createMediaStreamSource(stream);
                if (inAnalyser) source.connect(inAnalyser);
                
                const processor = inCtx.createScriptProcessor(4096, 1, 1);
                scriptProcessorRef.current = processor;
                const inputSR = inCtx.sampleRate;
                
                processor.onaudioprocess = (e) => {
                    if (!isSessionActiveRef.current) return;
                    const input = e.inputBuffer.getChannelData(0);
                    if (!input || input.length === 0) return;
                    
                    const downsampled = downsample(input, inputSR || 44100, 16000);
                    const int16 = new Int16Array(downsampled.length);
                    for (let i = 0; i < downsampled.length; i++) int16[i] = downsampled[i] * 32768;
                    
                    const pcmBlob: GenAIBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                    sessionPromise.then(s => {
                        if (isSessionActiveRef.current) {
                            try { s.sendRealtimeInput({ media: pcmBlob }); } catch (err) { }
                        }
                    }).catch(() => {});
                };
                source.connect(processor);
                processor.connect(inCtx.destination);
            }, 800);
          },
          onmessage: handleMessage,
          onclose: () => { if (isSessionActiveRef.current) deactivateVoice(); },
          onerror: (e) => { 
            console.error("Live Error:", e);
            if (isSessionActiveRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttemptsRef.current++;
              activateVoice();
            } else {
              setSystemAlert("Core link severed.");
              deactivateVoice();
            }
          }
        }
      });
      sessionRef.current = await sessionPromise;
      isConnecting = false;
      if (connectionTimeout) clearTimeout(connectionTimeout);
      console.log("JARVIS: Core activation successful.");
      
      // Log success to system logs
      setMessages(prev => [...prev, {
        id: `sys-connected-${Date.now()}`,
        role: 'jarvis',
        content: "[SYSTEM] Neural uplink established. Voice interface ready.",
        timestamp: new Date()
      }]);
    } catch (err: any) { 
      console.error("Core initialization failed.", err);
      isConnecting = false;
      if (connectionTimeout) clearTimeout(connectionTimeout);
      
      // Provide user feedback about the error
      const errorMessage = err?.message || "Unknown error";
      setMessages(prev => [...prev, {
        id: `sys-err-${Date.now()}`,
        role: 'jarvis',
        content: `[ERROR] Core initialization failed: ${errorMessage}. Please check your connection and try again.`,
        timestamp: new Date()
      }]);
      
      deactivateVoice();
      setStatus(ConnectionStatus.ERROR);
    }
  };

  const drawVisualizer = useCallback(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const outAn = outputAnalyserRef.current;
    const inAn = inputAnalyserRef.current;
    const bufferLength = (outAn || inAn)?.frequencyBinCount || 128;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let sum = 0;
      if (outAn) {
        outAn.getByteFrequencyData(dataArray);
        sum = dataArray.reduce((a, b) => a + b, 0);
      } else if (inAn) {
        inAn.getByteFrequencyData(dataArray);
        sum = dataArray.reduce((a, b) => a + b, 0);
      }

      let activeLevel = sum / bufferLength;
      const isActuallyActive = activeLevel > 2 || isVoiceActive || isWakeWordListening;

      if (!isActuallyActive) return;

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = canvas.width * 0.25;
      const colorRGB = isVoiceActive ? '34, 197, 94' : '6, 182, 212';
      const scaleFactor = 1 + (activeLevel / 150);

      // Draw smooth circular waveform instead of boxed lines
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${colorRGB}, 0.6)`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Create smooth circular wave
      const points: {x: number, y: number}[] = [];
      const numPoints = Math.min(bufferLength, 64);
      
      for (let i = 0; i <= numPoints; i++) {
        const index = Math.floor((i / numPoints) * bufferLength) % bufferLength;
        const value = dataArray[index] / 255.0;
        const angle = (i / numPoints) * Math.PI * 2;
        const waveAmplitude = value * 40 * scaleFactor;
        const radius = baseRadius + waveAmplitude;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        points.push({x, y});
      }

      // Draw smooth curve through points
      if (points.length > 2) {
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.quadraticCurveTo(
          points[points.length - 1].x, 
          points[points.length - 1].y, 
          points[0].x, 
          points[0].y
        );
      }
      ctx.closePath();
      ctx.stroke();

      // Draw second wave ring (outer glow effect)
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${colorRGB}, 0.3)`;
      ctx.lineWidth = 1;
      
      for (let i = 0; i <= numPoints; i++) {
        const index = Math.floor((i / numPoints) * bufferLength) % bufferLength;
        const value = dataArray[index] / 255.0;
        const angle = (i / numPoints) * Math.PI * 2;
        const waveAmplitude = value * 55 * scaleFactor;
        const radius = baseRadius + waveAmplitude;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();

      // Inner glow circle
      try {
        const radiusInner = Math.max(0.1, baseRadius * 0.6);
        const radiusOuter = Math.max(radiusInner + 1, baseRadius + 30 * scaleFactor);
        const grd = ctx.createRadialGradient(centerX, centerY, radiusInner, centerX, centerY, radiusOuter);
        grd.addColorStop(0, `rgba(${colorRGB}, 0.05)`);
        grd.addColorStop(0.5, `rgba(${colorRGB}, 0.1)`);
        grd.addColorStop(1, `rgba(${colorRGB}, 0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radiusOuter, 0, Math.PI * 2);
        ctx.fill();
      } catch (e) { }
    };
    render();
  }, [isVoiceActive, isWakeWordListening]);

  useEffect(() => {
    drawVisualizer();
    return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
  }, [drawVisualizer]);

  useEffect(() => {
    const statsInterval = setInterval(() => {
      setStats(prev => ({
        cpu: Math.min(100, Math.max(0, prev.cpu + (Math.random() - 0.5) * 8)),
        memory: Math.min(100, Math.max(0, prev.memory + (Math.random() - 0.5) * 2)),
        network: Math.max(10, prev.network + (Math.random() - 0.5) * 20),
        uptime: new Date().toLocaleTimeString('en-GB', { hour12: false })
      }));
    }, 2000);

    if ((navigator as any).getBattery) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(battery.level * 100);
        battery.addEventListener('levelchange', () => setBatteryLevel(battery.level * 100));
      });
    }

    const init = async () => {
      // Detect iOS for special handling
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      
      try {
        // Request microphone permission
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Only start wake word detection if we got permission
        // On iOS, this may still fail due to SpeechRecognition limitations
        startWakeWordDetection();
      } catch (err: any) {
        console.warn("Mic access issue:", err?.name, err?.message);
        
        // Don't show alarming alerts on iOS - it's expected behavior
        if (!isIOS) {
          // Even on desktop, just log a message instead of showing critical alert
          setMessages(prev => [...prev, {
            id: `sys-mic-init-${Date.now()}`,
            role: 'jarvis',
            content: "[SYSTEM] Microphone access not granted. Tap INITIALIZE to enable voice mode.",
            timestamp: new Date()
          }]);
        }
        
        // Mark wake word as not supported since we can't get mic access
        setIsWakeWordSupported(false);
      }
    };
    init();

    return () => {
      clearInterval(statsInterval);
      shouldRestartRecognition.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onresult = null;
        try { recognitionRef.current.stop(); } catch(e) {}
      }
    };
  }, [startWakeWordDetection]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    // Explicitly type file as File to avoid 'unknown' type errors during iteration
    (Array.from(files) as File[]).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachedFiles(prev => [...prev, {
          name: file.name,
          type: file.type,
          size: file.size,
          content: event.target?.result || null
        }]);
      };
      
      const isText = file.type.startsWith('text/') || 
                     /\.(ts|tsx|js|jsx|json|md|txt|css|html)$/.test(file.name);
      
      if (isText) {
        // file is of type File which extends Blob, required by readAsText
        reader.readAsText(file);
      } else {
        // file is of type File which extends Blob, required by readAsArrayBuffer
        reader.readAsArrayBuffer(file);
      }
    });
  }, []);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const userMsg = inputText;
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: userMsg, timestamp: new Date() }]);
    setInputText('');
    
    if (userMsg.toLowerCase().includes('thanks bye')) {
       setMessages(prev => [...prev, { id: `sys-${Date.now()}`, role: 'jarvis', content: "[SYSTEM] Manual shutdown sequence engaged.", timestamp: new Date() }]);
       setTimeout(deactivateVoice, 1000);
       return;
    }

    try {
      const aiService = createAIService();
      const response = await aiService.generateText(userMsg, getDynamicSystemInstruction());
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'jarvis', content: response.text || "...", timestamp: new Date() }]);
    } catch (err) { 
      console.error('AI Service Error:', err);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'jarvis', content: "AI service unavailable. Please check your local AI server.", timestamp: new Date() }]);
    }
  };

  return (
    <div className={`relative h-screen w-screen overflow-hidden bg-slate-950 text-cyan-400 font-inter select-none transition-colors duration-500 ${systemAlert ? 'bg-red-950/20' : ''}`}>
      <div className="scanline"></div>
      
      {systemAlert && (
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-50 flex items-center justify-center px-4">
           <div className="bg-red-600/20 border-y-2 border-red-500 w-full py-2 sm:py-4 text-center animate-pulse">
             <span className="font-orbitron text-red-500 tracking-[0.2em] sm:tracking-[0.5em] text-[10px] sm:text-xs lg:text-sm uppercase">CRITICAL ALERT: {systemAlert}</span>
           </div>
        </div>
      )}

      {/* Mobile/Tablet Header - visible below lg breakpoint */}
      <div className="lg:hidden absolute top-0 left-0 w-full p-2 sm:p-4 flex justify-between items-center z-50 bg-slate-950/80 backdrop-blur-sm border-b border-cyan-500/10">
        <h1 className="font-orbitron text-xs sm:text-sm tracking-wider sm:tracking-widest text-glow flex items-center gap-1.5 sm:gap-2"><ShieldCheck className="w-3 h-3 sm:w-4 sm:h-4" /> J.A.R.V.I.S.</h1>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-1.5 sm:p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-md active:scale-95 transition-transform">
          {isMobileMenuOpen ? <X className="w-4 h-4 sm:w-5 sm:h-5" /> : <Menu className="w-4 h-4 sm:w-5 sm:h-5" />}
        </button>
      </div>

      <div className="relative z-10 flex flex-col lg:flex-row h-full w-full p-2 sm:p-4 lg:p-6 gap-2 sm:gap-4 lg:gap-6 pt-12 sm:pt-16 lg:pt-6 overflow-hidden landscape-compact">
        
        {/* Left Sidebar - Stats & Files */}
        <div className={`flex-col w-full lg:w-72 xl:w-80 gap-2 sm:gap-4 transition-all duration-500 ${isMobileMenuOpen ? 'flex absolute inset-0 bg-slate-950/98 z-40 p-4 sm:p-6 pt-16 sm:pt-20 overflow-y-auto' : (!showStats && !isMobileMenuOpen) ? 'hidden' : 'hidden lg:flex'}`}>
          <div className="bg-slate-900/40 border border-cyan-500/30 rounded-lg p-3 sm:p-4 backdrop-blur-md shadow-lg shadow-cyan-500/10">
            <h2 className="font-orbitron text-xs sm:text-sm mb-3 sm:mb-4 flex items-center justify-between text-glow">
              <span className="flex items-center gap-1.5 sm:gap-2"><ShieldCheck className="w-3 h-3 sm:w-4 sm:h-4" /> CORE STATUS</span>
              <Activity className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-cyan-600 animate-pulse" />
            </h2>
            <div className="space-y-3 sm:space-y-4">
              <StatRow icon={<Cpu className="w-3 h-3 sm:w-4 sm:h-4"/>} label="PROCESSOR" value={Math.round(stats.cpu)} unit="%" />
              <StatRow icon={<Database className="w-3 h-3 sm:w-4 sm:h-4"/>} label="NEURAL LOAD" value={Math.round(stats.memory)} unit="%" />
              <StatRow icon={<Wind className="w-3 h-3 sm:w-4 sm:h-4"/>} label="DATA UPLINK" value={Math.round(stats.network)} unit="MB/s" />
              <StatRow icon={<Battery className={`w-3 h-3 sm:w-4 sm:h-4 ${batteryLevel && batteryLevel < 20 ? 'text-red-500 animate-pulse' : ''}`}/>} label="ARC REACTOR" value={batteryLevel || 0} unit="%" />
            </div>
          </div>
          
          <div className="bg-slate-900/40 border border-cyan-500/30 rounded-lg p-3 sm:p-4 backdrop-blur-md flex-1 min-h-[120px] sm:min-h-[150px] overflow-hidden flex flex-col">
            <h2 className="font-orbitron text-xs sm:text-sm mb-2 flex items-center gap-1.5 sm:gap-2 text-glow"><Terminal className="w-3 h-3 sm:w-4 sm:h-4" /> LOCAL_FILES_SYNC</h2>
            <div className="flex-1 overflow-y-auto space-y-1.5 sm:space-y-2 mb-2 pr-1 scrollbar-hide">
              {attachedFiles.length === 0 ? (
                <p className="text-[9px] sm:text-[10px] text-cyan-900 italic">No files in buffer...</p>
              ) : (
                attachedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 sm:gap-2 p-1 sm:p-1.5 border border-cyan-500/10 rounded bg-cyan-500/5">
                    <FileCode className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-cyan-400 shrink-0" />
                    <span className="text-[9px] sm:text-[10px] truncate flex-1">{f.name}</span>
                    <span className="text-[7px] sm:text-[8px] opacity-40 uppercase">{Math.round(f.size/1024)}KB</span>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => fileInputRef.current?.click()} className="mt-auto py-2 sm:py-3 lg:py-2 border border-dashed border-cyan-500/30 rounded text-[9px] sm:text-[10px] font-orbitron flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-cyan-500/10 active:bg-cyan-500/20 transition-colors">
              <Upload className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> ACCESS STORAGE
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple className="hidden" />
          </div>
        </div>

        {/* Central Display Area */}
        <div className="flex-1 relative flex items-center justify-center min-h-0 py-2 sm:py-4 lg:py-0">
          
          {/* Unified Co-Centered Container - shifted up */}
          <div className="relative w-full h-full flex items-center justify-center overflow-visible" style={{ marginTop: '-8%' }}>
            
            {/* Background HUD Graphics - Responsive sizing */}
            <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none z-0 overflow-visible">
               <div className={`absolute w-[60vmin] sm:w-[65vmin] lg:w-[70vmin] h-[60vmin] sm:h-[65vmin] lg:h-[70vmin] border border-cyan-500/10 rounded-full animate-[spin_180s_linear_infinite]`}></div>
               <div className={`absolute w-[50vmin] sm:w-[54vmin] lg:w-[58vmin] h-[50vmin] sm:h-[54vmin] lg:h-[58vmin] border-2 rounded-full animate-[spin_60s_linear_infinite] border-dashed transition-colors duration-500 ${systemAlert ? 'border-red-500' : 'border-cyan-500'}`}></div>
               <div className={`absolute w-[40vmin] sm:w-[43vmin] lg:w-[46vmin] h-[40vmin] sm:h-[43vmin] lg:h-[46vmin] border rounded-full animate-[spin_40s_linear_infinite_reverse] transition-colors duration-500 ${systemAlert ? 'border-red-400' : 'border-cyan-400'}`}></div>
               <div className={`absolute w-[30vmin] sm:w-[32vmin] lg:w-[34vmin] h-[30vmin] sm:h-[32vmin] lg:h-[34vmin] border border-cyan-500/5 rounded-full animate-[pulse_4s_ease-in-out_infinite]`}></div>
            </div>

            {/* Core Visualizer Component - Responsive sizing */}
            <div className="relative w-[24vmin] sm:w-[26vmin] lg:w-[28vmin] h-[24vmin] sm:h-[26vmin] lg:h-[28vmin] min-w-[100px] sm:min-w-[120px] min-h-[100px] sm:min-h-[120px] max-w-[200px] sm:max-w-[240px] lg:max-w-[280px] max-h-[200px] sm:max-h-[240px] lg:max-h-[280px] flex items-center justify-center z-10 overflow-visible">
               {/* Canvas for audio visualization - larger to show full circular animation */}
               <canvas ref={canvasRef} width={500} height={500} className="absolute w-[200%] h-[200%] pointer-events-none z-10 opacity-80" style={{ left: '-50%', top: '-50%' }} />
               
               {/* Dynamic Glow Layer */}
               <div className={`absolute w-[110%] h-[110%] rounded-full transition-all duration-300 ${isVoiceActive ? 'bg-green-500/20 scale-125 blur-2xl sm:blur-3xl' : (isAudioDetected || systemAlert) ? 'bg-cyan-500/30 scale-125 blur-2xl sm:blur-3xl' : 'bg-transparent'}`}></div>
               
               {/* Main Zap Icon Hub - Clickable to Initialize */}
               <button 
                 onClick={isVoiceActive ? deactivateVoice : activateVoice}
                 disabled={status === ConnectionStatus.CONNECTING}
                 className={`w-[44%] h-[44%] min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center transition-all duration-500 shadow-xl sm:shadow-2xl relative z-20 cursor-pointer active:scale-95 ${isVoiceActive ? 'bg-green-500 shadow-[0_0_30px_rgba(34,197,94,1)] sm:shadow-[0_0_60px_rgba(34,197,94,1)] scale-110 border-2 border-green-300' : systemAlert ? 'bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.6)] sm:shadow-[0_0_40px_rgba(239,68,68,0.6)] border border-red-400' : isAudioDetected ? 'bg-cyan-600 shadow-[0_0_20px_rgba(6,182,212,0.8)] sm:shadow-[0_0_40px_rgba(6,182,212,0.8)] scale-105 border border-cyan-300' : 'bg-slate-900 border border-cyan-500/30 hover:bg-slate-800 hover:border-cyan-400/50'} ${status === ConnectionStatus.CONNECTING ? 'opacity-50 cursor-wait' : ''}`}
               >
                  <Zap className={`w-1/2 h-1/2 transition-colors duration-500 ${isVoiceActive ? 'text-white' : 'text-cyan-800'}`} />
                  {isVoiceActive && <div className="absolute inset-0 flex items-center justify-center"><div className="w-full h-full border-2 border-green-400 rounded-full animate-ping opacity-20"></div></div>}
               </button>

               {/* Status Badge - Responsive positioning - moved further down */}
               <div className="absolute top-[160%] sm:top-[170%] lg:top-[180%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 sm:gap-4 lg:gap-5 w-full px-2">
                  <div className={`px-3 sm:px-4 lg:px-5 py-1.5 sm:py-2 lg:py-2.5 rounded-full text-[8px] sm:text-[9px] lg:text-[11px] font-orbitron border transition-all duration-500 flex items-center gap-1.5 sm:gap-2 tracking-[0.1em] sm:tracking-[0.15em] lg:tracking-[0.2em] whitespace-nowrap bg-black/70 backdrop-blur-md shadow-lg sm:shadow-2xl ${status === ConnectionStatus.CONNECTED ? 'border-green-500 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.4)] sm:shadow-[0_0_20px_rgba(34,197,94,0.4)]' : status === ConnectionStatus.CONNECTING ? 'border-yellow-500 text-yellow-400 animate-pulse' : systemAlert ? 'border-red-500 text-red-400 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.4)] sm:shadow-[0_0_20px_rgba(239,68,68,0.4)]' : isWakeWordListening ? 'border-cyan-500/50 text-cyan-300' : 'border-slate-500/50 text-slate-500'}`}>
                    <div className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-400 animate-ping' : 'bg-current'}`}></div>
                    <span className="hidden xs:inline">{isVoiceActive ? 'UPLINK SECURED' : status === ConnectionStatus.CONNECTING ? 'CONNECTING...' : systemAlert ? 'SYSTEM_OVERRIDE' : isWakeWordListening ? 'LISTENING: "HELLO JARVIS"' : 'ACOUSTICS ACTIVE'}</span>
                    <span className="xs:hidden">{isVoiceActive ? 'ACTIVE' : status === ConnectionStatus.CONNECTING ? 'CONNECTING' : systemAlert ? 'ALERT' : isWakeWordListening ? 'LISTENING' : 'READY'}</span>
                  </div>
                  <div className="flex gap-2 sm:gap-4 lg:gap-6 items-center">
                     <div className="text-[7px] sm:text-[8px] lg:text-[10px] text-cyan-800 flex items-center gap-1 sm:gap-1.5 font-orbitron uppercase tracking-wider sm:tracking-widest"><MapPin className="w-2 h-2 sm:w-2.5 sm:h-2.5 lg:w-3 lg:h-3" /> <span className="hidden sm:inline">GPS_LOCKED</span><span className="sm:hidden">GPS</span></div>
                    <div className="h-3 sm:h-4 w-[1px] bg-cyan-500/10"></div>
                    <button onClick={() => { shouldRestartRecognition.current = true; startWakeWordDetection(); }} className="text-[7px] sm:text-[8px] lg:text-[10px] text-cyan-900 hover:text-cyan-400 active:text-cyan-300 transition-colors flex items-center gap-1 sm:gap-1.5 font-orbitron tracking-tight sm:tracking-tighter"><RefreshCw className="w-2 h-2 sm:w-2.5 sm:h-2.5 lg:w-3 lg:h-3" /> <span className="hidden sm:inline">RESET_TRIGGER</span><span className="sm:hidden">RESET</span></button>
                  </div>
               </div>
            </div>

          </div>
        </div>

        {/* Control & Log Panel */}
        <div className={`w-full lg:w-72 xl:w-80 flex flex-col gap-2 sm:gap-4 transition-all duration-500 ${isMobileMenuOpen ? 'hidden' : (!showLogs && !isMobileMenuOpen) ? 'hidden' : 'flex'}`}>
          <div className="bg-slate-900/40 border border-cyan-500/30 rounded-lg h-36 sm:h-44 lg:h-auto lg:flex-1 backdrop-blur-md flex flex-col overflow-hidden shadow-xl">
            <div className="p-2 sm:p-3 border-b border-cyan-500/20 bg-cyan-500/5 flex justify-between items-center">
              <h2 className="font-orbitron text-[9px] sm:text-[10px] lg:text-xs flex items-center gap-1.5 sm:gap-2 text-glow uppercase tracking-wider"><MessageSquare className="w-3 h-3 sm:w-4 sm:h-4 text-cyan-400" /> System_Logs</h2>
              <span className="text-[7px] sm:text-[8px] lg:text-[10px] font-mono opacity-40">UTC-OS4.5</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 space-y-2 sm:space-y-3 lg:space-y-4 font-mono text-[8px] sm:text-[9px] lg:text-[10px] opacity-70 scrollbar-hide">
              <div className="space-y-1.5 sm:space-y-2">
                {/* Live Status Indicators */}
                {status === ConnectionStatus.CONNECTING && (
                  <div className="p-1.5 sm:p-2 border border-yellow-500/30 bg-yellow-500/10 rounded animate-pulse">
                     <p className="text-[7px] sm:text-[8px] text-yellow-500 font-orbitron uppercase tracking-wider">⚡ Establishing Neural Link...</p>
                  </div>
                )}
                {isVoiceActive && (
                  <div className="p-1.5 sm:p-2 border border-green-500/30 bg-green-500/10 rounded">
                     <p className="text-[7px] sm:text-[8px] text-green-400 font-orbitron uppercase tracking-wider flex items-center gap-1">
                       <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span> Voice Uplink Active
                     </p>
                  </div>
                )}
                {isWakeWordListening && !isVoiceActive && (
                  <div className="p-1.5 sm:p-2 border border-cyan-500/20 bg-cyan-500/5 rounded animate-pulse">
                     <p className="text-[7px] sm:text-[8px] text-cyan-600 mb-0.5 sm:mb-1 font-orbitron uppercase tracking-wider sm:tracking-widest">Neural Monitor:</p>
                     <p className="text-cyan-400 italic text-[8px] sm:text-[9px]">"{standbyTranscript || 'Listening for wake word...'}"</p>
                  </div>
                )}
                {/* System Status */}
                <p className="text-cyan-600 italic">[{new Date().toLocaleTimeString()}] System: {isVoiceActive ? 'Voice Mode Active' : status === ConnectionStatus.CONNECTING ? 'Connecting...' : 'Standby'}</p>
                {/* Message History - Show more messages */}
                {messages.slice(-8).map(m => (
                  <p key={m.id} className={`${m.role === 'user' ? 'text-cyan-300' : m.content.includes('[ERROR]') ? 'text-red-400' : m.content.includes('[SYSTEM]') ? 'text-yellow-400' : 'text-slate-100'} whitespace-pre-wrap break-words`}>
                    [{new Date(m.timestamp).toLocaleTimeString()}] {m.role.toUpperCase()}: {m.content}
                  </p>
                ))}
              </div>
            </div>
            <form onSubmit={handleSendText} className="p-1.5 sm:p-2 lg:p-3 border-t border-cyan-500/20 flex gap-1.5 sm:gap-2 bg-black/40">
              <input 
                value={inputText} 
                onChange={(e) => setInputText(e.target.value)} 
                placeholder="Manual Override..." 
                className="bg-black/60 border border-cyan-500/20 rounded-md px-2 sm:px-3 py-1.5 sm:py-2 text-[9px] sm:text-[10px] lg:text-xs focus:outline-none focus:border-cyan-400/50 flex-1 placeholder:text-cyan-950 text-cyan-100 font-mono min-w-0" 
              />
              <button type="submit" className="p-1.5 sm:p-2 bg-cyan-500/10 border border-cyan-500/40 rounded-md hover:bg-cyan-500/20 hover:border-cyan-400 transition-all active:scale-95 shrink-0">
                <Power className="w-3 h-3 sm:w-4 sm:h-4 text-cyan-400" />
              </button>
            </form>
          </div>

          <button 
            disabled={status === ConnectionStatus.CONNECTING}
            onClick={isVoiceActive ? deactivateVoice : activateVoice} 
            className={`w-full py-3 sm:py-4 lg:py-5 rounded-lg sm:rounded-xl font-orbitron flex items-center justify-center gap-2 sm:gap-3 lg:gap-4 transition-all duration-500 shadow-xl sm:shadow-2xl relative overflow-hidden group border-2 ${isVoiceActive ? 'bg-green-600/80 border-green-400 text-white shadow-[0_0_20px_rgba(34,197,94,0.5)] sm:shadow-[0_0_40px_rgba(34,197,94,0.5)] scale-[1.01] sm:scale-[1.02] lg:scale-[1.05]' : 'bg-cyan-900/30 border-cyan-400/50 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400 active:bg-cyan-500/30'} ${status === ConnectionStatus.CONNECTING ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isVoiceActive ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 animate-pulse" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 group-hover:scale-125 transition-transform" />}
            <span className="tracking-[0.15em] sm:tracking-[0.2em] lg:tracking-[0.3em] text-[10px] sm:text-xs lg:text-sm font-bold uppercase">{isVoiceActive ? 'TERMINATE' : status === ConnectionStatus.CONNECTING ? 'UPLINKING...' : 'INITIALIZE'}</span>
            {isVoiceActive && <div className="absolute inset-0 bg-white/10 animate-ping pointer-events-none"></div>}
          </button>
        </div>
      </div>
    </div>
  );
};

const StatRow: React.FC<{ icon: React.ReactNode, label: string, value: number, unit: string }> = ({ icon, label, value, unit }) => (
  <div className="flex items-center gap-2 sm:gap-3 group">
    <div className="p-1.5 sm:p-2 bg-cyan-900/20 rounded-md sm:rounded-lg border border-cyan-500/20 group-hover:border-cyan-400/50 transition-colors duration-300 shadow-inner">{icon}</div>
    <div className="flex-1 min-w-0">
      <div className="flex justify-between text-[9px] sm:text-[10px] font-orbitron mb-1 sm:mb-1.5 tracking-tighter">
        <span className="text-cyan-500/60 uppercase truncate">{label}</span>
        <span className="text-cyan-300 font-bold ml-1">{Math.round(value)}{unit}</span>
      </div>
      <div className="h-1 sm:h-1.5 bg-slate-800/80 rounded-full overflow-hidden border border-white/5">
        <div className={`h-full transition-all duration-700 shadow-[0_0_10px_rgba(6,182,212,0.8)] ${value < 20 ? 'bg-red-500' : 'bg-cyan-500'}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  </div>
);

export default App;
