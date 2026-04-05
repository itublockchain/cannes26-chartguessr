import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import "./index.css";
import App from "./App.tsx";
import { ChartPage } from "./components/ChartPage.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchInterval: 30_000,
      retry: 1,
    },
  },
});

const ARC_TESTNET_CHAIN_ID = 5042002;

const evmNetworks = [
  {
    chainId: ARC_TESTNET_CHAIN_ID,
    networkId: ARC_TESTNET_CHAIN_ID,
    name: "Arc Testnet",
    vanityName: "Arc Testnet",
    isTestnet: true,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: ["https://rpc.testnet.arc.network"],
    blockExplorerUrls: [],
    iconUrls: [],
  },
  {
    chainId: 11155111,
    networkId: 11155111,
    name: "Sepolia",
    vanityName: "Ethereum Sepolia",
    isTestnet: true,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
    iconUrls: [],
  },
  {
    chainId: 84532,
    networkId: 84532,
    name: "Base Sepolia",
    vanityName: "Base Sepolia",
    isTestnet: true,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
    iconUrls: [],
  },
  {
    chainId: 421614,
    networkId: 421614,
    name: "Arbitrum Sepolia",
    vanityName: "Arbitrum Sepolia",
    isTestnet: true,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
    blockExplorerUrls: ["https://sepolia.arbiscan.io"],
    iconUrls: [],
  },
  {
    chainId: 11155420,
    networkId: 11155420,
    name: "Optimism Sepolia",
    vanityName: "Optimism Sepolia",
    isTestnet: true,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.optimism.io"],
    blockExplorerUrls: ["https://sepolia-optimism.etherscan.io"],
    iconUrls: [],
  },
  {
    chainId: 43113,
    networkId: 43113,
    name: "Avalanche Fuji",
    vanityName: "Avalanche Fuji",
    isTestnet: true,
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
    blockExplorerUrls: ["https://testnet.snowtrace.io"],
    iconUrls: [],
  },
  {
    chainId: 80002,
    networkId: 80002,
    name: "Polygon Amoy",
    vanityName: "Polygon Amoy",
    isTestnet: true,
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://rpc-amoy.polygon.technology"],
    blockExplorerUrls: ["https://amoy.polygonscan.com"],
    iconUrls: [],
  },
];

export function TradingChartShell() {
  return (
    <div className="fixed inset-0 z-[100] flex min-h-0 min-w-0 flex-col bg-white">
      <ChartPage />
    </div>
  );
}

export function AppWithDynamic() {
  return (
    <QueryClientProvider client={queryClient}>
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
        initialAuthenticationMode: "connect-and-sign",
        shadowDOMEnabled: false,
        overrides: {
          evmNetworks,
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
    </QueryClientProvider>
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
