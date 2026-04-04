import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core'
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum'
import { SolanaWalletConnectors } from '@dynamic-labs/solana'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors, SolanaWalletConnectors],
        initialAuthenticationMode: 'connect-only',
        shadowDOMEnabled: false,
        cssOverrides: `
          .dynamic-widget-inline-controls {
            background: rgba(255,255,255,0.05) !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            border-radius: 999px !important;
            padding: 0 16px !important;
            height: 38px !important;
            font-family: 'Neue Haas Grotesk Display', sans-serif !important;
            font-size: 12px !important;
            color: rgba(255,255,255,0.4) !important;
            backdrop-filter: none !important;
            box-shadow: none !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 8px !important;
          }
          .dynamic-widget-inline-controls:hover {
            background: rgba(255,255,255,0.1) !important;
          }
          .dynamic-widget-inline-controls button,
          .dynamic-widget-inline-controls span,
          .dynamic-widget-inline-controls p,
          .dynamic-widget-inline-controls div {
            font-family: 'Neue Haas Grotesk Display', sans-serif !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            color: rgba(255,255,255,0.9) !important;
          }
          .connect-button {
            background: rgba(99,156,230,0.14) !important;
            border: 1px solid rgba(99,156,230,0.32) !important;
            border-radius: 999px !important;
            padding: 0 20px !important;
            height: 38px !important;
            font-family: 'Neue Haas Grotesk Display', sans-serif !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            color: rgba(255,255,255,0.9) !important;
            letter-spacing: 0.01em !important;
            transition: background 0.2s, border-color 0.2s !important;
          }
          .connect-button:hover {
            background: rgba(99,156,230,0.24) !important;
            border-color: rgba(99,156,230,0.5) !important;
          }
          .dynamic-widget-inline-controls svg,
          .dynamic-widget-inline-controls svg path,
          .dynamic-widget-inline-controls svg circle {
            fill: white !important;
            stroke: white !important;
            color: white !important;
          }
        `,
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DynamicContextProvider>
  </StrictMode>,
)
