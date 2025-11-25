const canvas = document.getElementById('game')
const ctx = canvas.getContext('2d')
let w = 800
let h = 600
function resize(){ w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h }
resize()
window.addEventListener('resize', resize)

function rid(){ return Math.random().toString(36).slice(2,10) }
const meId = localStorage.getItem('player_id') || (()=>{ const id = rid(); localStorage.setItem('player_id', id); return id })()

let world = { width: 2000, height: 2000 }
let players = new Map()
let me = { id: meId, x: world.width/2, y: world.height/2, color: '#5bd1ff', hp: 100 }
players.set(me.id, me)
let projectiles = []
let aim = null
function isDead(){ return me && me.deadUntil && Date.now() < me.deadUntil }

const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host)
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'join', id: me.id }))
})
ws.addEventListener('message', ev => {
  let msg
  try { msg = JSON.parse(ev.data) } catch { return }
  if (msg.type === 'world') {
    world.width = msg.width
    world.height = msg.height
  }
  if (msg.type === 'state') {
    const list = msg.players
    const map = new Map()
    for (const p of list) map.set(p.id, p)
    players = map
    const mine = players.get(me.id)
    if (mine) {
      me.hp = mine.hp ?? me.hp
      me.color = mine.color ?? me.color
      me.deadUntil = mine.deadUntil ?? me.deadUntil
    }
    projectiles = Array.isArray(msg.projectiles) ? msg.projectiles : []
  }
})

const keys = { ArrowUp:false, ArrowDown:false, ArrowLeft:false, ArrowRight:false, KeyW:false, KeyA:false, KeyS:false, KeyD:false, Space:false }
function onKey(e){ const k = e.code; if (k in keys){ keys[k] = e.type === 'keydown'; e.preventDefault() } }
window.addEventListener('keydown', onKey)
window.addEventListener('keyup', onKey)

let lastSend = 0
let lastShoot = 0
let lastDash = 0
let dashing = false
let dashVX = 0
let dashVY = 0
let dashElapsed = 0
const dashDuration = 0.2
const dashDistance = 300
let lastDirX = 0
let lastDirY = -1
const smooth = new Map()
function clamp(v, min, max){ if (v<min) return min; if (v>max) return max; return v }

function update(dt){
  const speed = 660
  let vx = 0, vy = 0
  if (isDead()) {
    return
  }
  if (keys.KeyW || keys.ArrowUp) vy -= 1
  if (keys.KeyS || keys.ArrowDown) vy += 1
  if (keys.KeyA || keys.ArrowLeft) vx -= 1
  if (keys.KeyD || keys.ArrowRight) vx += 1
  if (vx !== 0 || vy !== 0) {
    const len = Math.hypot(vx, vy)
    vx /= len; vy /= len
    me.x = clamp(me.x + vx * speed * dt, 0, world.width)
    me.y = clamp(me.y + vy * speed * dt, 0, world.height)
    lastDirX = vx
    lastDirY = vy
  }
  if (!dashing && keys.Space && performance.now() - lastDash > 2000 && (lastDirX !== 0 || lastDirY !== 0)) {
    dashing = true
    dashVX = lastDirX
    dashVY = lastDirY
    dashElapsed = 0
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'dash', dx: dashVX, dy: dashVY }))
    lastDash = performance.now()
  }
  if (dashing) {
    dashElapsed += dt
    const t = Math.min(dashElapsed / dashDuration, 1)
    const ease = 1 - (t*t)
    const dashSpeed = (dashDistance / dashDuration) * ease
    me.x = clamp(me.x + dashVX * dashSpeed * dt, 0, world.width)
    me.y = clamp(me.y + dashVY * dashSpeed * dt, 0, world.height)
    if (t >= 1) dashing = false
  }
  const now = performance.now()
  if (now - lastSend > 50) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'move', x: me.x, y: me.y }))
    lastSend = now
  }
}

function draw(){
  ctx.clearRect(0,0,w,h)
  const islandPadding = 80
  const scaleX = (w - islandPadding*2) / world.width
  const scaleY = (h - islandPadding*2) / world.height
  const scale = Math.min(scaleX, scaleY)
  const ox = (w - world.width*scale)/2
  const oy = (h - world.height*scale)/2
  ctx.fillStyle = '#16325c'
  ctx.fillRect(ox, oy, world.width*scale, world.height*scale)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  for (let gx = 0; gx <= world.width; gx += 100) {
    ctx.beginPath()
    ctx.moveTo(ox + gx*scale, oy)
    ctx.lineTo(ox + gx*scale, oy + world.height*scale)
    ctx.stroke()
  }
  for (let gy = 0; gy <= world.height; gy += 100) {
    ctx.beginPath()
    ctx.moveTo(ox, oy + gy*scale)
    ctx.lineTo(ox + world.width*scale, oy + gy*scale)
    ctx.stroke()
  }
  {
    const px = ox + me.x*scale
    const py = oy + me.y*scale
    const axw = clamp((aim ? aim.x : me.x), 0, world.width)
    const ayw = clamp((aim ? aim.y : me.y), 0, world.height)
    const ax = ox + axw*scale
    const ay = oy + ayw*scale
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(ax, ay)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(ax, ay, 8, 0, Math.PI*2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ax-12, ay)
    ctx.lineTo(ax+12, ay)
    ctx.moveTo(ax, ay-12)
    ctx.lineTo(ax, ay+12)
    ctx.stroke()
  }
  for (const b of projectiles) {
    const bx = ox + b.x*scale
    const by = oy + b.y*scale
    ctx.beginPath()
    ctx.fillStyle = '#ffd057'
    ctx.arc(bx, by, 6, 0, Math.PI*2)
    ctx.fill()
  }
  for (const p of players.values()) {
    let rx = p.x
    let ry = p.y
    if (p.id !== me.id) {
      const s = smooth.get(p.id) || { x: p.x, y: p.y }
      const sx = s.x + (p.x - s.x) * 0.25
      const sy = s.y + (p.y - s.y) * 0.25
      smooth.set(p.id, { x: sx, y: sy })
      rx = sx
      ry = sy
    } else {
      rx = me.x
      ry = me.y
    }
    const px = ox + rx*scale
    const py = oy + ry*scale
    ctx.beginPath()
    ctx.fillStyle = p.color || '#ffffff'
    ctx.arc(px, py, 10, 0, Math.PI*2)
    ctx.fill()
    if (p.id === me.id) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, 14, 0, Math.PI*2)
      ctx.stroke()
    }
    const barW = 44
    const barH = 6
    const frac = Math.max(0, Math.min(1, (p.hp||100)/100))
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.fillRect(px - barW/2, py - 26, barW, barH)
    ctx.fillStyle = '#3ec56d'
    ctx.fillRect(px - barW/2, py - 26, barW * frac, barH)
    ctx.fillStyle = '#e6edf3'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(p.id.slice(0,4), px, py - 36)
  }

  if (isDead()) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(0,0,w,h)
    ctx.fillStyle = '#ff6b6b'
    ctx.font = 'bold 48px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('you are stupid', w/2, h/2)
    ctx.fillStyle = '#e6edf3'
    ctx.font = '16px system-ui'
    ctx.fillText('respawning...', w/2, h/2 + 36)
  }
}

function worldFromMouse(e){
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const islandPadding = 80
  const scaleX = (w - islandPadding*2) / world.width
  const scaleY = (h - islandPadding*2) / world.height
  const scale = Math.min(scaleX, scaleY)
  const ox = (w - world.width*scale)/2
  const oy = (h - world.height*scale)/2
  const x = (mx - ox) / scale
  const y = (my - oy) / scale
  return { x, y }
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return
  if (isDead()) return
  const now = performance.now()
  if (now - lastShoot < 150) return
  const t = worldFromMouse(e)
  const dx = t.x - me.x
  const dy = t.y - me.y
  const len = Math.hypot(dx, dy)
  if (!len) return
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'shoot', dx, dy }))
  lastShoot = now
})

canvas.addEventListener('mousemove', e => {
  const t = worldFromMouse(e)
  aim = { x: t.x, y: t.y }
})

let last = performance.now()
function loop(){
  const now = performance.now()
  const dt = Math.min(0.05, (now - last)/1000)
  update(dt)
  draw()
  last = now
  requestAnimationFrame(loop)
}
loop()
