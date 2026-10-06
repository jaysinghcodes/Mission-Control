import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import Connect from './pages/Connect'
import Tasks from './pages/Tasks'
import Agents from './pages/Agents'
import Approvals from './pages/Approvals'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Office from './pages/Office'
import Pipeline from './pages/Pipeline'
import Calendar from './pages/Calendar'
import Memory from './pages/Memory'
import Docs from './pages/Docs'
import Team from './pages/Team'
import System from './pages/System'

/**
 * Ticket 13 routes. Old paths redirect to the page that replaced them so a
 * deep link does not 404. Query strings are kept (project filters, etc.).
 */
function Keep({ to, view }: { to: string; view?: string }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (view) params.set('view', view)
  const q = params.toString()
  return <Navigate to={q ? `${to}?${q}` : to} replace />
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/connect" element={<Connect />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tickets" element={<Keep to="/tasks" />} />
          <Route path="/backlog" element={<Keep to="/tasks" view="backlog" />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/office" element={<Office />} />
          <Route path="/factory" element={<Navigate to="/office" replace />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/activity" element={<Navigate to="/office" replace />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/team" element={<Team />} />
          <Route path="/system" element={<System />} />
          <Route path="/system/:panel" element={<System />} />
          <Route path="/health" element={<Navigate to="/system" replace />} />
          <Route path="/usage" element={<Navigate to="/system" replace />} />
          <Route path="/logs" element={<Navigate to="/system/logs" replace />} />
          <Route path="/sessions" element={<Navigate to="/system/sessions" replace />} />
          <Route path="/settings" element={<Navigate to="/system/settings" replace />} />
          <Route path="*" element={<Navigate to="/tasks" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
