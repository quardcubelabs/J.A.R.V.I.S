import { GoogleGenAI } from '@google/genai';

export interface AIResponse {
  text: string;
}

export class LocalAIService {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.model = model;
  }

  async generateText(prompt: string, systemInstruction?: string): Promise<AIResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: systemInstruction ? `${systemInstruction}\n\nUser: ${prompt}` : prompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Local AI service error: ${response.status}`);
      }

      const data = await response.json();
      return { text: data.response || "No response from local AI" };
    } catch (error) {
      console.error('Local AI Service Error:', error);
      throw error;
    }
  }
}

export class GoogleAIService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateText(prompt: string, systemInstruction?: string): Promise<AIResponse> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { 
          systemInstruction,
          tools: [{ googleSearch: {} }] 
        }
      });
      
      return { text: response.text || "No response from Google AI" };
    } catch (error) {
      console.error('Google AI Service Error:', error);
      throw error;
    }
  }
}

export function createAIService(): LocalAIService | GoogleAIService {
  const provider = process.env.AI_PROVIDER || 'local';
  
  if (provider === 'local') {
    const url = process.env.LOCAL_AI_URL || 'http://localhost:11434';
    const model = process.env.LOCAL_AI_MODEL || 'llama3.1';
    return new LocalAIService(url, model);
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for Google AI service');
    }
    return new GoogleAIService(apiKey);
  }
}