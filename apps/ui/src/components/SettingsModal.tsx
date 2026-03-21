type SettingsItem = 'volume' | 'network' | 'reboot' | 'shutdown'

type Props = {
  selected: SettingsItem
  volumeLabel: string
  volumePercent: number | null
  offline: boolean
}

const SETTINGS_ROWS: Array<{ id: SettingsItem; label: string; hint: string }> = [
  { id: 'volume', label: 'VOLUME', hint: 'LEFT / RIGHT TO ADJUST' },
  { id: 'network', label: 'NETWORK', hint: 'OPEN WIFI SETUP' },
  { id: 'reboot', label: 'REBOOT', hint: 'RESTART THE CABINET' },
  { id: 'shutdown', label: 'SHUTDOWN', hint: 'POWER OFF SAFELY' },
]

export function SettingsModal({ selected, volumeLabel, volumePercent, offline }: Props) {
  return (
    <div className="modal-backdrop modal-backdrop-elevated" role="dialog" aria-modal="true">
      <div className="modal-card modal-card-settings">
        <div className="modal-header">
          <h2>Settings</h2>
        </div>

        <div className="modal-body">
          <div className="settings-list">
            {SETTINGS_ROWS.map(item => {
              const active = item.id === selected
              const value =
                item.id === 'volume' ? volumeLabel : item.id === 'network' && offline ? 'OFFLINE' : ''

              return (
                <div
                  key={item.id}
                  className={['settings-row', active ? 'active' : ''].join(' ').trim()}
                >
                  <span className="settings-label">{item.label}</span>
                  {item.id === 'volume' && volumePercent !== null ? (
                    <div className="settings-volume-block">
                      <div className="settings-volume-value">{value}</div>
                      <div className="settings-volume-meter" aria-hidden="true">
                        <div
                          className="settings-volume-meter-fill"
                          style={{ width: `${volumePercent}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="settings-value">{value}</span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="settings-hint">
            {SETTINGS_ROWS.find(item => item.id === selected)?.hint || 'SELECT AN OPTION'}
          </div>
          <div className="settings-footer">MENU TO CLOSE</div>
        </div>
      </div>
    </div>
  )
}
