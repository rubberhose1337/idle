const express = require('express')
const http = require('http')
const { WebSocketServer } = require('ws')
const { v4: uuidv4 } = require('uuid')

const app = express()
app.use(express.static('public'))

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const players = new Map()
const island = { width: 2000, height: 2000 }

function clamp(v, min, max) {
  if (v < min) return min
  if (v > max) return max
  return v
}

function broadcastState() {
  const payload = JSON.stringify({
    type: 'state',
    players: Array.from(players.values()).map(p => ({ id: p.id, x: p.x, y: p.y, color: p.color }))
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
        players.set(playerId, { id: playerId, x, y, color })
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
