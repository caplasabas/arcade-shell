import { Game } from '../App'
import '../styles/tile.css'

type Props = {
  game: Game
  disabled: boolean
  focused: boolean
}

export function GameTile({ game, disabled, focused }: Props) {
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
      <img src={game.art} className={['art', game.type, focused ? 'focused' : ''].join(' ')} />
      <div className="title-band">
        <span className="label">{game.name}</span>
      </div>
      ]
    </div>
  )
}
