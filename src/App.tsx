import { useEffect, useRef, useState } from 'react'
import { CookieRunGame, type GameState } from './game/CookieRunGame'
import './App.css'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<CookieRunGame | null>(null)
  const [state, setState] = useState<GameState>('ready')
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const game = new CookieRunGame(canvas, {
      onStateChange: setState,
      onScoreChange: setScore,
      onBestChange: setBest,
    })
    gameRef.current = game
    return () => {
      game.destroy()
      gameRef.current = null
    }
  }, [])

  const start = () => gameRef.current?.start()

  return (
    <div className="game-shell">
      <div className="game-stage">
        <canvas ref={canvasRef} className="game-canvas" />

        {state === 'ready' && (
          <div className="overlay" onClick={start}>
            <h1 className="title">쿠키런</h1>
            <p className="subtitle">무한 러너</p>
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation()
                start()
              }}
            >
              시작하기
            </button>
            <p className="hint">
              스페이스 / 클릭 = 점프 · 공중에서 한 번 더 점프 가능
            </p>
            <p className="hint dim">최고 기록 {best}</p>
          </div>
        )}

        {state === 'over' && (
          <div className="overlay" onClick={start}>
            <h1 className="title">게임 오버</h1>
            <p className="score-final">{score}점</p>
            <p className="subtitle">
              {score >= best && score > 0 ? '🎉 신기록 달성!' : `최고 기록 ${best}`}
            </p>
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation()
                start()
              }}
            >
              다시 시작
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
