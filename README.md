<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# J.A.R.V.I.S. - AI Trading Assistant

Your sophisticated AI assistant with full trading capabilities on Deriv and MetaTrader 5.

## Features

### 🤖 AI Capabilities
- Voice-activated commands
- Web search and deep research
- Natural language processing with Gemini AI

### 📊 Trading Capabilities

#### Deriv Binary Options
- Real-time account balance
- CALL/PUT contracts
- Digit trading (Over/Under/Match/Differ)
- View open positions
- Trade history

#### MetaTrader 5 (MT5) Integration
- **View MT5 Accounts**: List all connected MT5 accounts
- **Place Orders**: Buy/sell market orders with custom lot sizes
- **Stop Loss & Take Profit**: Set SL/TP when placing orders
- **Manage Positions**: View open positions, modify SL/TP, close positions
- **Multi-Symbol Support**: Forex, Synthetics, Commodities, and more

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your `.env` file:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   DERIV_API_TOKEN=your_deriv_api_token
   SERP_API_KEY=your_serpapi_key
   TAVILY_API_KEY=your_tavily_key
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

## MT5 Trading Setup

1. **Create MT5 Account**: Go to your [Deriv Dashboard](https://app.deriv.com) and create an MT5 account
2. **Get API Token**: Visit [API Token Settings](https://app.deriv.com/account/api-token) and create a token with:
   - Read
   - Trade
   - Trading Information
   - Payments (optional)
3. **Add to .env**: Set your `DERIV_API_TOKEN` in the `.env` file

## Example Voice Commands

### MT5 Trading
- "Show me my MT5 accounts"
- "Buy 0.01 lots of EURUSD on MT5"
- "Place a sell order on Volatility 75 Index with 0.05 lots"
- "Show my open MT5 positions"
- "Close position ticket 12345"
- "Set stop loss at 1.0850 on my EURUSD position"

### Deriv Binary
- "Buy a CALL on Volatility 100 for 5 dollars, 5 ticks"
- "Check my Deriv balance"
- "Show my open positions"

## Deployment (Vercel)

This app is deployment-friendly and works on serverless platforms like Vercel:

1. Push to GitHub
2. Import to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

The MT5 integration uses Deriv's WebSocket API which works in browser environments without needing a local MT5 installation.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `DERIV_API_TOKEN` | Deriv API token with trading permissions | Yes |
| `SERP_API_KEY` | SerpAPI key for web search | Optional |
| `TAVILY_API_KEY` | Tavily API key for research | Optional |

## Tech Stack

- React 19 + TypeScript
- Vite
- Google Gemini AI (Live Audio API)
- Deriv WebSocket API
- Tailwind CSS
