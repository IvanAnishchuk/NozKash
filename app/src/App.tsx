import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { NozkMasterSeedProvider } from './context/NozkMasterSeedProvider'
import { PrivacyProvider } from './context/PrivacyProvider'
import { Dashboard } from './pages/Dashboard'
import { Deposit } from './pages/Deposit'
import { Recovery } from './pages/Recovery'
import { Redeem } from './pages/Redeem'

export default function App() {
  return (
    <BrowserRouter>
      <PrivacyProvider>
        <NozkMasterSeedProvider>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="deposit" element={<Deposit />} />
              <Route path="redeem" element={<Redeem />} />
              <Route path="recovery" element={<Recovery />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </NozkMasterSeedProvider>
      </PrivacyProvider>
    </BrowserRouter>
  )
}
