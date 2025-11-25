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
const maxNPC = 1
function npcCount(){ let c = 0; for (const p of players.values()) if (p.npc) c++; return c }
function spawnNPC(){
  if (npcCount() >= maxNPC) return
  const id = uuidv4()
  const color = '#f5a524'
  const x = Math.floor(island.width/2 + Math.random()*400 - 200)
  const y = Math.floor(island.height/2 + Math.random()*400 - 200)
  players.set(id, { id, x, y, color, hp: 100, lastShot: 0, lastDash: 0, deadUntil: null, npc: true, name: 'NPC', ai: { tx: x, ty: y, next: Date.now() } })
}
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
    players: Array.from(players.values()).map(p => ({ id: p.id, x: p.x, y: p.y, color: p.color, hp: p.hp, deadUntil: p.deadUntil || null, name: p.name || null })),
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
        const rawName = typeof data.name === 'string' ? data.name : ''
        const safeName = rawName.trim().slice(0, 16) || 'Player'
        players.set(playerId, { id: playerId, x, y, color, hp: 100, lastShot: 0, lastDash: 0, deadUntil: null, name: safeName })
      }
      broadcastState()
    }
    if (data.type === 'move' && playerId) {
      const p = players.get(playerId)
      if (!p) return
      if (p.deadUntil && Date.now() < p.deadUntil) return
      const nx = clamp(Number(data.x), 0, island.width)
      const ny = clamp(Number(data.y), 0, island.height)
      p.x = nx
      p.y = ny
      broadcastState()
    }
    if (data.type === 'shoot' && playerId) {
      const p = players.get(playerId)
      if (!p) return
      if (p.deadUntil && Date.now() < p.deadUntil) return
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
    if (data.type === 'dash' && playerId) {
      const p = players.get(playerId)
      if (!p) return
      if (p.deadUntil && Date.now() < p.deadUntil) return
      const now = Date.now()
      if (now - p.lastDash < 2000) return
      const dx = Number(data.dx)
      const dy = Number(data.dy)
      const len = Math.hypot(dx, dy)
      if (!len) return
      p.lastDash = now
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
      if (p.deadUntil && now < p.deadUntil) continue
      const dx = p.x - b.x
      const dy = p.y - b.y
      if (dx*dx + dy*dy <= 20*20) {
        projectiles.delete(b.id)
        p.hp = Math.max(0, p.hp - 10)
        if (p.hp <= 0 && !p.deadUntil) {
          p.deadUntil = Date.now() + 3000
        }
        break
      }
    }
  }
  const live = Array.from(players.values()).filter(p => !(p.deadUntil && now < p.deadUntil))
  for (const n of players.values()) {
    if (!n.npc) continue
    if (n.deadUntil && now < n.deadUntil) continue
    let vx = 0, vy = 0
    let target = null
    let best = Infinity
    for (const t of live) {
      if (t.id === n.id) continue
      const dx = t.x - n.x
      const dy = t.y - n.y
      const d = Math.hypot(dx, dy)
      if (d < best) { best = d; target = t }
    }
    if (target) {
      const dx = target.x - n.x
      const dy = target.y - n.y
      const len = Math.hypot(dx, dy) || 1
      vx += dx/len
      vy += dy/len
    } else {
      if (now >= n.ai.next || Math.hypot(n.ai.tx - n.x, n.ai.ty - n.y) < 50) {
        n.ai.tx = clamp(Math.floor(Math.random()*island.width), 0, island.width)
        n.ai.ty = clamp(Math.floor(Math.random()*island.height), 0, island.height)
        n.ai.next = now + 3000 + Math.floor(Math.random()*3000)
      }
      const dx = n.ai.tx - n.x
      const dy = n.ai.ty - n.y
      const len = Math.hypot(dx, dy) || 1
      vx += dx/len
      vy += dy/len
    }
    let dodgeX = 0, dodgeY = 0, danger = false
    for (const b of projectiles.values()) {
      const px = n.x - b.x
      const py = n.y - b.y
      const dist = Math.hypot(px, py)
      if (dist > 220) continue
      const toward = px*b.vx + py*b.vy < 0 ? 1 : 0
      if (!toward) continue
      const perpX = -b.vy
      const perpY = b.vx
      const plen = Math.hypot(perpX, perpY) || 1
      vx += (perpX/plen) * 1.2
      vy += (perpY/plen) * 1.2
    }
    for (const t of live) {
      if (t.id === n.id) continue
      const dxs = n.x - t.x
      const dys = n.y - t.y
      const ds = Math.hypot(dxs, dys)
      const md = 300
      if (ds > 0 && ds < md) {
        const f = (md - ds)/md
        vx += (dxs/ds) * f * 2
        vy += (dys/ds) * f * 2
      }
    }
    if (danger) { vx += dodgeX * 1.2; vy += dodgeY * 1.2 }
    const vlen = Math.hypot(vx, vy)
    if (vlen > 0) {
      let speed = 330
      if (n.ai && n.ai.dashUntil && now < n.ai.dashUntil && n.ai.dashVX !== undefined) {
        speed = 990
        vx = n.ai.dashVX
        vy = n.ai.dashVY
      }
      n.x = clamp(n.x + (vx/vlen) * speed * dt, 0, island.width)
      n.y = clamp(n.y + (vy/vlen) * speed * dt, 0, island.height)
    }
    if (target) {
      if (now - n.lastShot > 400 && best < 800) {
        const dx = target.x - n.x
        const dy = target.y - n.y
        const len = Math.hypot(dx, dy) || 1
        n.lastShot = now
        const id = uuidv4()
        const speed = 600
        const vxp = (dx/len) * speed
        const vyp = (dy/len) * speed
        projectiles.set(id, { id, x: n.x, y: n.y, vx: vxp, vy: vyp, owner: n.id, ttl: 2000 })
      }
      if (now - n.lastDash > 2000 && best < 600) {
        const dx = target.x - n.x
        const dy = target.y - n.y
        const len = Math.hypot(dx, dy) || 1
        n.lastDash = now
        if (!n.ai) n.ai = {}
        n.ai.dashUntil = now + 200
        n.ai.dashVX = dx/len
        n.ai.dashVY = dy/len
      }
    }
  }
  for (const p of players.values()) {
    if (p.deadUntil && now >= p.deadUntil) {
      p.hp = 100
      const rx = Math.floor(island.width/2 + Math.random()*200 - 100)
      const ry = Math.floor(island.height/2 + Math.random()*200 - 100)
      p.x = rx
      p.y = ry
      p.deadUntil = null
    }
  }
  broadcastState()
}, 50)

setInterval(() => { spawnNPC() }, 5000)
