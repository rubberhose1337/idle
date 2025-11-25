const express = require('express')
const http = require('http')
const { WebSocketServer } = require('ws')
const { v4: uuidv4 } = require('uuid')

const app = express()
app.use(express.static('public'))

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const players = new Map()
const projectiles = new Map()
let lastTick = Date.now()
const island = { width: 2000, height: 2000 }

function clamp(v, min, max) {
  if (v < min) return min
  if (v > max) return max
  return v
}

function broadcastState() {
  const payload = JSON.stringify({
    type: 'state',
    players: Array.from(players.values()).map(p => ({ id: p.id, x: p.x, y: p.y, color: p.color, hp: p.hp })),
    projectiles: Array.from(projectiles.values()).map(b => ({ id: b.id, x: b.x, y: b.y, owner: b.owner }))
  })
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload)
  })
}

wss.on('connection', ws => {
  let playerId = null
  ws.send(JSON.stringify({ type: 'world', width: island.width, height: island.height }))

  ws.on('message', message => {
    let data
    try { data = JSON.parse(message.toString()) } catch { return }
    if (data.type === 'join') {
      playerId = data.id || uuidv4()
      if (!players.has(playerId)) {
        const color = `hsl(${Math.floor(Math.random()*360)},70%,55%)`
        const x = Math.floor(island.width/2 + Math.random()*200 - 100)
        const y = Math.floor(island.height/2 + Math.random()*200 - 100)
        players.set(playerId, { id: playerId, x, y, color, hp: 100, lastShot: 0 })
      }
      broadcastState()
    }
    if (data.type === 'move' && playerId) {
      const p = players.get(playerId)
      if (!p) return
      const nx = clamp(Number(data.x), 0, island.width)
      const ny = clamp(Number(data.y), 0, island.height)
      p.x = nx
      p.y = ny
      broadcastState()
    }
    if (data.type === 'shoot' && playerId) {
      const p = players.get(playerId)
      if (!p) return
      const now = Date.now()
      if (now - p.lastShot < 200) return
      const dx = Number(data.dx)
      const dy = Number(data.dy)
      const len = Math.hypot(dx, dy)
      if (!len) return
      p.lastShot = now
      const id = uuidv4()
      const speed = 600
      const vx = (dx/len) * speed
      const vy = (dy/len) * speed
      projectiles.set(id, { id, x: p.x, y: p.y, vx, vy, owner: p.id, ttl: 2000 })
    }
  })

  ws.on('close', () => {
    if (playerId && players.has(playerId)) {
      players.delete(playerId)
      broadcastState()
    }
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}/`)
})

setInterval(() => {
  const now = Date.now()
  const dt = Math.min(0.05, (now - lastTick)/1000)
  lastTick = now
  for (const b of Array.from(projectiles.values())) {
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.ttl -= (dt*1000)
    if (b.x < 0 || b.y < 0 || b.x > island.width || b.y > island.height || b.ttl <= 0) {
      projectiles.delete(b.id)
      continue
    }
    for (const p of players.values()) {
      if (p.id === b.owner) continue
      const dx = p.x - b.x
      const dy = p.y - b.y
      if (dx*dx + dy*dy <= 20*20) {
        projectiles.delete(b.id)
        p.hp = Math.max(0, p.hp - 10)
        if (p.hp <= 0) {
          p.hp = 100
          const rx = Math.floor(island.width/2 + Math.random()*200 - 100)
          const ry = Math.floor(island.height/2 + Math.random()*200 - 100)
          p.x = rx
          p.y = ry
        }
        break
      }
    }
  }
  broadcastState()
}, 50)
