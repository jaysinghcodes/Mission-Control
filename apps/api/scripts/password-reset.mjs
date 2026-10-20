/**
 * Set a new dashboard password and revoke every session.
 *
 * POST /auth/password-reset on 127.0.0.1 only. A published Compose port is
 * not loopback inside the container, so from the host run:
 * docker compose exec api npm run password:reset
 */
import { request } from 'node:http'

const port = listenPort(
  process.env.PORT && process.env.PORT.trim() !== '' ? process.env.PORT : process.env.MC_API_PORT,
)
const req = request(
  {
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/auth/password-reset',
  },
  (res) => {
    const chunks = []
    res.on('data', (chunk) => {
      chunks.push(chunk)
    })
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      if (res.statusCode === 200) {
        const password = readPassword(body)
        if (!password) {
          fail('The API did not return a password.')
        }
        console.log(`Dashboard password, shown once: ${password}`)
        console.log('Every session was revoked.')
        process.exit(0)
      }
      console.error('Could not reset the dashboard password.')
      if (res.statusCode === 401) {
        console.error(
          'This command has to run on the API itself. Under Compose: docker compose exec api npm run password:reset',
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

function readPassword(body) {
  try {
    const parsed = JSON.parse(body)
    const password = parsed && parsed.password
    if (typeof password !== 'string' || password.length === 0 || password.length > 1024) return ''
    if (/[\r\n]/.test(password)) return ''
    return password
  } catch {
    return ''
  }
}

function fail(line) {
  console.error('Could not reset the dashboard password.')
  console.error(line)
  console.error(
    'Under Compose: docker compose exec api npm run password:reset',
  )
  process.exit(1)
}
