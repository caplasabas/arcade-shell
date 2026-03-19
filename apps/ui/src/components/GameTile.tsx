import { useEffect, useState } from 'react'
import { Game } from '../App'
import '../styles/tile.css'

type Props = {
  game: Game
  disabled: boolean
  focused: boolean
}

export function GameTile({ game, disabled, focused }: Props) {
  const [retryCount, setRetryCount] = useState(0)
  const [imgSrc, setImgSrc] = useState(game.art)

  useEffect(() => {
    setRetryCount(0)
    setImgSrc(game.art)
  }, [game.art])

  const handleImageError = () => {
    if (!game.art || retryCount >= 5) return

    const nextRetry = retryCount + 1
    window.setTimeout(() => {
      setRetryCount(nextRetry)
      const separator = game.art.includes('?') ? '&' : '?'
      setImgSrc(`${game.art}${separator}retry=${nextRetry}`)
    }, 1200)
  }

  return (
    <div
      className={[
        'tile',
        game.type,
        disabled ? 'disabled' : '',
        focused ? 'focused' : '',
        game.theme ?? '',
      ].join(' ')}
    >
      {/*{focused && <FocusRing/>}*/}
      <img
        src={imgSrc}
        alt={game.name}
        className={['art', game.type, focused ? 'focused' : ''].join(' ')}
        onError={handleImageError}
      />
      <div className="title-band">
        <span className="label">{game.name}</span>
      </div>
    </div>
  )
}
