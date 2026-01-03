// Tavily Research Service
// Provides deep research and content extraction capabilities

export interface ResearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export interface ResearchResponse {
  success: boolean;
  query: string;
  answer?: string;
  results: ResearchResult[];
  follow_up_questions?: string[];
  error?: string;
}

export interface ExtractResponse {
  success: boolean;
  url: string;
  content?: string;
  title?: string;
  error?: string;
}

export class ResearchService {
  private apiKey: string;
  private baseUrl = 'https://api.tavily.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async research(query: string, options?: {
    search_depth?: 'basic' | 'advanced';
    include_answer?: boolean;
    include_raw_content?: boolean;
    max_results?: number;
    include_domains?: string[];
    exclude_domains?: string[];
    topic?: 'general' | 'news' | 'finance';
  }): Promise<ResearchResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: options?.search_depth || 'advanced',
          include_answer: options?.include_answer ?? true,
          include_raw_content: options?.include_raw_content ?? false,
          max_results: options?.max_results || 10,
          include_domains: options?.include_domains || [],
          exclude_domains: options?.exclude_domains || [],
          topic: options?.topic || 'general'
        })
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status}`);
      }

      const data = await response.json();

      const results: ResearchResult[] = (data.results || []).map((result: any) => ({
        title: result.title || '',
        url: result.url || '',
        content: result.content || '',
        score: result.score || 0,
        published_date: result.published_date
      }));

      return {
        success: true,
        query,
        answer: data.answer,
        results,
        follow_up_questions: data.follow_up_questions
      };
    } catch (error) {
      console.error('Research Error:', error);
      return {
        success: false,
        query,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown research error'
      };
    }
  }

  async researchNews(query: string, options?: { max_results?: number }): Promise<ResearchResponse> {
    return this.research(query, {
      ...options,
      topic: 'news',
      search_depth: 'advanced',
      include_answer: true
    });
  }

  async researchFinance(query: string, options?: { max_results?: number }): Promise<ResearchResponse> {
    return this.research(query, {
      ...options,
      topic: 'finance',
      search_depth: 'advanced',
      include_answer: true,
      include_domains: ['bloomberg.com', 'reuters.com', 'ft.com', 'wsj.com', 'cnbc.com', 'marketwatch.com', 'investing.com', 'tradingview.com']
    });
  }

  async extractContent(url: string): Promise<ExtractResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          urls: [url]
        })
      });

      if (!response.ok) {
        throw new Error(`Tavily Extract error: ${response.status}`);
      }

      const data = await response.json();
      const result = data.results?.[0];

      return {
        success: true,
        url,
        content: result?.raw_content || result?.content,
        title: result?.title
      };
    } catch (error) {
      console.error('Content Extraction Error:', error);
      return {
        success: false,
        url,
        error: error instanceof Error ? error.message : 'Unknown extraction error'
      };
    }
  }
}

// Factory function
export function createResearchService(): ResearchService | null {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('TAVILY_API_KEY not configured');
    return null;
  }
  return new ResearchService(apiKey);
}
