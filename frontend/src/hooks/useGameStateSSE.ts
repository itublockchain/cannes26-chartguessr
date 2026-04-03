import { useEffect, useRef } from 'react';
import type { GameStateEvent } from '../types/gameState';

export function useGameStateSSE() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const connect = () => {
      const sseUrl = import.meta.env.VITE_GAME_SSE_URL;
      
      if (!sseUrl) {
        console.error('[SSE] VITE_GAME_SSE_URL is not defined in environment variables!');
        return;
      }

      console.log(`[SSE] Connecting to ${sseUrl}...`);
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[SSE] Connection opened successfully.');
      };

      eventSource.onmessage = (event) => {
        try {
          // Gelen event datası genellikle stringify edilmiş JSON objesidir.
          const data = JSON.parse(event.data) as GameStateEvent;
          
          // State'leri console.log vasıtasıyla ekrana basıyoruz
          console.log(`[SSE] Game State Received: ${data.state}`, data);
        } catch (error) {
          console.error('[SSE] Failed to parse message data:', event.data, error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('[SSE] Connection Error. Closing connection and will reconnect in 10 seconds...', error);
        
        // Bağlantıyı temizle
        eventSource.close();
        eventSourceRef.current = null;

        // 10 saniye (10000ms) sonra tekrar bağlanmayı dene
        timeoutRef.current = window.setTimeout(connect, 10000);
      };
    };

    // İlk bağlantıyı başlat
    connect();

    // Component unmount olduğunda cleanup işlemi
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      if (eventSourceRef.current) {
        console.log('[SSE] Cleaning up SSE connection.');
        eventSourceRef.current.close();
      }
    };
  }, []);
}
