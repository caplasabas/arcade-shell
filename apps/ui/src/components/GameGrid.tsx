import { useEffect, useRef } from 'react'
import { Game } from '../App'
import '../styles/grid.css'
import { GameTile } from './GameTile'

type Props = {
  balance: number
  games: Game[]
  focusedIndex: number
  page: number
}

export function GameGrid({ balance, games, focusedIndex, page }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    const tile = grid.children[focusedIndex] as HTMLElement
    if (!tile) return

    tile.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    })
  }, [focusedIndex])

  return (
    <div className="grid-viewport">
      <div className="grid" ref={gridRef}>
        {games.map((g, i) => {
          return (
            <GameTile
              key={g.id}
              game={g}
              disabled={balance < g.price}
              focused={i === focusedIndex}
            />
          )
        })}
      </div>
    </div>
  )
}
