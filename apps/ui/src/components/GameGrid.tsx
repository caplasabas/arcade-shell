import {useEffect, useRef} from 'react'
import {Game} from '../App'
import {GameTile} from './GameTile'
import '../styles/grid.css'

type Props = {
  games: Game[]
  focusedIndex: number
  page: number
}

export function GameGrid({games, focusedIndex, page}: Props) {
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    const tile = grid.children[focusedIndex] as HTMLElement
    if (!tile) return

    tile.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    })
  }, [focusedIndex])

  return (
    <div className="grid-viewport">
      <div className="grid" ref={gridRef}>
        {games.map((g, i) => (
          <GameTile
            key={g.id}
            game={g}
            focused={i === focusedIndex}
          />
        ))}
      </div>
    </div>
  )
}
