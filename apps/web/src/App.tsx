import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import Connect from './pages/Connect'
import Overview from './pages/Overview'
import Tasks from './pages/Tasks'
import Tickets from './pages/Tickets'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Backlog from './pages/Backlog'
import Calendar from './pages/Calendar'
import Approvals from './pages/Approvals'
import Team from './pages/Team'
import Office from './pages/Office'
import Activity from './pages/Activity'
import Health from './pages/Health'
import Settings from './pages/Settings'
import Sessions from './pages/Sessions'
import Usage from './pages/Usage'
import Logs from './pages/Logs'

/**
 * Mission Control — full userflow (13 screens, wireframe-faithful).
 * HashRouter so deep links work on any static host without rewrite rules.
 * Every sidebar item in WORKSPACE / TEAM / OBSERVE is a real route.
 */
function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Onboarding gate — full page, outside the app shell */}
        <Route path="/connect" element={<Connect />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tickets" element={<Tickets />} />
          {/* Ticket 4. HashRouter → /#/projects and /#/projects/:id */}
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/backlog" element={<Backlog />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/team" element={<Team />} />
          {/* Legacy redirect: the roster moved from /agents → /team (old links keep working) */}
          <Route path="/agents" element={<Navigate to="/team" replace />} />
          <Route path="/office" element={<Office />} />
          {/* Legacy redirect: the floor moved from /factory → /office (old links keep working) */}
          <Route path="/factory" element={<Navigate to="/office" replace />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/health" element={<Health />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
