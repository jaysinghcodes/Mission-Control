import { useSearchParams } from 'react-router-dom'
import Tickets from './Tickets'
import Backlog from './Backlog'

/**
 * Tasks — the board (old Tickets) and the backlog, one page.
 * /tickets and /backlog redirect here and keep ?project=.
 */
export default function Tasks() {
  const [params] = useSearchParams()
  if (params.get('view') === 'backlog') return <Backlog />
  return <Tickets />
}
