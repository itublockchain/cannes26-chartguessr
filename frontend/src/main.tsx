import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import "./index.css";
import App from "./App.tsx";
import { ChartPage } from "./components/ChartPage.tsx";

const ARC_TESTNET_CHAIN_ID = 5042002;

const arcTestnet = {
  chainId: ARC_TESTNET_CHAIN_ID,
  networkId: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  vanityName: "Arc Testnet",
  isTestnet: true,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: [],
  iconUrls: [],
};

export function TradingChartShell() {
  return (
    <div className="fixed inset-0 z-[100] flex min-h-0 min-w-0 flex-col bg-white">
      <ChartPage />
    </div>
  );
}

export function AppWithDynamic() {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
        initialAuthenticationMode: "connect-and-sign",
        shadowDOMEnabled: false,
        overrides: {
          evmNetworks: [arcTestnet],
        },
        cssOverrides: `
          .dynamic-widget-inline-controls {
            background: rgba(0,0,0,0.05) !important;
            border: 1px solid rgba(0,0,0,0.1) !important;
            border-radius: 999px !important;
            padding: 0 16px !important;
            height: 38px !important;
            font-family: 'Satoshi', sans-serif !important;
            font-size: 12px !important;
            color: rgba(0,0,0,0.4) !important;
            backdrop-filter: none !important;
            box-shadow: none !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 8px !important;
          }
          .dynamic-widget-inline-controls:hover {
            background: rgba(0,0,0,0.1) !important;
          }
          .dynamic-widget-inline-controls button,
          .dynamic-widget-inline-controls span,
          .dynamic-widget-inline-controls p,
          .dynamic-widget-inline-controls div {
            font-family: 'Satoshi', sans-serif !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            color: rgba(0,0,0,0.9) !important;
          }
          .connect-button {
            background: rgba(59,130,246,0.1) !important;
            border: 1px solid rgba(59,130,246,0.2) !important;
            border-radius: 999px !important;
            padding: 0 20px !important;
            height: 38px !important;
            font-family: 'Satoshi', sans-serif !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            color: rgba(0,0,0,0.9) !important;
            letter-spacing: 0.01em !important;
            transition: background 0.2s, border-color 0.2s !important;
          }
          .connect-button:hover {
            background: rgba(59,130,246,0.15) !important;
            border-color: rgba(59,130,246,0.3) !important;
          }
          .dynamic-widget-inline-controls svg,
          .dynamic-widget-inline-controls svg path,
          .dynamic-widget-inline-controls svg circle {
            fill: #374151 !important;
            stroke: #374151 !important;
            color: #374151 !important;
          }
        `,
      }}
    >
      <App />
    </DynamicContextProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/page" element={<TradingChartShell />} />
        <Route path="*" element={<AppWithDynamic />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
