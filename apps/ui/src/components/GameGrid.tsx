import { useEffect, useRef } from 'react'
import { Game } from '../App'
import '../styles/grid.css'
import { GameTile } from './GameTile'

type Props = {
  balance: number
  games: Game[]
  focusedIndex: number
  hasOverflow: boolean
}

export function GameGrid({ balance, games, focusedIndex, hasOverflow }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    const grid = gridRef.current
    if (!viewport || !grid) return

    const tile = grid.children[focusedIndex] as HTMLElement
    if (!tile) return

    const viewportWidth = viewport.clientWidth
    const maxScrollLeft = Math.max(0, grid.scrollWidth - viewportWidth)
    const leftPeek = Math.round(viewportWidth * 0.15)
    const rightPeek = hasOverflow ? Math.round(viewportWidth * 0.12) : 24
    const nextScrollLeft = Math.max(0, Math.min(tile.offsetLeft - leftPeek, maxScrollLeft))
    const tileLeft = tile.offsetLeft - viewport.scrollLeft
    const tileRight = tileLeft + tile.offsetWidth

    if (tileLeft < leftPeek || tileRight > viewportWidth - rightPeek) {
      viewport.scrollLeft = nextScrollLeft
    }
  }, [focusedIndex, games.length])

  return (
    <div
      ref={viewportRef}
      className={['grid-viewport', hasOverflow ? 'has-overflow' : ''].join(' ').trim()}
    >
      <div className="grid" ref={gridRef}>
        {games.map((g, i) => {
          const launchBlockedByBalance = g.type === 'arcade' && balance < g.price
          const canAfford = g.type !== 'arcade' || balance >= g.price
          return (
            <GameTile
              key={g.id}
              game={g}
              disabled={launchBlockedByBalance}
              adminDisabled={g.enabled === false}
              focused={i === focusedIndex}
              canAfford={canAfford}
            />
          )
        })}
      </div>
    </div>
  )
}
