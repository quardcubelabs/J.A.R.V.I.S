// SerpAPI Web Search Service
// Provides web surfing and search capabilities

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  answer_box?: {
    title?: string;
    answer?: string;
    snippet?: string;
  };
  knowledge_graph?: {
    title?: string;
    description?: string;
    type?: string;
  };
  error?: string;
}

export class WebSearchService {
  private apiKey: string;
  private baseUrl = 'https://serpapi.com/search.json';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: {
    num?: number;
    location?: string;
    gl?: string;
    hl?: string;
  }): Promise<SearchResponse> {
    try {
      const params = new URLSearchParams({
        api_key: this.apiKey,
        q: query,
        engine: 'google',
        num: (options?.num || 10).toString(),
        gl: options?.gl || 'us',
        hl: options?.hl || 'en',
      });

      if (options?.location) {
        params.append('location', options.location);
      }

      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`SerpAPI error: ${response.status}`);
      }

      const data = await response.json();

      const results: SearchResult[] = (data.organic_results || []).map((result: any, index: number) => ({
        title: result.title || '',
        link: result.link || '',
        snippet: result.snippet || '',
        position: index + 1
      }));

      return {
        success: true,
        query,
        results,
        answer_box: data.answer_box ? {
          title: data.answer_box.title,
          answer: data.answer_box.answer,
          snippet: data.answer_box.snippet
        } : undefined,
        knowledge_graph: data.knowledge_graph ? {
          title: data.knowledge_graph.title,
          description: data.knowledge_graph.description,
          type: data.knowledge_graph.type
        } : undefined
      };
    } catch (error) {
      console.error('Web Search Error:', error);
      return {
        success: false,
        query,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown search error'
      };
    }
  }

  async searchNews(query: string, options?: { num?: number }): Promise<SearchResponse> {
    try {
      const params = new URLSearchParams({
        api_key: this.apiKey,
        q: query,
        engine: 'google_news',
        num: (options?.num || 10).toString(),
      });

      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`SerpAPI News error: ${response.status}`);
      }

      const data = await response.json();

      const results: SearchResult[] = (data.news_results || []).map((result: any, index: number) => ({
        title: result.title || '',
        link: result.link || '',
        snippet: result.snippet || result.source || '',
        position: index + 1
      }));

      return {
        success: true,
        query,
        results
      };
    } catch (error) {
      console.error('News Search Error:', error);
      return {
        success: false,
        query,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown news search error'
      };
    }
  }

  async searchImages(query: string, options?: { num?: number }): Promise<SearchResponse> {
    try {
      const params = new URLSearchParams({
        api_key: this.apiKey,
        q: query,
        engine: 'google_images',
        num: (options?.num || 10).toString(),
      });

      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`SerpAPI Images error: ${response.status}`);
      }

      const data = await response.json();

      const results: SearchResult[] = (data.images_results || []).map((result: any, index: number) => ({
        title: result.title || '',
        link: result.original || result.link || '',
        snippet: result.source || '',
        position: index + 1
      }));

      return {
        success: true,
        query,
        results
      };
    } catch (error) {
      console.error('Image Search Error:', error);
      return {
        success: false,
        query,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown image search error'
      };
    }
  }
}

// Factory function
export function createWebSearchService(): WebSearchService | null {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) {
    console.warn('SERP_API_KEY not configured');
    return null;
  }
  return new WebSearchService(apiKey);
}
