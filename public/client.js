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
let bullets = new Map()
let aim = null
let mouseLeft = false
let dmgPopups = []
let lastBossHp = null
function isDead(){ return me && me.deadUntil && Date.now() < me.deadUntil }

const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host)
let playerName = localStorage.getItem('player_name') || null
let nameReady = !!playerName
me.name = playerName || 'Player'
let wsOpened = false
ws.addEventListener('open', () => {
  wsOpened = true
  if (nameReady) ws.send(JSON.stringify({ type: 'join', id: me.id, name: playerName }))
})
function initNameUI(){
  const ov = document.getElementById('name-overlay')
  const inp = document.getElementById('name-input')
  const btn = document.getElementById('name-btn')
  if (!nameReady){
    ov.style.display = 'flex'
    inp.focus()
    btn.onclick = () => {
      const n = (inp.value || '').trim().slice(0,16)
      if (!n) return
      playerName = n
      localStorage.setItem('player_name', playerName)
      me.name = playerName
      nameReady = true
      ov.style.display = 'none'
      if (wsOpened && ws.readyState === 1) ws.send(JSON.stringify({ type: 'join', id: me.id, name: playerName }))
    }
  }
}
initNameUI()
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
      me.name = mine.name ?? me.name
    }
    const boss = Array.from(players.values()).find(p => p.boss)
    if (boss) {
      const hpNow = boss.hp || 0
      if (lastBossHp != null && hpNow < lastBossHp) {
        const dmg = lastBossHp - hpNow
        dmgPopups.push({ x: boss.x, y: boss.y - 18, amount: dmg, t: 0 })
      }
      lastBossHp = hpNow
    }
    const nowT = performance.now()
    const ids = new Set()
    const listB = Array.isArray(msg.projectiles) ? msg.projectiles : []
    for (const b of listB) {
      ids.add(b.id)
      const prev = bullets.get(b.id)
      const vx = (b.vx !== undefined) ? b.vx : (prev ? prev.vx : 0)
      const vy = (b.vy !== undefined) ? b.vy : (prev ? prev.vy : 0)
      bullets.set(b.id, { id: b.id, x: b.x, y: b.y, vx, vy, t: nowT })
    }
    for (const id of Array.from(bullets.keys())) {
      if (!ids.has(id)) bullets.delete(id)
    }
  }
})

const keys = { ArrowUp:false, ArrowDown:false, ArrowLeft:false, ArrowRight:false, KeyW:false, KeyA:false, KeyS:false, KeyD:false, Space:false }
function onKey(e){
  const tag = document.activeElement && document.activeElement.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON'
  if (!nameReady || typing) return
  const k = e.code
  if (k in keys){ keys[k] = e.type === 'keydown'; e.preventDefault() }
}
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
  for (const b of bullets.values()) {
    b.x += b.vx * dt
    b.y += b.vy * dt
  }
  for (const d of dmgPopups) d.t += dt
  dmgPopups = dmgPopups.filter(d => d.t < 1.0)
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
  if (mouseLeft && aim && now - lastShoot > 150 && !isDead()) {
    const dx = aim.x - me.x
    const dy = aim.y - me.y
    const len = Math.hypot(dx, dy)
    if (len && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'shoot', dx, dy }))
      lastShoot = now
    }
  }
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
  const grad = ctx.createRadialGradient(ox + world.width*scale/2, oy + world.height*scale/2, 0, ox + world.width*scale/2, oy + world.height*scale/2, Math.max(world.width,world.height)*scale/2)
  grad.addColorStop(0, '#173a6a')
  grad.addColorStop(0.7, '#122b4f')
  grad.addColorStop(1, '#0e2142')
  ctx.fillStyle = grad
  ctx.fillRect(ox, oy, world.width*scale, world.height*scale)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 2
  ctx.strokeRect(ox, oy, world.width*scale, world.height*scale)
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
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(ax, ay, 9, 0, Math.PI*2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ax-10, ay)
    ctx.lineTo(ax+10, ay)
    ctx.moveTo(ax, ay-10)
    ctx.lineTo(ax, ay+10)
    ctx.stroke()
  }
  for (const b of bullets.values()) {
    const bx = ox + b.x*scale
    const by = oy + b.y*scale
    const tail = 18
    const bl = Math.hypot(b.vx, b.vy)
    const tx = bx - (b.vx/bl) * tail
    const ty = by - (b.vy/bl) * tail
    ctx.strokeStyle = 'rgba(255,208,87,0.6)'
    ctx.lineWidth = 3
    if (bl > 0) {
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.fillStyle = '#ffd057'
    ctx.shadowColor = '#ffd057'
    ctx.shadowBlur = 12
    ctx.arc(bx, by, 4, 0, Math.PI*2)
    ctx.fill()
    ctx.shadowBlur = 0
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
    const g = ctx.createRadialGradient(px, py, 0, px, py, 12)
    g.addColorStop(0, p.color || '#ffffff')
    g.addColorStop(1, '#ffffff')
    ctx.beginPath()
    ctx.fillStyle = g
    ctx.shadowColor = p.color || '#ffffff'
    ctx.shadowBlur = 18
    ctx.arc(px, py, p.boss ? 18 : 10, 0, Math.PI*2)
    ctx.fill()
    ctx.shadowBlur = 0
    if (p.id === me.id) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, 14, 0, Math.PI*2)
      ctx.stroke()
    }
    const isBoss = !!p.boss
    if (!isBoss) {
      const maxHp = Math.max(1, p.maxHp || 100)
      const barW = 54
      const barH = 8
      const frac = Math.max(0, Math.min(1, (p.hp||maxHp)/maxHp))
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.beginPath()
      ctx.moveTo(px - barW/2 + 6, py - 30)
      ctx.arcTo(px + barW/2, py - 30, px + barW/2, py - 30 + barH, 6)
      ctx.arcTo(px + barW/2, py - 30 + barH, px - barW/2, py - 30 + barH, 6)
      ctx.arcTo(px - barW/2, py - 30 + barH, px - barW/2, py - 30, 6)
      ctx.arcTo(px - barW/2, py - 30, px + barW/2, py - 30, 6)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#34d399'
      ctx.fillRect(px - barW/2, py - 30, barW * frac, barH)
    }
    ctx.fillStyle = '#e6edf3'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'center'
    const label = (p.name && String(p.name).slice(0,16)) || p.id.slice(0,4)
    ctx.fillText(label, px, py - 36)
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
  const boss = Array.from(players.values()).find(p => p.boss)
  if (boss) {
    const maxHp = Math.max(1, boss.maxHp || 100)
    const frac = Math.max(0, Math.min(1, (boss.hp||maxHp)/maxHp))
    const bw = Math.min(420, w*0.6)
    const bx = (w - bw)/2
    const by = 20
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(bx, by, bw, 12)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(bx, by, bw*frac, 12)
    ctx.fillStyle = '#e6edf3'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(`BOSS ${Math.max(0, boss.hp|0)}/${maxHp|0}`, w/2, by + 24)
  }
  for (const d of dmgPopups) {
    const islandPadding = 80
    const scaleX = (w - islandPadding*2) / world.width
    const scaleY = (h - islandPadding*2) / world.height
    const scale = Math.min(scaleX, scaleY)
    const ox = (w - world.width*scale)/2
    const oy = (h - world.height*scale)/2
    const px = ox + d.x*scale
    const py = oy + d.y*scale - d.t*40
    const alpha = Math.max(0, 1 - d.t)
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#ef4444'
    ctx.font = 'bold 16px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(`-${d.amount|0}`, px, py)
    ctx.globalAlpha = 1
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
  mouseLeft = true
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
const hudNameEl = document.getElementById('hud-name')
if (hudNameEl) hudNameEl.textContent = me.name || ''

window.addEventListener('mouseup', e => { if (e.button === 0) mouseLeft = false })
canvas.addEventListener('mouseleave', () => { mouseLeft = false })

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
