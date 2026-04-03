import { DynamicWidget } from '@dynamic-labs/sdk-react-core'
import { useGameStateSSE } from './hooks/useGameStateSSE'
import './App.css'

function App() {
  useGameStateSSE()

  return (
    <div className="app-container">
      <DynamicWidget />
    </div>
  )
}

export default App
