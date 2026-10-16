/**
 * Clear login lockouts in the API on this machine.
 *
 * POST /auth/login-reset on 127.0.0.1 only. A published Compose port is
 * not loopback inside the container, so from the host run:
 * docker compose exec api npm run login:reset
 */
import { request } from 'node:http'

const port = listenPort(process.env.PORT)
const req = request(
  {
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/auth/login-reset',
  },
  (res) => {
    res.on('data', () => {})
    res.on('end', () => {
      if (res.statusCode === 204) {
        console.log('Login lockouts cleared.')
        process.exit(0)
      }
      console.error('Could not clear login lockouts.')
      if (res.statusCode === 401) {
        console.error(
          'This command has to run on the API itself. Under Compose: docker compose exec api npm run login:reset',
        )
      }
      process.exit(1)
    })
  },
)

req.setTimeout(5000, () => {
  req.destroy()
  fail('The API did not answer on 127.0.0.1:' + String(port) + '.')
})

req.on('error', () => {
  fail('The API did not answer on 127.0.0.1:' + String(port) + '.')
})

req.end()

function listenPort(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return 3000
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 3000
  return n
}

function fail(line) {
  console.error('Could not clear login lockouts.')
  console.error(line)
  console.error(
    'Under Compose: docker compose exec api npm run login:reset',
  )
  process.exit(1)
}
