import { HashRouter, Route, Routes } from 'react-router-dom'
import { BackupReminder } from './components/BackupReminder'
import { HomeScreen } from './screens/HomeScreen'
import { LabelsScreen } from './screens/LabelsScreen'
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
        <Route path="/stitky" element={<LabelsScreen />} />
        <Route path="/nastaveni" element={<SettingsScreen />} />
      </Routes>
      {/* Outside the routes: the backup is the only copy that survives a lost phone,
          so the reminder has to reach the user wherever they are. */}
      <BackupReminder />
    </HashRouter>
  )
}
