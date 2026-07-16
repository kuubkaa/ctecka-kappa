import { HashRouter, Route, Routes } from 'react-router-dom'
import { HomeScreen } from './screens/HomeScreen'
import { SessionScreen } from './screens/SessionScreen'
import { SettingsScreen } from './screens/SettingsScreen'

export function App() {
  return (
    // HashRouter, not BrowserRouter: this ships as static files with no server to
    // rewrite deep links, and the Android back button must walk screens rather
    // than quit the app.
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/inventura/:id" element={<SessionScreen />} />
        <Route path="/nastaveni" element={<SettingsScreen />} />
      </Routes>
    </HashRouter>
  )
}
