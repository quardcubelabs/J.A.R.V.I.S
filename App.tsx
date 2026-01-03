
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
  X 
} from 'lucide-react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob as GenAIBlob, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionStatus, Message, SystemStats } from './types';
import { encode, decode, decodeAudioData, downsample } from './utils/audioHelpers';
import { createAIService } from './utils/aiService';

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

// Define function declaration for assistant deactivation
const deactivateAssistantFunctionDeclaration: FunctionDeclaration = {
  name: 'deactivate_assistant',
  description: 'Deactivates the assistant and puts it into standby mode.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

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

  // --- Helpers ---

  const getDynamicSystemInstruction = useCallback(() => {
    const now = new Date();
    const batteryStr = batteryLevel !== null ? `${Math.round(batteryLevel)}%` : "Unknown";
    const fileList = attachedFiles.map(f => `- ${f.name} (${f.type}, ${Math.round(f.size/1024)}KB)`).join('\n');
    return `You are J.A.R.V.I.S., Tony Stark's AI assistant. You are sophisticated, British, and polite. Address user as 'Framan'. Current Power: ${batteryStr}, Time: ${now.toLocaleTimeString()}, Files: ${fileList || "None"}. Important Protocol: If the user says "thanks bye", say a very brief, polite farewell and acknowledge that you are entering standby mode.`;
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
    
    // Clear any leftover transcripts
    setStandbyTranscript('');
    
    // Resume listening strictly for activation phrase
    startWakeWordDetection();
  }, []);

  const startWakeWordDetection = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsWakeWordSupported(false);
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsWakeWordListening(true);
      console.log("Acoustic trigger active: Monitoring for 'Hello JARVIS'...");
    };

    recognition.onresult = (event: any) => {
      setIsAudioDetected(true);
      
      // We look at the most recent segments to detect the wake word reliably
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        setStandbyTranscript(transcript);

        // Check for the specific activation word "hello jarvis"
        if (transcript.includes('hello jarvis') || transcript.includes('hello jarvis.')) {
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
      if (e.error === 'not-allowed') {
        setSystemAlert("Microphone access denied for SpeechRecognition.");
      }
      setIsWakeWordListening(false);
    };

    recognition.onend = () => {
      setIsWakeWordListening(false);
      setIsAudioDetected(false);
      // Continuous restart unless we are transitioning to active mode
      if (shouldRestartRecognition.current && !isSessionActiveRef.current) {
        setTimeout(() => {
           if (shouldRestartRecognition.current && !isSessionActiveRef.current) {
             try { recognition.start(); } catch(e) {}
           }
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch (e) { 
      console.error("SpeechRecognition failed to start:", e); 
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
        if (fc.name === 'deactivate_assistant') {
          setTimeout(deactivateVoice, 1000);
          result = { confirmation: "Standby sequence initialized." };
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
    
    setStatus(ConnectionStatus.CONNECTING);
    isSessionActiveRef.current = true;

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
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
      }

      if (audioContextRef.current) await audioContextRef.current.close().catch(() => {});
      if (inputAudioContextRef.current) await inputAudioContextRef.current.close().catch(() => {});
      
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outCtx;
      const outAnalyser = outCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outAnalyser.connect(outCtx.destination);
      outputAnalyserRef.current = outAnalyser;
      
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      inputAudioContextRef.current = inCtx;
      const inAnalyser = inCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;
      
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const stream = streamRef.current;
      
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: getDynamicSystemInstruction(),
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          tools: [{functionDeclarations: [deactivateAssistantFunctionDeclaration]}],
        },
        callbacks: {
          onopen: () => {
            if (!isSessionActiveRef.current) return;
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
    } catch (err) { 
      console.error("Core initialization failed.", err); 
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
      const baseRadius = canvas.width * 0.35;
      const colorRGB = isVoiceActive ? '34, 197, 94' : '6, 182, 212';
      const scaleFactor = 1 + (activeLevel / 128);

      ctx.beginPath();
      ctx.strokeStyle = `rgba(${colorRGB}, 0.5)`;
      ctx.lineWidth = 2;

      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i] / 255.0;
        const angle = (i / bufferLength) * Math.PI * 2;
        const xStart = centerX + Math.cos(angle) * (baseRadius * 0.9);
        const yStart = centerY + Math.sin(angle) * (baseRadius * 0.9);
        const xEnd = centerX + Math.cos(angle) * (baseRadius + value * 60 * scaleFactor);
        const yEnd = centerY + Math.sin(angle) * (baseRadius + value * 60 * scaleFactor);
        
        if (Number.isFinite(xStart) && Number.isFinite(yStart) && Number.isFinite(xEnd) && Number.isFinite(yEnd)) {
          ctx.moveTo(xStart, yStart);
          ctx.lineTo(xEnd, yEnd);
        }
      }
      ctx.stroke();

      try {
        const radiusInner = Math.max(0.1, baseRadius * 0.5);
        const radiusOuter = Math.max(radiusInner + 1, baseRadius * scaleFactor);
        const grd = ctx.createRadialGradient(centerX, centerY, radiusInner, centerX, centerY, radiusOuter);
        grd.addColorStop(0, `rgba(${colorRGB}, 0)`);
        grd.addColorStop(1, `rgba(${colorRGB}, 0.1)`);
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
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        startWakeWordDetection();
      } catch (err) { console.warn("Mic access denied"); }
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
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-50 flex items-center justify-center">
           <div className="bg-red-600/20 border-y-2 border-red-500 w-full py-4 text-center animate-pulse">
             <span className="font-orbitron text-red-500 tracking-[0.5em] text-xs lg:text-sm uppercase tracking-widest">CRITICAL ALERT: {systemAlert}</span>
           </div>
        </div>
      )}

      <div className="lg:hidden absolute top-0 left-0 w-full p-4 flex justify-between items-center z-50">
        <h1 className="font-orbitron text-sm tracking-widest text-glow flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> J.A.R.V.I.S.</h1>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-md">
          {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <div className="relative z-10 flex flex-col lg:flex-row h-full w-full p-4 lg:p-6 gap-4 lg:gap-6 pt-16 lg:pt-6 overflow-hidden">
        
        <div className={`flex-col w-full lg:w-72 gap-4 transition-all duration-500 ${isMobileMenuOpen ? 'flex absolute inset-0 bg-slate-950/95 z-40 p-6 pt-20' : (!showStats && !isMobileMenuOpen) ? 'hidden' : 'hidden lg:flex'}`}>
          <div className="bg-slate-900/40 border border-cyan-500/30 rounded-lg p-4 backdrop-blur-md shadow-lg shadow-cyan-500/10">
            <h2 className="font-orbitron text-sm mb-4 flex items-center justify-between text-glow">
              <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> CORE STATUS</span>
              <Activity className="w-3 h-3 text-cyan-600 animate-pulse" />
            </h2>
            <div className="space-y-4">
              <StatRow icon={<Cpu className="w-4 h-4"/>} label="PROCESSOR" value={Math.round(stats.cpu)} unit="%" />
              <StatRow icon={<Database className="w-4 h-4"/>} label="NEURAL LOAD" value={Math.round(stats.memory)} unit="%" />
              <StatRow icon={<Wind className="w-4 h-4"/>} label="DATA UPLINK" value={Math.round(stats.network)} unit="MB/s" />
              <StatRow icon={<Battery className={`w-4 h-4 ${batteryLevel && batteryLevel < 20 ? 'text-red-500 animate-pulse' : ''}`}/>} label="ARC REACTOR" value={batteryLevel || 0} unit="%" />
            </div>
          </div>
          
          <div className="bg-slate-900/40 border border-cyan-500/30 rounded-lg p-4 backdrop-blur-md flex-1 overflow-hidden flex flex-col">
            <h2 className="font-orbitron text-sm mb-2 flex items-center gap-2 text-glow"><Terminal className="w-4 h-4" /> LOCAL_FILES_SYNC</h2>
            <div className="flex-1 overflow-y-auto space-y-2 mb-2 pr-1 scrollbar-hide">
              {attachedFiles.length === 0 ? (
                <p className="text-[10px] text-cyan-900 italic">No files in buffer...</p>
              ) : (
                attachedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 p-1.5 border border-cyan-500/10 rounded bg-cyan-500/5">
                    <FileCode className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span className="text-[10px] truncate flex-1">{f.name}</span>
                    <span className="text-[8px] opacity-40 uppercase">{Math.round(f.size/1024)}KB</span>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => fileInputRef.current?.click()} className="mt-auto py-3 lg:py-2 border border-dashed border-cyan-500/30 rounded text-[10px] font-orbitron flex items-center justify-center gap-2 hover:bg-cyan-500/10 transition-colors">
              <Upload className="w-3 h-3" /> ACCESS STORAGE
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple className="hidden" />
          </div>
        </div>

        {/* Central Display Area: Refined sizing for better mobile focal point and spacing */}
        <div className="flex-1 relative flex items-center justify-center min-h-0 py-4 lg:py-0">
          
          {/* Unified Co-Centered Container */}
          <div className="relative w-full h-full flex items-center justify-center">
            
            {/* Background HUD Graphics - Rescaled to pull inwards and give breathing room to labels */}
            <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none z-0 overflow-visible">
               <div className={`absolute w-[70vmin] h-[70vmin] border border-cyan-500/10 rounded-full animate-[spin_180s_linear_infinite]`}></div>
               <div className={`absolute w-[58vmin] h-[58vmin] border-2 rounded-full animate-[spin_60s_linear_infinite] border-dashed transition-colors duration-500 ${systemAlert ? 'border-red-500' : 'border-cyan-500'}`}></div>
               <div className={`absolute w-[46vmin] h-[46vmin] border rounded-full animate-[spin_40s_linear_infinite_reverse] transition-colors duration-500 ${systemAlert ? 'border-red-400' : 'border-cyan-400'}`}></div>
               <div className={`absolute w-[34vmin] h-[34vmin] border border-cyan-500/5 rounded-full animate-[pulse_4s_ease-in-out_infinite]`}></div>
            </div>

            {/* Core Visualizer Component - Rescaled to remain proportional to the new ring sizes */}
            <div className="relative w-[28vmin] h-[28vmin] min-w-[130px] min-h-[130px] max-w-[280px] max-h-[280px] flex items-center justify-center z-10">
               <canvas ref={canvasRef} width={500} height={500} className="absolute inset-0 w-full h-full pointer-events-none z-10 opacity-80" />
               
               {/* Dynamic Glow Layer */}
               <div className={`absolute w-[110%] h-[110%] rounded-full transition-all duration-300 ${isVoiceActive ? 'bg-green-500/20 scale-125 blur-3xl' : (isAudioDetected || systemAlert) ? 'bg-cyan-500/30 scale-125 blur-3xl' : 'bg-transparent'}`}></div>
               
               {/* Main Zap Icon Hub */}
               <div className={`w-[44%] h-[44%] rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl relative z-20 ${isVoiceActive ? 'bg-green-500 shadow-[0_0_60px_rgba(34,197,94,1)] scale-110 border-2 border-green-300' : systemAlert ? 'bg-red-600 shadow-[0_0_40px_rgba(239,68,68,0.6)] border border-red-400' : isAudioDetected ? 'bg-cyan-600 shadow-[0_0_40px_rgba(6,182,212,0.8)] scale-105 border border-cyan-300' : 'bg-slate-900 border border-cyan-500/30'}`}>
                  <Zap className={`w-1/2 h-1/2 transition-colors duration-500 ${isVoiceActive ? 'text-white' : 'text-cyan-800'}`} />
                  {isVoiceActive && <div className="absolute inset-0 flex items-center justify-center"><div className="w-full h-full border-2 border-green-400 rounded-full animate-ping opacity-20"></div></div>}
               </div>

               {/* Status Badge - Pushed further down to ensure it clears the HUD graphics and creates a clean layout */}
               <div className="absolute top-[150%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-5 w-full">
                  <div className={`px-5 py-2.5 rounded-full text-[10px] lg:text-[11px] font-orbitron border transition-all duration-500 flex items-center gap-2 tracking-[0.2em] whitespace-nowrap bg-black/70 backdrop-blur-md shadow-2xl ${status === ConnectionStatus.CONNECTED ? 'border-green-500 text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.4)]' : status === ConnectionStatus.CONNECTING ? 'border-yellow-500 text-yellow-400 animate-pulse' : systemAlert ? 'border-red-500 text-red-400 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.4)]' : isWakeWordListening ? 'border-cyan-500/50 text-cyan-300' : 'border-slate-500/50 text-slate-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-400 animate-ping' : 'bg-current'}`}></div>
                    {isVoiceActive ? 'UPLINK SECURED' : systemAlert ? 'SYSTEM_OVERRIDE' : isWakeWordListening ? (isWakeWordSupported ? 'LISTENING: "HELLO JARVIS"' : 'MIC ACTIVE') : 'CORE IN STANDBY'}
                  </div>
                  <div className="flex gap-4 lg:gap-6 items-center">
                     <div className="text-[8px] lg:text-[10px] text-cyan-800 flex items-center gap-1.5 font-orbitron uppercase tracking-widest"><MapPin className="w-2.5 h-2.5 lg:w-3 lg:h-3" /> GPS_LOCKED</div>
                    <div className="h-4 w-[1px] bg-cyan-500/10"></div>
                    <button onClick={() => { shouldRestartRecognition.current = true; startWakeWordDetection(); }} className="text-[8px] lg:text-[10px] text-cyan-900 hover:text-cyan-400 transition-colors flex items-center gap-1.5 font-orbitron tracking-tighter"><RefreshCw className="w-2.5 h-2.5 lg:w-3 lg:h-3" /> RESET_TRIGGER</button>
                  </div>
               </div>
            </div>

          </div>
        </div>

        {/* Control & Log Panel */}
        <div className={`w-full lg:w-80 flex flex-col gap-4 transition-all duration-500 ${isMobileMenuOpen ? 'hidden' : (!showLogs && !isMobileMenuOpen) ? 'hidden' : 'flex'}`}>
          <div className="bg-slate-900/40 border border-cyan-500/30 rounded-lg h-44 lg:h-auto lg:flex-1 backdrop-blur-md flex flex-col overflow-hidden shadow-xl">
            <div className="p-3 border-b border-cyan-500/20 bg-cyan-500/5 flex justify-between items-center">
              <h2 className="font-orbitron text-[10px] lg:text-xs flex items-center gap-2 text-glow uppercase tracking-wider"><MessageSquare className="w-4 h-4 text-cyan-400" /> System_Logs</h2>
              <span className="text-[8px] lg:text-[10px] font-mono opacity-40">UTC-OS4.5</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 lg:p-4 space-y-3 lg:space-y-4 font-mono text-[9px] lg:text-[10px] opacity-70 scrollbar-hide">
              <div className="space-y-2">
                {isWakeWordListening && (
                  <div className="p-2 border border-cyan-500/20 bg-cyan-500/5 rounded animate-pulse">
                     <p className="text-[8px] text-cyan-600 mb-1 font-orbitron uppercase tracking-widest">Neural Monitor (Hearing...):</p>
                     <p className="text-cyan-400 italic">"{standbyTranscript || 'Waiting for voice...'}"</p>
                  </div>
                )}
                <p className="text-cyan-600 italic">[{new Date().toLocaleTimeString()}] System: Acoustic trigger active.</p>
                {messages.slice(-5).map(m => (
                  <p key={m.id} className={`${m.role === 'user' ? 'text-cyan-300' : 'text-slate-100'} whitespace-pre-wrap`}>
                    [{new Date(m.timestamp).toLocaleTimeString()}] {m.role.toUpperCase()}: {m.content}
                  </p>
                ))}
              </div>
            </div>
            <form onSubmit={handleSendText} className="p-2 lg:p-3 border-t border-cyan-500/20 flex gap-2 bg-black/40">
              <input 
                value={inputText} 
                onChange={(e) => setInputText(e.target.value)} 
                placeholder="Manual Override..." 
                className="bg-black/60 border border-cyan-500/20 rounded-md px-3 py-2 text-[10px] lg:text-xs focus:outline-none focus:border-cyan-400/50 flex-1 placeholder:text-cyan-950 text-cyan-100 font-mono" 
              />
              <button type="submit" className="p-2 bg-cyan-500/10 border border-cyan-500/40 rounded-md hover:bg-cyan-500/20 hover:border-cyan-400 transition-all active:scale-95">
                <Power className="w-4 h-4 text-cyan-400" />
              </button>
            </form>
          </div>

          <button 
            disabled={status === ConnectionStatus.CONNECTING}
            onClick={isVoiceActive ? deactivateVoice : activateVoice} 
            className={`w-full py-4 lg:py-5 rounded-xl font-orbitron flex items-center justify-center gap-4 transition-all duration-500 shadow-2xl relative overflow-hidden group border-2 ${isVoiceActive ? 'bg-green-600/80 border-green-400 text-white shadow-[0_0_40px_rgba(34,197,94,0.5)] scale-[1.02] lg:scale-[1.05]' : 'bg-cyan-900/30 border-cyan-400/50 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400'} ${status === ConnectionStatus.CONNECTING ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isVoiceActive ? <MicOff className="w-5 h-5 lg:w-6 lg:h-6 animate-pulse" /> : <Mic className="w-5 h-5 lg:w-6 lg:h-6 group-hover:scale-125 transition-transform" />}
            <span className="tracking-[0.2em] lg:tracking-[0.3em] text-xs lg:text-sm font-bold uppercase">{isVoiceActive ? 'TERMINATE' : status === ConnectionStatus.CONNECTING ? 'UPLINKING...' : 'INITIALIZE'}</span>
            {isVoiceActive && <div className="absolute inset-0 bg-white/10 animate-ping pointer-events-none"></div>}
          </button>
        </div>
      </div>
    </div>
  );
};

const StatRow: React.FC<{ icon: React.ReactNode, label: string, value: number, unit: string }> = ({ icon, label, value, unit }) => (
  <div className="flex items-center gap-3 group">
    <div className="p-2 bg-cyan-900/20 rounded-lg border border-cyan-500/20 group-hover:border-cyan-400/50 transition-colors duration-300 shadow-inner">{icon}</div>
    <div className="flex-1">
      <div className="flex justify-between text-[10px] font-orbitron mb-1.5 tracking-tighter">
        <span className="text-cyan-500/60 uppercase">{label}</span>
        <span className="text-cyan-300 font-bold">{Math.round(value)}{unit}</span>
      </div>
      <div className="h-1.5 bg-slate-800/80 rounded-full overflow-hidden border border-white/5">
        <div className={`h-full transition-all duration-700 shadow-[0_0_10px_rgba(6,182,212,0.8)] ${value < 20 ? 'bg-red-500' : 'bg-cyan-500'}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  </div>
);

export default App;
