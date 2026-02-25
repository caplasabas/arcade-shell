import {useState} from 'react'

export function useFocusGrid(size: number) {
  const [index, setIndex] = useState(0)

  return {
    index,
    moveUp: () => setIndex(i => Math.max(0, i - 1)),
    moveDown: () => setIndex(i => Math.min(size - 1, i + 1)),
  }
}
