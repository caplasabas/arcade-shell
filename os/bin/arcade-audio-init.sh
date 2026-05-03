#!/bin/sh
set -eu

ASOUND_CONF=/etc/asound.conf
AUDIO_GAIN="${ARCADE_AUDIO_GAIN:-2.0}"

pick_usb_card() {
  aplay -l 2>/dev/null | sed -n 's/^card [0-9]\+: \([^ ]\+\) \[.*Device.*\]$/\1/p' | head -n 1
}

pick_hdmi_card() {
  aplay -l 2>/dev/null | sed -n '
    s/^card [0-9]\+: \(vc4hdmi0\) \[.*$/\1/p
    s/^card [0-9]\+: \(vc4-hdmi-0\) \[.*$/\1/p
    s/^card [0-9]\+: \(vc4hdmi1\) \[.*$/\1/p
    s/^card [0-9]\+: \(vc4-hdmi-1\) \[.*$/\1/p
  ' | head -n 1
}

pick_any_card() {
  aplay -l 2>/dev/null | sed -n 's/^card [0-9]\+: \([^ ]\+\) \[.*$/\1/p' | head -n 1
}

write_asound_conf() {
  card_name="$1"
  cat >"$ASOUND_CONF" <<EOF
pcm.arcade_hw {
  type hw
  card "$card_name"
  device 0
}

pcm.arcade_output {
  type plug
  slave.pcm "arcade_hw"
}

pcm.arcade_boost {
  type route
  slave.pcm "arcade_output"
  slave.channels 2
  ttable.0.0 $AUDIO_GAIN
  ttable.1.1 $AUDIO_GAIN
}

pcm.!default {
  type plug
  slave.pcm "arcade_boost"
}

ctl.!default {
  type hw
  card "$card_name"
}
EOF
}

set_default_levels() {
  card_name="$1"

  amixer -c "$card_name" sset Speaker 0dB unmute >/dev/null 2>&1 || \
    amixer -c "$card_name" sset PCM 0dB unmute >/dev/null 2>&1 || \
    amixer -c "$card_name" sset Master 0dB unmute >/dev/null 2>&1 || \
    amixer -c "$card_name" sset Speaker 100% unmute >/dev/null 2>&1 || \
    amixer -c "$card_name" sset PCM 100% unmute >/dev/null 2>&1 || \
    amixer -c "$card_name" sset Master 100% unmute >/dev/null 2>&1 || \
    true
}

TARGET_CARD="$(pick_usb_card || true)"
TARGET_KIND="usb"

if [ -z "$TARGET_CARD" ]; then
  TARGET_CARD="$(pick_hdmi_card || true)"
  TARGET_KIND="hdmi"
fi

if [ -z "$TARGET_CARD" ]; then
  TARGET_CARD="$(pick_any_card || true)"
  TARGET_KIND="fallback"
fi

if [ -z "$TARGET_CARD" ]; then
  echo "[AUDIO] no playback cards found; leaving $ASOUND_CONF unchanged"
  exit 0
fi

write_asound_conf "$TARGET_CARD"
echo "[AUDIO] configured ALSA default -> $TARGET_KIND ($TARGET_CARD)"
set_default_levels "$TARGET_CARD"
