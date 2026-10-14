export type GameState = 'ready' | 'playing' | 'over'

export interface GameCallbacks {
  onStateChange?: (state: GameState) => void
  onScoreChange?: (score: number) => void
  onBestChange?: (best: number) => void
}

interface Obstacle {
  x: number
  w: number
  h: number
  type: 'spike' | 'bar' | 'tower'
}

interface Jelly {
  x: number
  y: number
  r: number
  hue: number
}

interface Cloud {
  x: number
  y: number
  s: number
  v: number
}

interface Hill {
  offset: number
  s: number
  h: number
  color: string
}

const GRAVITY = 3000
const JUMP_VELOCITY = -1080
const GROUND_HEIGHT = 92
const PLAYER_R = 30
const STORAGE_KEY = 'cookierun-best'

export class CookieRunGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private callbacks: GameCallbacks

  private raf = 0
  private lastTime = 0
  private destroyed = false

  private cssW = 0
  private cssH = 0
  private groundTop = 0

  private state: GameState = 'ready'
  private score = 0
  private best = 0
  private distance = 0
  private speed = 340
  private time = 0

  // player
  private px = 0
  private py = 0
  private vy = 0
  private grounded = true
  private jumpsUsed = 0
  private runPhase = 0

  // world
  private obstacles: Obstacle[] = []
  private jellies: Jelly[] = []
  private clouds: Cloud[] = []
  private hills: Hill[] = []
  private spawnDistance = 0
  private jellyTimer = 0

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      this.handleJumpInput()
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    this.handleJumpInput()
  }

  private resizeObserver: ResizeObserver

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks = {}) {
    this.canvas = canvas
    this.callbacks = callbacks
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context is not available')
    this.ctx = ctx

    this.best = this.loadBest()

    this.resize()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)

    window.addEventListener('keydown', this.onKeyDown)
    canvas.addEventListener('pointerdown', this.onPointerDown)

    this.initWorld()
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.resizeObserver.disconnect()
  }

  start() {
    this.resetRun()
    this.setState('playing')
  }

  // ------------------------------------------------------------------ setup

  private loadBest(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return Math.max(0, Number(raw) || 0)
    } catch {
      /* ignore */
    }
    return 0
  }

  private saveBest() {
    try {
      localStorage.setItem(STORAGE_KEY, String(this.best))
    } catch {
      /* ignore */
    }
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = this.canvas.clientWidth || 800
    const h = this.canvas.clientHeight || 450
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.cssW = w
    this.cssH = h
    this.groundTop = h - GROUND_HEIGHT
    this.px = Math.max(this.px || w * 0.18, PLAYER_R + 10)
    if (this.grounded) this.py = this.groundTop
  }

  private initWorld() {
    this.clouds = []
    for (let i = 0; i < 6; i++) {
      this.clouds.push(this.makeCloud(true))
    }
    this.hills = [
      { offset: 0, s: 0.25, h: 120, color: '#b18cd9' },
      { offset: 0, s: 0.5, h: 70, color: '#c7a4e8' },
    ]
  }

  private makeCloud(anywhere: boolean): Cloud {
    return {
      x: anywhere ? Math.random() * this.cssW : this.cssW + 40,
      y: 30 + Math.random() * (this.cssH * 0.4),
      s: 0.5 + Math.random() * 0.9,
      v: 12 + Math.random() * 22,
    }
  }

  private resetRun() {
    this.score = 0
    this.distance = 0
    this.speed = 340
    this.time = 0
    this.obstacles = []
    this.jellies = []
    this.spawnDistance = 520
    this.jellyTimer = 0.6
    this.py = this.groundTop
    this.vy = 0
    this.grounded = true
    this.jumpsUsed = 0
    this.emitScore()
  }

  private setState(next: GameState) {
    this.state = next
    this.callbacks.onStateChange?.(next)
  }

  private emitScore() {
    this.callbacks.onScoreChange?.(this.score)
  }

  // ------------------------------------------------------------------ input

  private handleJumpInput() {
    if (this.state === 'ready' || this.state === 'over') {
      this.start()
      return
    }
    if (this.state !== 'playing') return
    this.jump()
  }

  private jump() {
    if (this.grounded) {
      this.vy = JUMP_VELOCITY
      this.grounded = false
      this.jumpsUsed = 1
    } else if (this.jumpsUsed < 2) {
      this.vy = JUMP_VELOCITY * 0.92
      this.jumpsUsed = 2
    }
  }

  // ------------------------------------------------------------------ loop

  private loop = (t: number) => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.033, (t - this.lastTime) / 1000 || 0)
    this.lastTime = t
    this.update(dt)
    this.render()
  }

  private update(dt: number) {
    this.time += dt
    this.updateClouds(dt)

    if (this.state === 'ready') {
      this.runPhase += dt * 8
      this.py = this.groundTop - Math.abs(Math.sin(this.time * 3)) * 8
      return
    }

    if (this.state !== 'playing') return

    this.distance += this.speed * dt
    this.score = Math.floor(this.distance / 12)
    this.speed = Math.min(900, 340 + this.time * 9)
    this.runPhase += dt * (12 + this.speed / 60)

    // player physics
    if (!this.grounded) {
      this.vy += GRAVITY * dt
      this.py += this.vy * dt
      if (this.py >= this.groundTop) {
        this.py = this.groundTop
        this.vy = 0
        this.grounded = true
        this.jumpsUsed = 0
      }
    }

    // parallax hills
    for (const hill of this.hills) {
      hill.offset = (hill.offset + this.speed * hill.s * dt) % (this.cssW + 400)
    }

    // spawn obstacles
    this.spawnDistance -= this.speed * dt
    if (this.spawnDistance <= 0) {
      this.spawnObstacle()
      const gap = 360 + this.speed * 0.32
      this.spawnDistance = gap + Math.random() * gap
    }

    // spawn jellies
    this.jellyTimer -= dt
    if (this.jellyTimer <= 0) {
      this.spawnJellyArc()
      this.jellyTimer = 1.1 + Math.random() * 1.3
    }

    // move + collide obstacles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i]
      o.x -= this.speed * dt
      if (o.x + o.w < -40) {
        this.obstacles.splice(i, 1)
        continue
      }
      if (this.collidesWithObstacle(o)) {
        this.gameOver()
        return
      }
    }

    // move + collect jellies
    for (let i = this.jellies.length - 1; i >= 0; i--) {
      const j = this.jellies[i]
      j.x -= this.speed * dt
      if (j.x + j.r < -20) {
        this.jellies.splice(i, 1)
        continue
      }
      const cx = this.px
      const cy = this.py - PLAYER_R
      const dx = j.x - cx
      const dy = j.y - cy
      if (dx * dx + dy * dy < (PLAYER_R + j.r) * (PLAYER_R + j.r)) {
        this.jellies.splice(i, 1)
        this.score += 10
        this.emitScore()
      }
    }

    this.emitScore()
  }

  private updateClouds(dt: number) {
    const scroll = this.state === 'playing' ? this.speed : 40
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i]
      c.x -= (c.v + scroll * 0.06) * dt
      if (c.x + 120 * c.s < -20) {
        this.clouds.splice(i, 1)
        this.clouds.push(this.makeCloud(false))
      }
    }
  }

  private spawnObstacle() {
    const roll = Math.random()
    let type: Obstacle['type']
    if (roll < 0.42) type = 'spike'
    else if (roll < 0.78) type = 'bar'
    else type = 'tower'

    const x = this.cssW + 60
    if (type === 'spike') {
      const count = 2 + Math.floor(Math.random() * 2)
      this.obstacles.push({ x, w: 30 * count, h: 34, type })
    } else if (type === 'bar') {
      this.obstacles.push({ x, w: 68, h: 44, type })
    } else {
      this.obstacles.push({ x, w: 56, h: 118, type })
    }
  }

  private spawnJellyArc() {
    const baseY = this.groundTop - (50 + Math.random() * 130)
    const n = 3 + Math.floor(Math.random() * 2)
    const hue = Math.floor(Math.random() * 360)
    for (let i = 0; i < n; i++) {
      this.jellies.push({
        x: this.cssW + 60 + i * 34,
        y: baseY,
        r: 14,
        hue,
      })
    }
  }

  private collidesWithObstacle(o: Obstacle): boolean {
    const pLeft = this.px - PLAYER_R + 9
    const pRight = this.px + PLAYER_R - 9
    const pTop = this.py - PLAYER_R * 2 + 7
    const pBottom = this.py - 3

    let left = o.x
    let right = o.x + o.w
    const top = this.groundTop - o.h
    const bottom = this.groundTop

    if (o.type === 'spike') {
      left += o.w * 0.22
      right -= o.w * 0.22
      // spikes are slanted: only the lower triangle is deadly
      const sh = o.h
      const t = (this.px - o.x) / o.w // 0..1 across the spike block
      const slopeTop = top + sh * (1 - Math.abs(t - 0.5) * 2)
      return (
        pRight > left &&
        pLeft < right &&
        pBottom > slopeTop
      )
    }

    return (
      pRight > left &&
      pLeft < right &&
      pBottom > top &&
      pTop < bottom
    )
  }

  private gameOver() {
    this.setState('over')
    if (this.score > this.best) {
      this.best = this.score
      this.saveBest()
      this.callbacks.onBestChange?.(this.best)
    }
  }

  // ------------------------------------------------------------------ render

  private render() {
    const { ctx, cssW, cssH } = this
    ctx.clearRect(0, 0, cssW, cssH)

    this.drawSky()
    this.drawClouds()
    this.drawHills()
    this.drawGround()
    this.drawJellies()
    this.drawObstacles()
    this.drawPlayer()
    this.drawHud()
  }

  private drawSky() {
    const { ctx, cssW, cssH } = this
    const grad = ctx.createLinearGradient(0, 0, 0, cssH)
    grad.addColorStop(0, '#7ec8ff')
    grad.addColorStop(0.55, '#cfeaff')
    grad.addColorStop(1, '#fff3d6')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, cssW, cssH)

    // sun
    ctx.save()
    const sx = cssW - 90
    const sy = 70
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 90)
    glow.addColorStop(0, 'rgba(255, 236, 170, 0.9)')
    glow.addColorStop(1, 'rgba(255, 236, 170, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(sx - 90, sy - 90, 180, 180)
    ctx.fillStyle = '#fff0b3'
    ctx.beginPath()
    ctx.arc(sx, sy, 40, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawClouds() {
    const { ctx } = this
    for (const c of this.clouds) {
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.scale(c.s, c.s)
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath()
      ctx.arc(0, 0, 22, 0, Math.PI * 2)
      ctx.arc(22, -8, 18, 0, Math.PI * 2)
      ctx.arc(-22, -4, 16, 0, Math.PI * 2)
      ctx.arc(8, 10, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  private drawHills() {
    const { ctx, cssW, groundTop } = this
    for (const hill of this.hills) {
      ctx.fillStyle = hill.color
      ctx.beginPath()
      const span = cssW + 400
      for (let x = -400; x <= cssW; x += 40) {
        const wx = x - hill.offset
        const y = groundTop - Math.abs(Math.sin((wx / span) * Math.PI * 2)) * hill.h
        if (x === -400) ctx.moveTo(wx, y)
        else ctx.lineTo(wx, y)
      }
      ctx.lineTo(cssW, groundTop + 10)
      ctx.lineTo(-10, groundTop + 10)
      ctx.closePath()
      ctx.fill()
    }
  }

  private drawGround() {
    const { ctx, cssW, cssH, groundTop } = this
    const grad = ctx.createLinearGradient(0, groundTop, 0, cssH)
    grad.addColorStop(0, '#8a5a33')
    grad.addColorStop(1, '#5c3a1e')
    ctx.fillStyle = grad
    ctx.fillRect(0, groundTop, cssW, cssH - groundTop)

    // top rim
    ctx.fillStyle = '#c98a4b'
    ctx.fillRect(0, groundTop, cssW, 8)

    // scrolling stripes
    const offset = (this.distance * 1) % 60
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    for (let x = -offset; x < cssW; x += 60) {
      ctx.beginPath()
      ctx.moveTo(x, groundTop + 8)
      ctx.lineTo(x + 18, groundTop + 8)
      ctx.lineTo(x, groundTop + 8 + (cssH - groundTop - 8))
      ctx.lineTo(x - 18, groundTop + 8 + (cssH - groundTop - 8))
      ctx.closePath()
      ctx.fill()
    }
  }

  private drawObstacles() {
    const { ctx, groundTop } = this
    for (const o of this.obstacles) {
      const bottom = groundTop
      const top = bottom - o.h
      if (o.type === 'spike') {
        ctx.fillStyle = '#5d4a7a'
        const n = Math.round(o.w / 30)
        for (let i = 0; i < n; i++) {
          const x0 = o.x + i * 30
          ctx.beginPath()
          ctx.moveTo(x0, bottom)
          ctx.lineTo(x0 + 15, top)
          ctx.lineTo(x0 + 30, bottom)
          ctx.closePath()
          ctx.fill()
        }
      } else if (o.type === 'bar') {
        ctx.fillStyle = '#6b3f23'
        ctx.fillRect(o.x, top, o.w, o.h)
        ctx.fillStyle = '#8f5a34'
        ctx.fillRect(o.x, top, o.w, 8)
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        for (let i = 1; i < 3; i++) {
          ctx.fillRect(o.x + i * (o.w / 3) - 2, top + 8, 4, o.h - 8)
        }
      } else {
        // jelly tower
        const colors = ['#ef6292', '#f0e15a', '#6bd98c']
        const seg = o.h / 3
        for (let i = 0; i < 3; i++) {
          const sy = bottom - seg * (i + 1)
          ctx.fillStyle = colors[i]
          ctx.beginPath()
          ctx.roundRect(o.x, sy, o.w, seg - 2, 6)
          ctx.fill()
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.beginPath()
          ctx.roundRect(o.x, sy, o.w, (seg - 2) * 0.3, 6)
          ctx.fill()
        }
      }
    }
  }

  private drawJellies() {
    const { ctx } = this
    for (const j of this.jellies) {
      const bob = Math.sin(this.time * 6 + j.x * 0.05) * 3
      const y = j.y + bob
      ctx.save()
      ctx.translate(j.x, y)
      ctx.fillStyle = `hsl(${j.hue} 85% 60%)`
      ctx.beginPath()
      ctx.arc(0, 0, j.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.beginPath()
      ctx.arc(-j.r * 0.28, -j.r * 0.28, j.r * 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  private drawPlayer() {
    const { ctx, groundTop } = this
    const cx = this.px
    const cy = this.py - PLAYER_R
    const air = this.state === 'playing' && !this.grounded
    const tilt = air ? Math.max(-0.4, Math.min(0.4, this.vy / 3200)) : 0

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(tilt)

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.ellipse(0, groundTop - cy, PLAYER_R * 0.9, 8, 0, 0, Math.PI * 2)
    ctx.fill()

    // body (cookie)
    const body = ctx.createRadialGradient(-8, -10, 6, 0, 0, PLAYER_R)
    body.addColorStop(0, '#e8b877')
    body.addColorStop(1, '#c98a4b')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#a86b33'
    ctx.lineWidth = 3
    ctx.stroke()

    // chocolate chips
    ctx.fillStyle = '#5a3418'
    const chips = [
      [-12, -14], [14, -14], [0, -6], [-14, 10], [14, 10], [0, 16],
    ]
    for (const [dx, dy] of chips) {
      ctx.beginPath()
      ctx.arc(dx, dy, 4.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // face
    ctx.fillStyle = '#2b2018'
    ctx.beginPath()
    ctx.arc(-9, -2, 4, 0, Math.PI * 2)
    ctx.arc(9, -2, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(-10, -3, 1.4, 0, Math.PI * 2)
    ctx.arc(8, -3, 1.4, 0, Math.PI * 2)
    ctx.fill()

    // smile
    ctx.strokeStyle = '#2b2018'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 2, 9, 0.15 * Math.PI, 0.85 * Math.PI)
    ctx.stroke()

    // cheeks
    ctx.fillStyle = 'rgba(255,120,140,0.55)'
    ctx.beginPath()
    ctx.arc(-17, 6, 4.5, 0, Math.PI * 2)
    ctx.arc(17, 6, 4.5, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  private drawHud() {
    const { ctx, cssW } = this
    ctx.save()
    ctx.textBaseline = 'top'
    ctx.font = '700 22px system-ui, "Segoe UI", sans-serif'

    const drawBadge = (text: string, x: number, align: CanvasTextAlign) => {
      const w = ctx.measureText(text).width + 28
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath()
      ctx.roundRect(x - (align === 'right' ? w : 0), 12, w, 34, 17)
      ctx.fill()
      ctx.textAlign = align
      ctx.fillStyle = '#fff'
      ctx.fillText(text, x + (align === 'right' ? -14 : 14), 19)
    }

    drawBadge(`점수 ${this.score}`, 14, 'left')
    drawBadge(`최고 ${this.best}`, cssW - 14, 'right')
    ctx.restore()
  }
}
