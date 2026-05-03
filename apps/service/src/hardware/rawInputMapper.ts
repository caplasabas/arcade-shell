export interface RawInputMapper {
  resolveKeyName(code: number): number | null
  handleRawEvent(source: string, type: number, code: number, value: number): void
}

export interface RawInputMapperOptions {
  rawButtonMap: Record<number, number>
  evKey: number
  evAbs: number
  onKeyEvent: (source: string, index: number, value: number, code: number) => void
  onAxisEvent: (source: string, code: number, value: number) => void
}

export function createRawInputMapper(options: RawInputMapperOptions): RawInputMapper {
  const resolveKeyName = (code: number) => {
    const index = options.rawButtonMap[code]
    if (index === undefined) return null
    return index
  }

  return {
    resolveKeyName,
    handleRawEvent(source, type, code, value) {
      if (type === options.evKey) {
        const index = resolveKeyName(code)
        if (index === null) return
        options.onKeyEvent(source, index, value, code)
        return
      }

      if (type === options.evAbs) {
        options.onAxisEvent(source, code, value)
      }
    },
  }
}
