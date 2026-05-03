// Generated bundle entry for the TypeScript service runtime.
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// input.js
var import_http = __toESM(require("http"), 1);
var import_child_process = require("child_process");
var import_crypto = require("crypto");
var import_dgram = __toESM(require("dgram"), 1);
var import_os = __toESM(require("os"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var SERVICE_DIR = process.env.ARCADE_SERVICE_DIR || process.cwd();
var ARCADE_RUNTIME_DIR = process.env.ARCADE_RUNTIME_DIR || import_path.default.resolve(SERVICE_DIR, "..");
var ROMS_ROOT = process.env.ARCADE_ROMS_DIR || import_path.default.join(ARCADE_RUNTIME_DIR, "roms");
var DIST_DIR = process.env.ARCADE_UI_DIST_DIR || import_path.default.join(ARCADE_RUNTIME_DIR, "ui/dist");
var DEFAULT_RUNTIME_DIR = process.platform === "linux" ? "/dev/shm/arcade-games" : import_path.default.join(import_os.default.tmpdir(), "arcade-games");
var RETROARCH_READY_FILE = process.env.ARCADE_RETRO_READY_FILE || "/tmp/arcade-retro-session.ready";
var RUNTIME_GAMES_DIR = process.env.ARCADE_RUNTIME_GAMES_DIR || DEFAULT_RUNTIME_DIR;
var IS_LINUX = process.platform === "linux";
var IS_MACOS = process.platform === "darwin";
var FORCE_PI_MODE = process.env.ARCADE_FORCE_PI === "1";
var PI_MODEL_PATH = "/sys/firmware/devicetree/base/model";
var IS_PI = FORCE_PI_MODE || IS_LINUX && import_fs.default.existsSync(PI_MODEL_PATH) && (() => {
  try {
    return import_fs.default.readFileSync(PI_MODEL_PATH, "utf8").includes("Raspberry Pi");
  } catch {
    return false;
  }
})();
var DEV_INPUT_BYPASS_ENABLED = !IS_PI && IS_MACOS;
var GPIOCHIP = "gpiochip0";
var HOPPER_PAY_PIN = 17;
var COIN_INHIBIT_PIN = 22;
var HOPPER_TIMEOUT_MS = 6e4;
var HOPPER_NO_PULSE_TIMEOUT_MS = 1e3;
var INTERNET_MONITOR_INTERVAL_MS = 2e3;
var INTERNET_FAIL_THRESHOLD = 2;
var INTERNET_RESTORE_THRESHOLD = 1;
var JOYSTICK_BUTTON_MAP = {
  0: "SPIN",
  1: "BET_DOWN",
  2: "BET_UP",
  3: "AUTO",
  4: "COIN",
  // deposit coin pulses
  5: "WITHDRAW",
  // UI request
  6: "WITHDRAW_COIN",
  // hopper coin slot pulses
  7: "TURBO",
  8: "BUY",
  9: "MENU",
  10: "AUDIO",
  11: "HOPPER_COIN"
};
var RAW_BUTTON_MAP = {
  288: 0,
  289: 1,
  290: 2,
  291: 3,
  292: 4,
  293: 5,
  294: 6,
  295: 7,
  296: 8,
  297: 9,
  298: 10,
  299: 11
};
var buyState = "idle";
var buyConfirmAt = 0;
var BUY_CONFIRM_WINDOW_MS = 5e3;
var HOPPER_TOPUP_COIN_VALUE = 20;
var ARCADE_TIME_PURCHASE_MS = 10 * 60 * 1e3;
var COIN_IDLE_GAP_MS = 220;
var COIN_PESO_BY_PULSE_COUNT = {
  1: 5,
  2: 10,
  4: 20
};
var shuttingDown = false;
var player1 = null;
var player2 = null;
var depositPulseCount = 0;
var depositIdleTimer = null;
var depositLastPulseTime = 0;
var depositStartTime = 0;
var depositPulseGaps = [];
var hopperActive = false;
var hopperTarget = 0;
var hopperDispensed = 0;
var hopperTimeout = null;
var hopperNoPulseTimeout = null;
var hopperLastPulseAt = 0;
var activeWithdrawalContext = null;
var withdrawRequestInFlight = false;
var outstandingWithdrawalAccountingAmount = 0;
var serverInstance = null;
var virtualP1 = null;
var virtualP2 = null;
var VIRTUAL_DEVICE_STAGGER_MS = 650;
var retroarchActive = false;
var retroarchProcess = null;
var retroarchStopping = false;
var lastExitTime = 0;
var retroarchStartedAt = 0;
var retroarchLogFd = null;
var retroarchStopTermTimer = null;
var retroarchStopForceTimer = null;
var pendingUiFallbackTimer = null;
var retroarchExitConfirmUntil = 0;
var retroarchCurrentGameId = null;
var lastGameInputAt = 0;
var lastExitedGameId = null;
var arcadeShellUpdateChild = null;
var arcadeShellUpdateTriggered = false;
var arcadeShellUpdateState = {
  status: "idle",
  phase: null,
  label: "",
  detail: null,
  startedAt: null,
  finishedAt: null,
  message: "",
  reason: null,
  exitCode: null
};
var arcadeBalancePushFloor = null;
var arcadeBalancePushFloorUntil = 0;
var arcadeTimePersistTimer = null;
var arcadeTimePersistInFlight = false;
var arcadeTimePersistRequestedMs = null;
var arcadeTimePersistCommittedMs = null;
async function withTimeout(promise, ms = 5e3) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
  return Promise.race([promise, timeout]);
}
function noteArcadeBalancePush(nextBalance) {
  if (!Number.isFinite(nextBalance)) return;
  arcadeBalancePushFloor = toMoney(nextBalance, 0);
  arcadeBalancePushFloorUntil = Date.now() + 8e3;
}
function clearArcadeBalancePushFloor() {
  arcadeBalancePushFloor = null;
  arcadeBalancePushFloorUntil = 0;
}
function clearArcadeTimePersistTimer() {
  if (arcadeTimePersistTimer === null) return;
  clearTimeout(arcadeTimePersistTimer);
  arcadeTimePersistTimer = null;
}
function shouldDeferArcadeBalanceSync(nextBalance) {
  if (!Number.isFinite(nextBalance)) return false;
  if (!Number.isFinite(arcadeBalancePushFloor)) return false;
  if (Date.now() > arcadeBalancePushFloorUntil) {
    clearArcadeBalancePushFloor();
    return false;
  }
  return nextBalance < arcadeBalancePushFloor;
}
function isRetroarchSessionReady() {
  if (!retroarchActive) return false;
  if (RETROARCH_TTY_X_SESSION) return import_fs.default.existsSync(RETROARCH_READY_FILE);
  if (!retroarchStartedAt) return false;
  return Date.now() - retroarchStartedAt >= RETROARCH_START_INPUT_GUARD_MS;
}
function formatArcadeTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    (0, import_child_process.execFile)(
      file,
      args,
      {
        maxBuffer: 1024 * 1024,
        ...options
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}
async function requestJsonWithCurl(url, { method = "GET", body = null, headers = {}, timeoutMs = 2500 } = {}) {
  const args = [
    "-sS",
    "-L",
    "--max-time",
    String(Math.max(1, Math.ceil(timeoutMs / 1e3))),
    "--write-out",
    "\n%{http_code}"
  ];
  if (method && method !== "GET") {
    args.push("-X", method);
  }
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (body !== null && body !== void 0) {
    args.push("--data-binary", typeof body === "string" ? body : JSON.stringify(body));
  }
  args.push(url);
  const { stdout } = await execFileAsync("curl", args);
  const text = String(stdout || "");
  const splitIndex = text.lastIndexOf("\n");
  const responseText = splitIndex >= 0 ? text.slice(0, splitIndex) : text;
  const statusRaw = splitIndex >= 0 ? text.slice(splitIndex + 1).trim() : "";
  const status = Number.parseInt(statusRaw, 10);
  if (!Number.isFinite(status)) {
    throw new Error(`curl response missing status for ${url}`);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    text: responseText,
    json() {
      return responseText ? JSON.parse(responseText) : null;
    }
  };
}
var GAME_VT = process.env.ARCADE_GAME_VT || "1";
var UI_VT = process.env.ARCADE_UI_VT || "2";
var SPLASH_VT = process.env.ARCADE_SPLASH_VT || "3";
var RETROARCH_STOP_GRACE_MS = 3e3;
var RETROARCH_LOG_PATH = "/tmp/retroarch.log";
var RETROARCH_TERM_FALLBACK_MS = 1200;
var SINGLE_X_MODE = process.env.RETROARCH_SINGLE_X === "1";
var RETROARCH_USE_TTY_MODE = !SINGLE_X_MODE && process.env.RETROARCH_TTY_MODE === "1";
var RETROARCH_TTY_X_SESSION = !SINGLE_X_MODE && process.env.RETROARCH_TTY_X_SESSION === "1";
var RETROARCH_TTY_X_PREWARM = !SINGLE_X_MODE && process.env.RETROARCH_TTY_X_PREWARM !== "0";
var RETROARCH_RUN_USER = process.env.RETROARCH_RUN_USER || "arcade1";
var RETROARCH_RUN_UID = String(process.env.RETROARCH_RUN_UID || "1000");
var RETROARCH_RUN_HOME = process.env.RETROARCH_RUN_HOME || `/home/${RETROARCH_RUN_USER}`;
var RETROARCH_RUNTIME_DIR = process.env.RETROARCH_XDG_RUNTIME_DIR || `/run/user/${RETROARCH_RUN_UID}`;
var RETROARCH_DBUS_ADDRESS = process.env.RETROARCH_DBUS_ADDRESS || `unix:path=${RETROARCH_RUNTIME_DIR}/bus`;
var RETROARCH_PULSE_SERVER = process.env.RETROARCH_PULSE_SERVER || `unix:${RETROARCH_RUNTIME_DIR}/pulse/native`;
var RETROARCH_BIN = process.env.ARCADE_RETRO_BIN || "/usr/bin/retroarch";
var RETROARCH_USE_DBUS_RUN_SESSION = process.env.RETROARCH_USE_DBUS_RUN_SESSION === "1";
var RETROARCH_PRIMARY_INPUT = String(process.env.RETROARCH_PRIMARY_INPUT || "P1").toUpperCase();
var CASINO_MENU_EXITS_RETROARCH = process.env.CASINO_MENU_EXITS_RETROARCH !== "0";
var RETROARCH_P2_SWAP_AXES = process.env.RETROARCH_P2_SWAP_AXES === "1";
var SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
var SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
console.log("[RETRO MODE]", {
  SINGLE_X_MODE,
  RETROARCH_USE_TTY_MODE,
  RETROARCH_TTY_X_SESSION,
  RETROARCH_P2_SWAP_AXES,
  DISPLAY: process.env.DISPLAY || null,
  XAUTHORITY: process.env.XAUTHORITY || null
});
function parseNonNegativeMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
var RETROARCH_EXIT_GUARD_MS = parseNonNegativeMs(process.env.RETROARCH_EXIT_GUARD_MS, 1500);
var RETROARCH_START_INPUT_GUARD_MS = parseNonNegativeMs(
  process.env.RETROARCH_START_INPUT_GUARD_MS,
  3500
);
var RETROARCH_EXIT_CONFIRM_WINDOW_MS = parseNonNegativeMs(
  process.env.RETROARCH_EXIT_CONFIRM_WINDOW_MS,
  2500
);
var RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS = parseNonNegativeMs(
  process.env.RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS,
  1500
);
var RETROARCH_CONFIG_PATH = process.env.RETROARCH_CONFIG_PATH || "";
var RESTART_UI_ON_EXIT = ["1", "true", "yes", "on"].includes(
  String(process.env.ARCADE_RESTART_UI_ON_GAME_EXIT || "").toLowerCase()
);
var KEEP_UI_ALIVE_DURING_TTY_X = process.env.ARCADE_UI_KEEPALIVE_DURING_TTY_X !== "0";
var USE_SPLASH_TRANSITIONS = process.env.ARCADE_SPLASH_TRANSITIONS === "1";
var UI_RESTART_COOLDOWN_MS = parseNonNegativeMs(process.env.ARCADE_UI_RESTART_COOLDOWN_MS, 4e3);
var LIBRETRO_DIR_CANDIDATES = [
  process.env.RETROARCH_CORE_DIR,
  "/usr/lib/aarch64-linux-gnu/libretro",
  "/usr/lib/arm-linux-gnueabihf/libretro",
  "/usr/lib/libretro"
].filter(Boolean);
var PS1_CORE_ALIASES = String(
  process.env.PS1_CORE_PRIORITY || "pcsx_rearmed,mednafen_psx,beetle_psx"
).split(",").map((v) => v.trim().toLowerCase().replace(/-/g, "_")).filter(Boolean);
var ARCADE_LIFE_PRICE_DEFAULT = (() => {
  const parsed = Number(process.env.ARCADE_LIFE_PRICE_DEFAULT || 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
})();
var ARCADE_LIFE_FAIL_OPEN = process.env.ARCADE_LIFE_FAIL_OPEN === "1";
var ARCADE_RETRO_OSD_ENABLED = process.env.ARCADE_RETRO_OSD !== "0";
var RETROARCH_NETCMD_HOST = process.env.RETROARCH_NETCMD_HOST || "127.0.0.1";
var RETROARCH_NETCMD_PORT = Number(process.env.RETROARCH_NETCMD_PORT || 55355);
var RETROARCH_OSD_COMMAND = String(process.env.RETROARCH_OSD_COMMAND || "AUTO").trim().toUpperCase();
var ARCADE_RETRO_OSD_COOLDOWN_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_COOLDOWN_MS,
  750
);
var ARCADE_RETRO_OSD_RETRY_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_RETRY_INTERVAL_MS,
  180
);
var ARCADE_RETRO_OSD_RETRY_COUNT = (() => {
  const parsed = Number(process.env.ARCADE_RETRO_OSD_RETRY_COUNT || 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(8, Math.round(parsed)));
})();
var ARCADE_RETRO_OSD_PROMPT_PERSIST = process.env.ARCADE_RETRO_OSD_PROMPT_PERSIST !== "0";
var ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS,
  1200
);
var ARCADE_RETRO_OSD_PROMPT_BLINK = process.env.ARCADE_RETRO_OSD_PROMPT_BLINK === "1";
var ARCADE_RETRO_OSD_STYLE = (() => {
  const style = String(process.env.ARCADE_RETRO_OSD_STYLE || "footer").toLowerCase().trim();
  if (style === "hud" || style === "legacy" || style === "footer") return style;
  return "footer";
})();
var ARCADE_RETRO_OSD_LABEL = String(process.env.ARCADE_RETRO_OSD_LABEL || "").replace(/\s+/g, " ").trim();
var ARCADE_RETRO_OSD_SHOW_SESSION_STATS = process.env.ARCADE_RETRO_OSD_SHOW_SESSION_STATS !== "0";
var ARCADE_RETRO_OVERLAY_HIDE_AFTER_CREDIT_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OVERLAY_HIDE_AFTER_CREDIT_MS,
  1e4
);
var ARCADE_LIFE_CONTINUE_SECONDS = (() => {
  const parsed = Number(process.env.ARCADE_LIFE_CONTINUE_SECONDS || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(30, Math.round(parsed)));
})();
var ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS,
  1e3
);
var ARCADE_LIFE_PURCHASE_BUTTON_INDEXES = (() => {
  const raw = String(process.env.ARCADE_LIFE_PURCHASE_BUTTON_INDEXES || "8");
  const parsed = raw.split(",").map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v >= 0 && v <= 31);
  if (parsed.length > 0) return new Set(parsed);
  return /* @__PURE__ */ new Set([8]);
})();
var ARCADE_LIFE_PURCHASE_LABEL = String(process.env.ARCADE_LIFE_PURCHASE_LABEL || "Buy").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 16) || "Buy";
var START_BUTTON_INDEXES = /* @__PURE__ */ new Set([7, 9]);
var RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS = parseNonNegativeMs(
  process.env.RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS,
  120
);
var lastUiVT = UI_VT;
var lastUiRestartAt = 0;
var chromiumUiHidden = false;
var arcadeUiStoppedForRetroarch = false;
var splashStartedForRetroarch = false;
var retroXWarmRequested = false;
var retroarchReadyWatchTimer = null;
function getXClientEnv() {
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ":0",
    XAUTHORITY: process.env.XAUTHORITY || `${RETROARCH_RUN_HOME}/.Xauthority`,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || RETROARCH_RUNTIME_DIR
  };
}
function runXClientCommand(command, args, label) {
  try {
    const proc = (0, import_child_process.spawn)(command, args, {
      env: getXClientEnv(),
      detached: true,
      stdio: "ignore"
    });
    proc.on("error", (err) => {
      console.warn(`[UI] ${label} failed: ${err.message}`);
    });
    proc.unref();
    return true;
  } catch (err) {
    console.warn(`[UI] ${label} failed: ${err.message}`);
    return false;
  }
}
function stopArcadeUiForRetroarch() {
  if (!RETROARCH_TTY_X_SESSION) return;
  if (arcadeUiStoppedForRetroarch) return;
  if (KEEP_UI_ALIVE_DURING_TTY_X) {
    console.log("[UI] keeping arcade-ui.service alive during tty X RetroArch launch");
    return;
  }
  const proc = (0, import_child_process.spawn)("systemctl", ["stop", "--no-block", "arcade-ui.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  arcadeUiStoppedForRetroarch = true;
  console.log("[UI] stop requested before tty X RetroArch launch");
}
function restartArcadeUiAfterRetroarch(reason, forceRestart = false) {
  if (!RETROARCH_TTY_X_SESSION) return;
  if (KEEP_UI_ALIVE_DURING_TTY_X && !forceRestart) {
    console.log(`[UI] arcade-ui.service kept alive during tty X RetroArch session (${reason})`);
    return;
  }
  if (!forceRestart && !arcadeUiStoppedForRetroarch) return;
  arcadeUiStoppedForRetroarch = false;
  const action = forceRestart ? "restart" : "start";
  const proc = (0, import_child_process.spawn)("systemctl", [action, "--no-block", "arcade-ui.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  console.log(`[UI] ${action} requested after tty X RetroArch exit (${reason})`);
}
function ensureRetroXWarm(reason = "boot") {
  if (!RETROARCH_TTY_X_SESSION) return;
  if (!RETROARCH_TTY_X_PREWARM) return;
  if (retroXWarmRequested) return;
  const proc = (0, import_child_process.spawn)("systemctl", ["start", "--no-block", "arcade-retro-x.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  retroXWarmRequested = true;
  console.log(`[RETRO-X] warm start requested (${reason})`);
  if (reason === "boot") {
    setTimeout(() => {
      switchToVTWithRetry(getTargetUiVT(), "boot-ui");
      setTimeout(() => switchToVTWithRetry(getTargetUiVT(), "boot-ui-post"), 250);
    }, 3e3);
  }
}
setInterval(async () => {
  if (internetState !== "ok") return;
  if (flushingOfflineQueue) return;
  if (offlineQueue.length === 0) return;
  flushingOfflineQueue = true;
  while (offlineQueue.length > 0) {
    const item = offlineQueue[0];
    try {
      const res = await item.fn(item.payload);
      if (!res || res.ok === false) {
        throw new Error("flush failed");
      }
      offlineQueue.shift();
      if (typeof item.onSuccess === "function") {
        try {
          item.onSuccess(res);
        } catch (error) {
          console.error("[RPC] offline success hook failed", error?.message || error);
        }
      }
    } catch {
      break;
    }
  }
  flushingOfflineQueue = false;
}, 2e3);
function startSplashForRetroarch() {
  if (!USE_SPLASH_TRANSITIONS) return;
  if (splashStartedForRetroarch) return;
  const proc = (0, import_child_process.spawn)("systemctl", ["start", "--no-block", "arcade-splash.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  splashStartedForRetroarch = true;
  console.log("[SPLASH] start requested for RetroArch transition");
}
function stopSplashForRetroarch(reason) {
  if (!splashStartedForRetroarch) return;
  splashStartedForRetroarch = false;
  const proc = (0, import_child_process.spawn)("systemctl", ["stop", "--no-block", "arcade-splash.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  console.log(`[SPLASH] stop requested after RetroArch transition (${reason})`);
}
function ensureSplashReady(reason = "boot") {
  if (!USE_SPLASH_TRANSITIONS) return;
  if (splashStartedForRetroarch) return;
  const proc = (0, import_child_process.spawn)("systemctl", ["start", "--no-block", "arcade-splash.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  splashStartedForRetroarch = true;
  console.log(`[SPLASH] warm start requested (${reason})`);
}
function clearRetroarchReadyWatch() {
  if (retroarchReadyWatchTimer === null) return;
  clearTimeout(retroarchReadyWatchTimer);
  retroarchReadyWatchTimer = null;
}
function scheduleRetroarchReadyWatch(onReady) {
  if (!RETROARCH_TTY_X_SESSION) return;
  clearRetroarchReadyWatch();
  const startedAt = Date.now();
  const READY_WATCH_TIMEOUT_MS = 2e4;
  const READY_WATCH_INTERVAL_MS = 120;
  const tick = () => {
    if (!retroarchActive || !retroarchProcess) {
      clearRetroarchReadyWatch();
      return;
    }
    if (import_fs.default.existsSync(RETROARCH_READY_FILE)) {
      clearRetroarchReadyWatch();
      try {
        onReady();
      } catch (error) {
        console.error("[RETROARCH] ready handoff failed", error);
      }
      return;
    }
    if (Date.now() - startedAt >= READY_WATCH_TIMEOUT_MS) {
      clearRetroarchReadyWatch();
      console.warn(
        `[RETROARCH] ready file not observed within ${READY_WATCH_TIMEOUT_MS}ms: ${RETROARCH_READY_FILE}`
      );
      return;
    }
    retroarchReadyWatchTimer = setTimeout(tick, READY_WATCH_INTERVAL_MS);
  };
  retroarchReadyWatchTimer = setTimeout(tick, READY_WATCH_INTERVAL_MS);
}
function hasCommand(name) {
  const result = (0, import_child_process.spawnSync)("sh", ["-lc", `command -v ${name} >/dev/null 2>&1`], {
    stdio: "ignore"
  });
  return result.status === 0;
}
function hideChromiumUiForRetroarch() {
  if (!SINGLE_X_MODE) return;
  if (chromiumUiHidden) return;
  let attempted = false;
  if (hasCommand("xdotool")) {
    attempted = true;
    runXClientCommand(
      "sh",
      [
        "-lc",
        "xdotool search --onlyvisible --class chromium windowunmap %@ >/dev/null 2>&1 || true"
      ],
      "xdotool minimize chromium"
    );
  }
  if (hasCommand("wmctrl")) {
    attempted = true;
    runXClientCommand(
      "sh",
      ["-lc", "wmctrl -x -r chromium.Chromium -b add,hidden >/dev/null 2>&1 || true"],
      "wmctrl hide chromium"
    );
  }
  if (attempted) {
    chromiumUiHidden = true;
    console.log("[UI] Chromium hide requested before RetroArch launch");
  } else {
    console.log("[UI] Chromium hide skipped (xdotool/wmctrl not installed)");
  }
}
var offlineQueue = [];
var flushingOfflineQueue = false;
var MAX_OFFLINE_QUEUE = 200;
function enqueueOffline(item) {
  if (offlineQueue.length >= MAX_OFFLINE_QUEUE) {
    const protectedItem = Boolean(item?.protectFromDrop);
    const dropIndex = protectedItem ? offlineQueue.findIndex((entry) => !entry?.protectFromDrop) : 0;
    if (dropIndex >= 0) {
      offlineQueue.splice(dropIndex, 1);
    } else if (!protectedItem) {
      return;
    }
  }
  offlineQueue.push(item);
}
function hasInternet() {
  return internetState === "ok";
}
async function safeRpcCall(fn, payload, context = "rpc", options = {}) {
  if (!hasInternet()) {
    enqueueOffline({
      fn,
      payload,
      onSuccess: options?.onSuccess,
      protectFromDrop: Boolean(options?.protectFromDrop)
    });
    console.warn(`[RPC] queued (${context})`, { reason: "offline" });
    return { queued: true };
  }
  try {
    const res = await fn(payload);
    if (!res || res.ok === false) {
      throw new Error(`RPC failed (${res?.status})`);
    }
    return res;
  } catch (err) {
    enqueueOffline({
      fn,
      payload,
      onSuccess: options?.onSuccess,
      protectFromDrop: Boolean(options?.protectFromDrop)
    });
    console.warn(`[RPC] queued (${context})`, {
      reason: err?.message || err
    });
    return { queued: true };
  }
}
function restoreChromiumUiAfterRetroarch() {
  if (!SINGLE_X_MODE) return;
  if (!chromiumUiHidden) return;
  let attempted = false;
  if (hasCommand("xdotool")) {
    attempted = true;
    runXClientCommand(
      "sh",
      [
        "-lc",
        "xdotool search --class chromium windowmap %@ windowraise %@ >/dev/null 2>&1 || true"
      ],
      "xdotool restore chromium"
    );
  }
  if (hasCommand("wmctrl")) {
    attempted = true;
    runXClientCommand(
      "sh",
      [
        "-lc",
        "wmctrl -x -r chromium.Chromium -b remove,hidden >/dev/null 2>&1 || true; wmctrl -x -a chromium.Chromium >/dev/null 2>&1 || true"
      ],
      "wmctrl restore chromium"
    );
  }
  chromiumUiHidden = false;
  if (attempted) {
    console.log("[UI] Chromium restore requested after RetroArch exit");
  }
}
var arcadeSession = null;
var lastGameplayInputAt = { P1: 0, P2: 0 };
var retroarchStartPressState = {
  P1: { pressed: false, sent: false, suppressed: false, pressedAt: 0, timer: null },
  P2: { pressed: false, sent: false, suppressed: false, pressedAt: 0, timer: null }
};
var arcadeTimeLoopTimer = null;
var ARCADE_TIME_GRACE_MS = 0;
var arcadeTimeoutPauseApplied = false;
var arcadeTimeoutPauseConfirmed = false;
var arcadeTimeoutPausePending = false;
var gameOverState = { P1: false, P2: false };
var lastArcadeOsdMessage = "";
var lastArcadeOsdAt = 0;
var arcadeContinueCountdownTimers = { P1: null, P2: null };
var arcadePromptLoopTimer = null;
var buyIntentState = "idle";
var buyIntentUntil = 0;
var arcadePromptBlinkPhase = false;
var lastArcadePromptLoopMessage = "";
var lastArcadePromptLoopSentAt = 0;
var arcadeBalanceSyncTimer = null;
var arcadeBalanceSyncInFlight = false;
function getActiveVT() {
  if (!RETROARCH_USE_TTY_MODE) return null;
  if (!IS_PI) return null;
  const result = (0, import_child_process.spawnSync)("fgconsole", [], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const value = String(result.stdout || "").trim();
  return value || null;
}
function getTargetUiVT() {
  return lastUiVT || UI_VT;
}
console.log(`
ARCADE INPUT SERVICE
--------------------
USB Encoder : /dev/input/casino
GPIO Chip   : ${GPIOCHIP}
Runtime Mode: ${IS_PI ? "Raspberry Pi (hardware)" : `compat (${process.platform})`}
Display Mode : ${SINGLE_X_MODE ? "single-x(:0)" : `tty ui=${UI_VT} game=${GAME_VT}`}
Splash VT    : ${SPLASH_VT}
UI Keepalive : ${KEEP_UI_ALIVE_DURING_TTY_X ? "tty-x on" : "tty-x off"}
Splash Transit: ${USE_SPLASH_TRANSITIONS ? "enabled" : "disabled"}
Retro P1 In : ${RETROARCH_PRIMARY_INPUT}
Casino Exit : ${CASINO_MENU_EXITS_RETROARCH ? "enabled" : "disabled"}
Exit Guard  : ${RETROARCH_EXIT_GUARD_MS}ms
Start Guard : ${RETROARCH_START_INPUT_GUARD_MS}ms
Exit Confirm: ${RETROARCH_EXIT_CONFIRM_WINDOW_MS}ms
Exit Cooldown: ${RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS}ms
RA Config   : ${RETROARCH_CONFIG_PATH || "(default)"}
RA Binary   : ${RETROARCH_BIN}
RA OSD Cmd  : ${ARCADE_RETRO_OSD_ENABLED ? RETROARCH_OSD_COMMAND : "disabled"} (${ARCADE_RETRO_OSD_COOLDOWN_MS}ms)
RA OSD Retry: ${ARCADE_RETRO_OSD_RETRY_COUNT}x/${ARCADE_RETRO_OSD_RETRY_INTERVAL_MS}ms
RA OSD Prompt: ${ARCADE_RETRO_OSD_PROMPT_PERSIST ? `on/${ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS}ms` : "off"} (${ARCADE_RETRO_OSD_PROMPT_BLINK ? "blink" : "steady"})
RA OSD Style: ${ARCADE_RETRO_OSD_STYLE}${ARCADE_RETRO_OSD_STYLE === "hud" ? ` (${ARCADE_RETRO_OSD_LABEL || "HUD"})` : ""}
Continue OSD: ${ARCADE_LIFE_CONTINUE_SECONDS > 0 ? `${ARCADE_LIFE_CONTINUE_SECONDS}s` : "disabled"}
Life Buy Btn : ${[...ARCADE_LIFE_PURCHASE_BUTTON_INDEXES].join(",")} (${ARCADE_LIFE_PURCHASE_LABEL})
Life Bal Sync: ${hasSupabaseRpcConfig() ? `on/${ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS}ms` : "off"}
UI Restart  : ${RESTART_UI_ON_EXIT ? "enabled" : "disabled"} (${UI_RESTART_COOLDOWN_MS}ms)
Arcade Time : default=\u20B1${ARCADE_LIFE_PRICE_DEFAULT} failOpen=${ARCADE_LIFE_FAIL_OPEN ? "yes" : "no"}
Supabase RPC: ${SUPABASE_URL ? "configured" : "missing"} / key=${SUPABASE_SERVICE_KEY ? "set" : "missing"}

Ctrl+C to exit
`);
ensureSplashReady();
ensureRetroXWarm();
var sseClients = /* @__PURE__ */ new Set();
function sendSse(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}

`);
    return true;
  } catch (err) {
    console.error("[SSE SEND ERROR]", err.message);
    return false;
  }
}
function broadcast(payload) {
  for (const client of [...sseClients]) {
    if (!sendSse(client, payload)) {
      try {
        client.end();
      } catch {
      }
      sseClients.delete(client);
    }
  }
}
async function dispatch(payload) {
  if (shuttingDown) return;
  try {
    console.log("[SEND]", payload);
    broadcast(payload);
  } catch (err) {
    console.error("[DISPATCH ERROR]", err.message);
  }
}
function hasSupabaseRpcConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}
function getSupabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json"
  };
}
function toMoney(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed * 100) / 100);
}
async function ensureDeviceRegistered(deviceId) {
  if (!hasSupabaseRpcConfig()) return;
  const safeDeviceId = String(deviceId || "").trim();
  if (!safeDeviceId) return;
  const url = `${SUPABASE_URL}/rest/v1/devices`;
  const res = await requestJsonWithCurl(url, {
    method: "POST",
    headers: {
      ...getSupabaseHeaders(),
      Prefer: "resolution=merge-duplicates"
    },
    body: {
      device_id: safeDeviceId
    },
    timeoutMs: 2500
  });
  if (!res.ok) {
    throw new Error(`device register failed (${res.status})`);
  }
  console.log("[DEVICE] ensured registered", safeDeviceId);
}
async function updateDeviceLatency(latencyMs) {
  const now = Date.now();
  if (!networkConfirmed || now - lastLatencyUpdateTime < LATENCY_UPDATE_INTERVAL_MS) return;
  lastLatencyUpdateTime = now;
  const safeDeviceId = String(DEVICE_ID || "").trim();
  if (!hasSupabaseRpcConfig() || !safeDeviceId || !Number.isFinite(latencyMs)) return;
  try {
    await requestJsonWithCurl(
      `${SUPABASE_URL}/rest/v1/devices?device_id=eq.${encodeURIComponent(safeDeviceId)}`,
      {
        method: "PATCH",
        headers: {
          ...getSupabaseHeaders(),
          Prefer: "return=minimal"
        },
        body: {
          last_network_latency: Math.max(0, Math.round(latencyMs))
        },
        timeoutMs: 2e3
      }
    );
  } catch (error) {
    console.warn("[DEVICE] latency update failed", error?.message || error);
  }
}
async function fetchDeviceFinancialState(deviceId = DEVICE_ID) {
  if (!hasSupabaseRpcConfig()) return null;
  const safeDeviceId = String(deviceId || "").trim();
  if (!safeDeviceId) return null;
  const buildDeviceStateUrl = (includeWithdrawEnabled) => `${SUPABASE_URL}/rest/v1/devices?select=${encodeURIComponent(
    [
      "device_id",
      "deployment_mode",
      "balance",
      "hopper_balance",
      "arcade_credit",
      "arcade_time_ms",
      includeWithdrawEnabled ? "withdraw_enabled" : null
    ].filter(Boolean).join(",")
  )}&device_id=eq.${encodeURIComponent(safeDeviceId)}&limit=1`;
  const requestState = async (includeWithdrawEnabled) => {
    const response2 = await requestJsonWithCurl(buildDeviceStateUrl(includeWithdrawEnabled), {
      method: "GET",
      headers: getSupabaseHeaders(),
      timeoutMs: 2500
    });
    if (includeWithdrawEnabled && !response2.ok && response2.status === 400 && String(response2.text || "").toLowerCase().includes("withdraw_enabled")) {
      return requestState(false);
    }
    return response2;
  };
  const response = await requestState(true);
  if (!response.ok) {
    console.error("[DEVICE] state fetch failed", {
      deviceId: safeDeviceId,
      status: response.status,
      body: response.text
    });
    throw new Error(`device state fetch failed (${response.status})`);
  }
  const rows = response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    console.warn("[DEVICE] not found, attempting auto-register");
    try {
      await ensureDeviceRegistered(deviceId);
    } catch (err) {
      console.error("[DEVICE] auto-register failed", err);
      throw new Error("DEVICE_NOT_FOUND");
    }
    const retry = await requestState(true);
    if (!retry.ok) {
      console.error("[DEVICE] state fetch retry failed", {
        deviceId: safeDeviceId,
        status: retry.status,
        body: retry.text
      });
      throw new Error(`device state fetch failed (${retry.status})`);
    }
    const retryRows = retry.json();
    const retryRow = Array.isArray(retryRows) ? retryRows[0] : null;
    if (!retryRow) {
      throw new Error("DEVICE_NOT_FOUND_AFTER_REGISTER");
    }
    return {
      deviceId: String(retryRow.device_id || safeDeviceId),
      deploymentMode: retryRow.deployment_mode === null || retryRow.deployment_mode === void 0 ? null : String(retryRow.deployment_mode || "").trim() || null,
      balance: toMoney(retryRow.balance, 0),
      hopperBalance: toMoney(retryRow.hopper_balance, 0),
      arcadeCredit: Number(retryRow.arcade_credit || 0),
      arcadeTimeMs: Math.max(0, Number(retryRow.arcade_time_ms || 0)),
      withdrawEnabled: Boolean(retryRow.withdraw_enabled)
    };
  }
  return {
    deviceId: String(row.device_id || safeDeviceId),
    deploymentMode: row.deployment_mode === null || row.deployment_mode === void 0 ? null : String(row.deployment_mode || "").trim() || null,
    balance: toMoney(row.balance, 0),
    hopperBalance: toMoney(row.hopper_balance, 0),
    arcadeCredit: Number(row.arcade_credit || 0),
    arcadeTimeMs: Math.max(0, Number(row.arcade_time_ms || 0)),
    withdrawEnabled: Boolean(row.withdraw_enabled)
  };
}
function getMaxWithdrawalAmountForHopperBalance(hopperBalance) {
  const safeHopperBalance = toMoney(hopperBalance, 0);
  const STEP = 20;
  if (safeHopperBalance <= 0) return 0;
  return Math.floor(safeHopperBalance * 0.3 / STEP) * STEP;
}
async function recordWithdrawalDispense(amount) {
  const dispenseAmount = toMoney(amount, 0);
  if (dispenseAmount <= 0 || !hasSupabaseRpcConfig()) return;
  const context = activeWithdrawalContext;
  const requestId = context?.requestId || `withdraw-${Date.now()}`;
  const requestedAmount = toMoney(context?.requestedAmount, dispenseAmount);
  const nextDispensedTotal = toMoney(
    (context?.dispensedTotal || 0) + dispenseAmount,
    dispenseAmount
  );
  if (context) {
    context.dispensedTotal = nextDispensedTotal;
  }
  const eventTs = (/* @__PURE__ */ new Date()).toISOString();
  const metadata = {
    source: "hopper",
    request_id: requestId,
    requested_amount: requestedAmount,
    dispensed_total: nextDispensedTotal
  };
  const releaseReservedAmount = () => {
    outstandingWithdrawalAccountingAmount = toMoney(
      Math.max(0, outstandingWithdrawalAccountingAmount - dispenseAmount),
      0
    );
  };
  try {
    const result = await safeRpcCall(
      (body) => requestJsonWithCurl(`${SUPABASE_URL}/rest/v1/rpc/apply_metric_event`, {
        method: "POST",
        headers: getSupabaseHeaders(),
        timeoutMs: 3500,
        body
      }),
      {
        p_device_id: DEVICE_ID,
        p_event_type: "withdrawal",
        p_amount: dispenseAmount,
        p_event_ts: eventTs,
        p_metadata: metadata,
        p_write_ledger: true
      },
      "withdrawal-dispense",
      { onSuccess: releaseReservedAmount, protectFromDrop: true }
    );
    if (!result?.queued) {
      releaseReservedAmount();
    }
  } catch (error) {
    console.error("[WITHDRAW] dispense accounting failed", {
      amount: dispenseAmount,
      requestId,
      error: error?.message || error
    });
  }
}
async function recordHopperTopup(amount) {
  const topupAmount = toMoney(amount, 0);
  if (topupAmount <= 0 || !hasSupabaseRpcConfig()) return;
  const eventTs = (/* @__PURE__ */ new Date()).toISOString();
  const metadata = {
    source: "hopper_topup_slot"
  };
  try {
    await safeRpcCall(
      (body) => requestJsonWithCurl(`${SUPABASE_URL}/rest/v1/rpc/apply_metric_event`, {
        method: "POST",
        headers: getSupabaseHeaders(),
        timeoutMs: 3500,
        body
      }),
      {
        p_device_id: DEVICE_ID,
        p_event_type: "hopper_in",
        p_amount: topupAmount,
        p_event_ts: eventTs,
        p_metadata: metadata,
        p_write_ledger: true
      },
      "hopper-topup"
    );
  } catch (error) {
    console.error("[HOPPER] topup accounting failed", {
      amount: topupAmount,
      error: error?.message || error
    });
  }
}
async function recordCoinDeposit(amount, extraMetadata = {}) {
  const depositAmount = toMoney(amount, 0);
  if (depositAmount <= 0) return;
  if (!hasSupabaseRpcConfig()) {
    console.warn("[COIN] deposit accounting skipped", {
      amount: depositAmount,
      reason: "missing_supabase_rpc_config",
      supabaseUrlConfigured: Boolean(SUPABASE_URL),
      supabaseServiceKeyConfigured: Boolean(SUPABASE_SERVICE_KEY)
    });
    return;
  }
  const eventTs = (/* @__PURE__ */ new Date()).toISOString();
  const metadata = {
    source: "coin_acceptor",
    ...extraMetadata
  };
  try {
    const result = await safeRpcCall(
      (body) => requestJsonWithCurl(`${SUPABASE_URL}/rest/v1/rpc/apply_metric_event`, {
        method: "POST",
        headers: getSupabaseHeaders(),
        timeoutMs: 3500,
        body
      }),
      {
        p_device_id: DEVICE_ID,
        p_event_type: "coins_in",
        p_amount: depositAmount,
        p_event_ts: eventTs,
        p_metadata: metadata,
        p_write_ledger: true
      },
      "coin-deposit"
    );
    if (result?.queued) {
      console.warn("[COIN] deposit accounting queued", {
        amount: depositAmount,
        deviceId: DEVICE_ID
      });
      return;
    }
    console.log("[COIN] deposit accounting applied", {
      amount: depositAmount,
      deviceId: DEVICE_ID
    });
  } catch (error) {
    console.error("[COIN] deposit accounting failed", {
      amount: depositAmount,
      error: error?.message || error
    });
  }
}
async function validateWithdrawRequest(amount) {
  const requestedAmount = toMoney(amount, 0);
  if (requestedAmount <= 0 || requestedAmount < 20) {
    return { ok: false, status: 400, error: "Invalid withdraw amount (min 20)" };
  }
  if (requestedAmount % 20 !== 0) {
    return { ok: false, status: 400, error: "Invalid withdraw amount (must be multiple of 20)" };
  }
  if (hopperActive || activeWithdrawalContext) {
    return { ok: false, status: 409, error: "Withdrawal already in progress" };
  }
  if (!IS_PI || !hasSupabaseRpcConfig()) {
    return { ok: true, amount: requestedAmount };
  }
  const state = await fetchDeviceFinancialState(DEVICE_ID);
  const deploymentMode = String(state?.deploymentMode || "online").trim().toLowerCase();
  const balance = toMoney(state?.balance, 0);
  const hopperBalance = toMoney(state?.hopperBalance, 0);
  const withdrawEnabled = Boolean(state?.withdrawEnabled);
  const hopperCap = getMaxWithdrawalAmountForHopperBalance(hopperBalance);
  const availableBalance = toMoney(balance - outstandingWithdrawalAccountingAmount, 0);
  const maxWithdrawalAmount = withdrawEnabled ? Math.max(0, Math.min(availableBalance, hopperBalance, hopperCap)) : 0;
  if (deploymentMode !== "online") {
    return { ok: false, status: 409, error: "Device is in maintenance mode" };
  }
  if (!withdrawEnabled) {
    return { ok: false, status: 403, error: "Withdrawal disabled for this device" };
  }
  if (availableBalance < requestedAmount) {
    return { ok: false, status: 409, error: "Insufficient balance" };
  }
  if (hopperBalance < requestedAmount) {
    return { ok: false, status: 409, error: "Insufficient hopper balance" };
  }
  if (requestedAmount > maxWithdrawalAmount) {
    return {
      ok: false,
      status: 409,
      error: `Max withdrawal amount is ${formatPeso(maxWithdrawalAmount)}`,
      balance,
      hopperBalance,
      maxWithdrawalAmount
    };
  }
  return {
    ok: true,
    amount: requestedAmount,
    balance: availableBalance,
    hopperBalance,
    maxWithdrawalAmount
  };
}
function formatPeso(amount, withSymbol = false, withDecimal = true, decimalCount = 2, abbreviate = false) {
  const num = Number(amount);
  if (isNaN(num)) return withSymbol ? "$0" : "0";
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  let value;
  if (abbreviate) {
    if (abs >= 1e9) {
      const v = Math.floor(abs / 1e9 * 100) / 100;
      value = v.toString().replace(/\.00$/, "") + "B";
    } else if (abs >= 1e6) {
      const v = Math.floor(abs / 1e6 * 100) / 100;
      value = v.toString().replace(/\.00$/, "") + "M";
    } else if (abs >= 1e4) {
      const v = Math.floor(abs / 1e3 * 100) / 100;
      value = v.toString().replace(/\.00$/, "") + "K";
    } else {
      value = abs.toLocaleString();
    }
  } else {
    value = abs.toFixed(withDecimal ? decimalCount : 2).replace(/\d(?=(\d{3})+\.)/g, "$&,");
    if (withDecimal && decimalCount > 2 && value.endsWith(".00")) {
      value = value.slice(0, -3);
    }
  }
  return `${sign}${withSymbol ? "$" : ""}${value}`;
}
function isStartButton(index) {
  return START_BUTTON_INDEXES.has(index);
}
function isLifePurchaseButton(index) {
  return ARCADE_LIFE_PURCHASE_BUTTON_INDEXES.has(index);
}
function getArcadeLifePromptActionLabel() {
  const label = String(ARCADE_LIFE_PURCHASE_LABEL || "BUY").trim().toUpperCase();
  return label === "START" ? "BUY" : label;
}
function normalizeArcadeJoinMode(value) {
  const mode = String(value || "simultaneous").toLowerCase().trim();
  if (mode === "alternating" || mode === "single_only") return mode;
  return "simultaneous";
}
function normalizeArcadePlayer(source) {
  const mapped = resolveRetroInputSource(source);
  if (mapped === "P1" || mapped === "P2") return mapped;
  return null;
}
function sendRetroarchNetCommand(command, options = {}) {
  if (!ARCADE_RETRO_OSD_ENABLED) return;
  if (!retroarchActive) return;
  if (RETROARCH_TTY_X_SESSION && !import_fs.default.existsSync(RETROARCH_READY_FILE)) return;
  const clean = String(command || "").trim();
  const message = `${clean}
`;
  if (!message.trim()) return;
  const urgent = options?.urgent === true;
  const retryCount = Math.max(1, ARCADE_RETRO_OSD_RETRY_COUNT);
  const retryIntervalMs = urgent ? 60 : ARCADE_RETRO_OSD_RETRY_INTERVAL_MS;
  const sendViaStdin = (attempt) => {
    if (RETROARCH_TTY_X_SESSION) return false;
    if (!retroarchProcess?.stdin?.writable) return false;
    try {
      retroarchProcess.stdin.write(message);
      console.log(
        `[RETROARCH OSD] #${attempt}/${retryCount}${urgent ? " urgent" : ""} stdin ${clean}`
      );
      return true;
    } catch (err) {
      console.error("[RETROARCH OSD] stdin send failed", err?.message || err);
      return false;
    }
  };
  const sendOnce = (attempt) => {
    if (sendViaStdin(attempt)) return;
    if (!Number.isFinite(RETROARCH_NETCMD_PORT) || RETROARCH_NETCMD_PORT <= 0) return;
    const udpSocket = import_dgram.default.createSocket("udp4");
    const udpPayload = Buffer.from(message, "utf8");
    udpSocket.send(udpPayload, RETROARCH_NETCMD_PORT, RETROARCH_NETCMD_HOST, (err) => {
      if (err) {
        console.error("[RETROARCH OSD] UDP send failed", err.message);
      }
      udpSocket.close();
    });
    console.log(`[RETROARCH OSD] #${attempt}/${retryCount}${urgent ? " urgent" : ""} ${clean}`);
  };
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    const delay = (attempt - 1) * retryIntervalMs;
    if (delay <= 0) {
      sendOnce(attempt);
      continue;
    }
    setTimeout(() => {
      if (!retroarchActive) return;
      sendOnce(attempt);
    }, delay);
  }
}
async function requestRetroarchNetResponse(command, timeoutMs = 250) {
  if (!retroarchActive) return null;
  if (!Number.isFinite(RETROARCH_NETCMD_PORT) || RETROARCH_NETCMD_PORT <= 0) return null;
  const clean = String(command || "").trim();
  if (!clean) return null;
  return new Promise((resolve) => {
    const udpSocket = import_dgram.default.createSocket("udp4");
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      try {
        udpSocket.close();
      } catch {
      }
      resolve(value);
    };
    const timeout = setTimeout(() => settle(null), Math.max(50, Math.round(timeoutMs)));
    udpSocket.on("error", () => {
      clearTimeout(timeout);
      settle(null);
    });
    udpSocket.on("message", (message) => {
      clearTimeout(timeout);
      settle(String(message || "").trim() || null);
    });
    udpSocket.bind(0, "0.0.0.0", () => {
      const payload = Buffer.from(`${clean}
`, "utf8");
      udpSocket.send(payload, RETROARCH_NETCMD_PORT, RETROARCH_NETCMD_HOST, (err) => {
        if (err) {
          clearTimeout(timeout);
          settle(null);
        }
      });
    });
  });
}
async function queryRetroarchPlaybackStatus() {
  const response = await requestRetroarchNetResponse("GET_STATUS", 300);
  if (!response) return null;
  if (response.includes("GET_STATUS PAUSED")) return "PAUSED";
  if (response.includes("GET_STATUS PLAYING")) return "PLAYING";
  return null;
}
async function ensureArcadeTimeoutPause() {
  if (!arcadeSession?.active) return;
  if (!retroarchActive) return;
  if (arcadeTimeoutPauseConfirmed || arcadeTimeoutPausePending) return;
  arcadeTimeoutPausePending = true;
  try {
    const status = await queryRetroarchPlaybackStatus();
    if (!arcadeSession?.active || !retroarchActive) return;
    if ((arcadeSession.arcadeTimeMs || 0) > 0) return;
    if (status === "PAUSED") {
      arcadeTimeoutPauseConfirmed = true;
      console.log("[ARCADE TIME] expiry pause skipped (already paused)");
      return;
    }
    sendRetroarchNetCommand("PAUSE_TOGGLE", { urgent: true });
    arcadeTimeoutPauseApplied = true;
    arcadeTimeoutPauseConfirmed = true;
    setArcadeOverlayNotice("TIME UP - PAUSED", 1500, "center");
    refreshArcadeOsdMessage();
    console.log("[ARCADE TIME] expiry pause triggered", {
      remainingMs: arcadeSession.arcadeTimeMs || 0,
      status: status || "unknown"
    });
  } finally {
    arcadeTimeoutPausePending = false;
  }
}
function resetArcadeTimeoutPauseState() {
  arcadeTimeoutPauseApplied = false;
  arcadeTimeoutPauseConfirmed = false;
  arcadeTimeoutPausePending = false;
}
function isArcadeTimeLockActive() {
  if (!arcadeSession?.active) return false;
  if (Number(arcadeSession.arcadeTimeMs || 0) > 0) return false;
  return arcadeTimeoutPauseConfirmed;
}
function showArcadeOsdMessage(message, options = {}) {
  if (RETROARCH_OSD_COMMAND === "OFF" || RETROARCH_OSD_COMMAND === "NONE") return;
  const allowBlank = options?.allowBlank === true;
  const bypassCooldown = options?.bypassCooldown === true;
  const urgent = options?.urgent === true;
  const source = String(message || "").replace(/[\r\n\t]/g, " ");
  const normalized = ARCADE_RETRO_OSD_STYLE === "footer" ? source.slice(0, 180) : source.replace(/\s+/g, " ").slice(0, 120);
  const text = allowBlank ? normalized : normalized.trim();
  if (!text && !allowBlank) return;
  const messageKey = text || "__BLANK__";
  const now = Date.now();
  if (!bypassCooldown && messageKey === lastArcadeOsdMessage) {
    if (now - lastArcadeOsdAt < ARCADE_RETRO_OSD_COOLDOWN_MS) return;
  }
  lastArcadeOsdMessage = messageKey;
  lastArcadeOsdAt = now;
  const osdCommands = (() => {
    if (RETROARCH_OSD_COMMAND === "AUTO") return ["SHOW_MESG", "SHOW_MSG"];
    if (RETROARCH_OSD_COMMAND === "SHOW_MSG") return ["SHOW_MSG"];
    if (RETROARCH_OSD_COMMAND === "SHOW_MESG") return ["SHOW_MESG"];
    return [RETROARCH_OSD_COMMAND];
  })();
  const seen = /* @__PURE__ */ new Set();
  for (const osdCommand of osdCommands) {
    if (seen.has(osdCommand)) continue;
    seen.add(osdCommand);
    const command = text ? `${osdCommand} ${text}` : osdCommand;
    sendRetroarchNetCommand(command, { urgent });
  }
}
function formatArcadeBalanceForOsd(rawBalance) {
  if (rawBalance === null || rawBalance === void 0) return "0.00";
  return formatPeso(toMoney(rawBalance, 0));
}
function isBlockedCasinoActionDuringRetroarch(action) {
  return action === "WITHDRAW" || action === "WITHDRAW_COIN";
}
function composeArcadeOsdOverlay(message, balanceOverride = null, options = null) {
  const base = String(message || "").replace(/\s+/g, " ").trim();
  if (!arcadeSession?.active) return base;
  const rawBalance = balanceOverride === null || balanceOverride === void 0 ? arcadeSession.lastKnownBalance : balanceOverride;
  const balanceText = formatArcadeBalanceForOsd(rawBalance);
  const balanceBanner = `Balance \u20B1${balanceText}`;
  if (ARCADE_RETRO_OSD_STYLE === "footer") {
    const footerState = getArcadeRetroFooterState(balanceOverride);
    const leftText = footerState.leftText;
    const centerText = footerState.centerText;
    const rightText = footerState.rightText;
    const centerIn = (txt, w) => {
      const lines = String(txt || "").split("\n");
      return lines.map((line) => {
        const clean = line.trim();
        if (clean.length >= w) return clean.slice(0, w);
        const leftPad = Math.floor((w - clean.length) / 2);
        const rightPad = w - clean.length - leftPad;
        return `${" ".repeat(leftPad)}${clean}${" ".repeat(rightPad)}`;
      }).join("\n");
    };
    const colW = 20;
    const gap = "       ";
    const leftCol = centerIn(leftText, colW);
    const centerCol = centerIn(centerText, colW);
    const rightCol = centerIn(rightText, colW);
    return `${leftCol}${gap}${centerCol}${gap}${rightCol}`;
  }
  if (ARCADE_RETRO_OSD_STYLE === "hud") {
    const hudParts = [];
    if (ARCADE_RETRO_OSD_LABEL) hudParts.push(ARCADE_RETRO_OSD_LABEL);
    const isOffline = typeof hasLocalNetworkLink === "function" && !hasLocalNetworkLink();
    hudParts.push(isOffline ? "OFFLINE" : balanceBanner);
    hudParts.push(arcadeOverlayNotice || base);
    if (ARCADE_RETRO_OSD_SHOW_SESSION_STATS) {
      hudParts.push(
        `TIME:${formatArcadeTime(arcadeSession?.arcadeTimeMs || 0)}`,
        `Balance:P${balanceText}`
      );
    }
    const continueSeconds = Number(options?.continueSeconds);
    if (Number.isFinite(continueSeconds) && continueSeconds >= 0) {
      hudParts.push(`CONTINUE:${String(Math.round(continueSeconds)).padStart(2, "0")}`);
    }
    return hudParts.join(" | ");
  }
  return `${arcadeOverlayNotice || base} | TIME:${formatArcadeTime(arcadeSession?.arcadeTimeMs || 0)} Balance:P${balanceText}`;
}
function getArcadeRetroFooterState(balanceOverride = null) {
  const rawBalance = balanceOverride === null || balanceOverride === void 0 ? arcadeSession?.lastKnownBalance : balanceOverride;
  const balanceText = formatArcadeBalanceForOsd(rawBalance);
  const now = Date.now();
  const exitConfirmArmed = Number(retroarchExitConfirmUntil || 0) > now;
  const hasTime = Number(arcadeSession?.arcadeTimeMs || 0) > 0;
  const joinMode = normalizeArcadeJoinMode(arcadeSession?.joinMode);
  const sessionPhase = String(arcadeSession?.sessionPhase || "prestart");
  const p2BlockedMidRun = joinMode === "alternating" && sessionPhase === "live";
  const p2Disabled = joinMode === "single_only";
  const isOffline = typeof hasLocalNetworkLink === "function" && !hasLocalNetworkLink();
  let leftBase;
  if (gameOverState.P1) {
    leftBase = "P1 \xB7 GAME OVER";
  } else if (isOffline) {
    leftBase = "P1 \xB7 OFFLINE";
  } else if (hasTime) {
    leftBase = "P1 \xB7 READY";
  } else {
    leftBase = "P1 \xB7 LOCKED";
  }
  const timeText = formatArcadeTime(arcadeSession?.arcadeTimeMs || 0);
  const centerBase = exitConfirmArmed ? "EXIT GAME?" : isOffline ? "OFFLINE" : `TIME ${timeText} | \u20B1${balanceText}`;
  let rightBase;
  if (gameOverState.P2) {
    rightBase = "P2 \xB7 GAME OVER";
  } else if (isOffline) {
    rightBase = "P2 \xB7 OFFLINE";
  } else if (!hasTime) {
    if (p2Disabled) {
      rightBase = "P2 \xB7 SOLO";
    } else if (p2BlockedMidRun) {
      rightBase = "P2 \xB7 WAIT TURN";
    } else {
      rightBase = "P2 \xB7 LOCKED";
    }
  } else {
    rightBase = p2Disabled ? "P2 \xB7 SOLO" : p2BlockedMidRun ? "P2 \xB7 WAIT TURN" : "P2 \xB7 READY";
  }
  const visible = true;
  return {
    active: Boolean(arcadeSession?.active),
    visible,
    gameName: arcadeSession?.gameName || null,
    balanceText,
    leftText: arcadeOverlayNotice?.slot === "left" ? arcadeOverlayNotice.text : leftBase,
    centerText: arcadeOverlayNotice?.slot === "center" ? arcadeOverlayNotice.text : centerBase,
    rightText: arcadeOverlayNotice?.slot === "right" ? arcadeOverlayNotice.text : rightBase,
    p1HasCredit: hasTime,
    p2HasCredit: hasTime,
    joinMode,
    sessionPhase,
    p1ConfirmArmed: false,
    p2ConfirmArmed: false,
    exitConfirmArmed,
    notice: arcadeOverlayNotice ? {
      text: arcadeOverlayNotice.text,
      slot: arcadeOverlayNotice.slot
    } : null
  };
}
function getArcadeRetroOverlayState() {
  return {
    active: Boolean(arcadeSession?.active),
    retroarchActive,
    gameName: arcadeSession?.gameName || null,
    gameId: arcadeSession?.gameId || null,
    pricePerLife: arcadeSession?.active ? getArcadeSessionPrice() : null,
    joinMode: arcadeSession?.active ? normalizeArcadeJoinMode(arcadeSession?.joinMode) : null,
    sessionPhase: arcadeSession?.active ? arcadeSession?.sessionPhase || "prestart" : null,
    balance: arcadeSession?.lastKnownBalance === null || arcadeSession?.lastKnownBalance === void 0 ? null : arcadeSession.lastKnownBalance,
    footer: getArcadeRetroFooterState(),
    updatedAt: Date.now()
  };
}
function getArcadeSessionPrice() {
  if (!arcadeSession?.active) return ARCADE_LIFE_PRICE_DEFAULT;
  return toMoney(arcadeSession.pricePerLife, ARCADE_LIFE_PRICE_DEFAULT);
}
function clearArcadeContinueCountdown(player = null) {
  const players = player && arcadeContinueCountdownTimers[player] !== void 0 ? [player] : Object.keys(arcadeContinueCountdownTimers);
  for (const currentPlayer of players) {
    const timer = arcadeContinueCountdownTimers[currentPlayer];
    if (!timer) continue;
    clearTimeout(timer);
    arcadeContinueCountdownTimers[currentPlayer] = null;
  }
}
function getOtherArcadePlayer(player) {
  if (player === "P1") return "P2";
  if (player === "P2") return "P1";
  return null;
}
function clearPendingRetroarchStartTimer(player) {
  const state = retroarchStartPressState[player];
  if (!state || !state.timer) return;
  clearTimeout(state.timer);
  state.timer = null;
}
function resetRetroarchStartPressState(player) {
  const state = retroarchStartPressState[player];
  if (!state) return;
  clearPendingRetroarchStartTimer(player);
  state.pressed = false;
  state.sent = false;
  state.suppressed = false;
  state.pressedAt = 0;
}
function releaseRetroarchStartIfSent(player) {
  const state = retroarchStartPressState[player];
  const target = getRetroVirtualTarget(player);
  if (!state || !state.sent || !target) return;
  sendVirtual(target, EV_KEY, BTN_START, 0);
  state.sent = false;
}
function handleSimultaneousRetroarchStart(player, target, value) {
  const state = retroarchStartPressState[player];
  const otherPlayer = getOtherArcadePlayer(player);
  const otherState = otherPlayer ? retroarchStartPressState[otherPlayer] : null;
  if (!state || !otherState) return false;
  if (value === 1) {
    state.pressed = true;
    state.suppressed = false;
    state.pressedAt = Date.now();
    if (otherState.pressed && state.pressedAt - Number(otherState.pressedAt || 0) <= RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS) {
      clearPendingRetroarchStartTimer(player);
      clearPendingRetroarchStartTimer(otherPlayer);
      releaseRetroarchStartIfSent(player);
      releaseRetroarchStartIfSent(otherPlayer);
      state.suppressed = true;
      otherState.suppressed = true;
      console.log("[RETROARCH] simultaneous START suppressed", {
        players: [otherPlayer, player],
        windowMs: RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS
      });
      return true;
    }
    clearPendingRetroarchStartTimer(player);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (!state.pressed || state.suppressed || state.sent) return;
      sendVirtual(target, EV_KEY, BTN_START, 1);
      state.sent = true;
    }, RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS);
    return true;
  }
  if (value === 0) {
    clearPendingRetroarchStartTimer(player);
    if (state.sent) {
      sendVirtual(target, EV_KEY, BTN_START, 0);
    }
    state.pressed = false;
    state.sent = false;
    state.suppressed = false;
    state.pressedAt = 0;
    return true;
  }
  return false;
}
function playerHasStoredCredit(player) {
  if (!arcadeSession?.active) return false;
  if (player !== "P1" && player !== "P2") return false;
  return Number(arcadeSession.arcadeTimeMs || 0) > 0;
}
function shouldPromoteArcadeSessionToLive(player, index) {
  if (!arcadeSession?.active) return false;
  if (!playerHasStoredCredit(player)) return false;
  if (isStartButton(index)) return false;
  if (retroarchActive && !canAcceptRetroarchStartInput()) return false;
  return true;
}
function markArcadeSessionLive(reason = "gameplay_input") {
  if (!arcadeSession?.active) return;
  if (arcadeSession.sessionPhase === "live") return;
  arcadeSession.sessionPhase = "live";
  maybeStartArcadeTimeSession(reason);
  startArcadeTimeLoop();
  broadcastArcadeLifeState("live", { reason, sessionPhase: "live" });
  refreshArcadeOsdMessage();
}
function isArcadePurchaseAllowed(player) {
  if (!arcadeSession?.active) return true;
  if (player !== "P1" && player !== "P2") return false;
  const joinMode = normalizeArcadeJoinMode(arcadeSession.joinMode);
  const sessionPhase = String(arcadeSession.sessionPhase || "prestart");
  if (joinMode === "single_only") return player === "P1";
  if (joinMode === "alternating" && sessionPhase === "live" && player === "P2") return false;
  return true;
}
function clearArcadePromptLoop() {
  if (arcadePromptLoopTimer !== null) {
    clearTimeout(arcadePromptLoopTimer);
    arcadePromptLoopTimer = null;
  }
  arcadePromptBlinkPhase = false;
  lastArcadePromptLoopMessage = "";
  lastArcadePromptLoopSentAt = 0;
}
function startArcadeTimeLoop() {
  if (arcadeTimeLoopTimer) return;
  arcadeTimeLoopTimer = setInterval(async () => {
    if (!arcadeSession?.active) return;
    if (!retroarchActive) {
      stopArcadeTimeLoop();
      return;
    }
    const now = Date.now();
    if (!arcadeSession.arcadeSessionStartedAt) {
      if (!maybeStartArcadeTimeSession("retroarch_ready")) return;
    }
    const elapsedSinceStart = now - arcadeSession.arcadeSessionStartedAt;
    if (elapsedSinceStart < ARCADE_TIME_GRACE_MS) {
      arcadeSession.arcadeTimeLastDeductedAt = now;
      return;
    }
    const last = arcadeSession.arcadeTimeLastDeductedAt || arcadeSession.arcadeSessionStartedAt;
    const delta = now - last;
    if (delta < 1e3) return;
    const remaining = arcadeSession.arcadeTimeMs || 0;
    if (remaining <= 0) return;
    const deduct = Math.min(delta, remaining);
    arcadeSession.arcadeTimeMs -= deduct;
    arcadeSession.arcadeTimeLastDeductedAt = now;
    scheduleArcadeTimePersistence(arcadeSession.arcadeTimeMs);
    if (arcadeSession.arcadeTimeMs <= 0) {
      arcadeSession.arcadeTimeMs = 0;
      scheduleArcadeTimePersistence(0, { immediate: true });
      if (!arcadeTimeoutPausePending && !arcadeTimeoutPauseConfirmed) {
        void ensureArcadeTimeoutPause();
      }
    }
    if (typeof refreshArcadeOsdMessage === "function") {
      refreshArcadeOsdMessage();
    }
  }, 500);
}
function stopArcadeTimeLoop() {
  if (!arcadeTimeLoopTimer) return;
  clearInterval(arcadeTimeLoopTimer);
  arcadeTimeLoopTimer = null;
  arcadeTimeoutPausePending = false;
}
function buildArcadePromptMessage() {
  if (!arcadeSession?.active) return "";
  const hasTime = !isArcadeTimeLockActive();
  const joinMode = normalizeArcadeJoinMode(arcadeSession.joinMode);
  const sessionPhase = String(arcadeSession.sessionPhase || "prestart");
  const p2PurchaseAllowed = isArcadePurchaseAllowed("P2");
  if (!hasTime) {
    const priceText = getArcadeSessionPrice().toFixed(2);
    const actionLabel = getArcadeLifePromptActionLabel();
    if (!p2PurchaseAllowed) {
      return composeArcadeOsdOverlay(
        joinMode === "alternating" && sessionPhase === "live" ? "P2 NEXT TURN" : "1 PLAYER ONLY"
      );
    }
    return composeArcadeOsdOverlay(`TIME LOCKED | PRESS ${actionLabel} (P${priceText})`);
  }
  return "";
}
function scheduleArcadePromptLoop() {
  clearArcadePromptLoop();
  if (!ARCADE_RETRO_OSD_PROMPT_PERSIST) return;
  const HEARTBEAT_MS = 4e3;
  const tick = () => {
    if (!arcadeSession?.active) {
      clearArcadePromptLoop();
      return;
    }
    if (buyIntentState === "armed" && Date.now() > buyIntentUntil) {
      buyIntentState = "idle";
    }
    const promptMessage = buildArcadePromptMessage();
    if (promptMessage) {
      if (ARCADE_RETRO_OSD_PROMPT_BLINK) {
        arcadePromptBlinkPhase = !arcadePromptBlinkPhase;
        if (arcadePromptBlinkPhase) {
          showArcadeOsdMessage(promptMessage, { bypassCooldown: true });
        } else {
          showArcadeOsdMessage("", { allowBlank: true, bypassCooldown: true });
        }
      } else {
        const now = Date.now();
        const changed = promptMessage !== lastArcadePromptLoopMessage;
        const heartbeatDue = now - lastArcadePromptLoopSentAt >= HEARTBEAT_MS;
        if (changed || heartbeatDue) {
          showArcadeOsdMessage(promptMessage, { bypassCooldown: changed });
          lastArcadePromptLoopMessage = promptMessage;
          lastArcadePromptLoopSentAt = now;
        }
      }
    } else {
      arcadePromptBlinkPhase = false;
      lastArcadePromptLoopMessage = "";
      lastArcadePromptLoopSentAt = 0;
    }
    arcadePromptLoopTimer = setTimeout(tick, ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS);
  };
  tick();
}
function broadcastArcadeLifeState(status = "state", extra = {}) {
  if (!arcadeSession?.active) {
    dispatch({
      type: "ARCADE_LIFE_STATE",
      active: false,
      status,
      ...extra
    });
    return;
  }
  dispatch({
    type: "ARCADE_LIFE_STATE",
    active: true,
    status,
    gameId: arcadeSession.gameId,
    gameName: arcadeSession.gameName,
    pricePerLife: arcadeSession.pricePerLife,
    joinMode: normalizeArcadeJoinMode(arcadeSession.joinMode),
    sessionPhase: arcadeSession.sessionPhase || "prestart",
    p1Unlocked: Number(arcadeSession.arcadeTimeMs || 0) > 0,
    p2Unlocked: Number(arcadeSession.arcadeTimeMs || 0) > 0 && normalizeArcadeJoinMode(arcadeSession.joinMode) !== "single_only",
    p1LivesPurchased: 0,
    p2LivesPurchased: 0,
    balance: arcadeSession.lastKnownBalance,
    ...extra
  });
}
async function fetchDeviceBalanceSnapshot() {
  if (!hasSupabaseRpcConfig()) return null;
  const url = `${SUPABASE_URL}/rest/v1/device_stats_live?select=balance&device_id=eq.${encodeURIComponent(DEVICE_ID)}&limit=1`;
  const response = await requestJsonWithCurl(url, {
    method: "GET",
    headers: getSupabaseHeaders(),
    timeoutMs: 2500
  });
  if (!response.ok) {
    throw new Error(`balance fetch failed (${response.status})`);
  }
  const rows = response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.balance === null || row.balance === void 0) return null;
  return toMoney(row.balance, 0);
}
async function persistDeviceArcadeTimeSnapshot(timeMs) {
  if (!hasSupabaseRpcConfig()) return { ok: true, skipped: true };
  const safeTimeMs = Math.max(0, Math.floor(Number(timeMs || 0)));
  const url = `${SUPABASE_URL}/rest/v1/devices?device_id=eq.${encodeURIComponent(DEVICE_ID)}`;
  const response = await requestJsonWithCurl(url, {
    method: "PATCH",
    headers: {
      ...getSupabaseHeaders(),
      Prefer: "return=representation"
    },
    timeoutMs: 3500,
    body: {
      arcade_time_ms: safeTimeMs
    }
  });
  if (!response.ok) {
    throw new Error(`arcade time persist failed (${response.status})`);
  }
  return { ok: true, timeMs: safeTimeMs, data: response.json() };
}
async function flushArcadeTimePersistence(options = {}) {
  const force = options?.force === true;
  const targetTimeMs = Math.max(
    0,
    Math.floor(
      Number(options?.timeMs ?? arcadeTimePersistRequestedMs ?? arcadeSession?.arcadeTimeMs ?? 0)
    )
  );
  if (!force && targetTimeMs === arcadeTimePersistCommittedMs) return;
  if (arcadeTimePersistInFlight) return;
  arcadeTimePersistInFlight = true;
  try {
    await safeRpcCall(
      (body) => persistDeviceArcadeTimeSnapshot(body.arcade_time_ms),
      {
        arcade_time_ms: targetTimeMs
      },
      "arcade-time-snapshot"
    );
    arcadeTimePersistCommittedMs = targetTimeMs;
  } catch (error) {
    console.error("[ARCADE TIME] persist failed", error?.message || error);
  } finally {
    arcadeTimePersistInFlight = false;
    if (arcadeTimePersistRequestedMs !== null && arcadeTimePersistRequestedMs !== targetTimeMs) {
      void flushArcadeTimePersistence();
    }
  }
}
function scheduleArcadeTimePersistence(timeMs, options = {}) {
  const immediate = options?.immediate === true;
  arcadeTimePersistRequestedMs = Math.max(0, Math.floor(Number(timeMs || 0)));
  if (immediate) {
    clearArcadeTimePersistTimer();
    void flushArcadeTimePersistence();
    return;
  }
  if (arcadeTimePersistTimer !== null) return;
  arcadeTimePersistTimer = setTimeout(() => {
    arcadeTimePersistTimer = null;
    void flushArcadeTimePersistence();
  }, 1e3);
}
function maybeStartArcadeTimeSession(reason = "ready") {
  if (!arcadeSession?.active) return false;
  if (Number(arcadeSession.arcadeTimeMs || 0) <= 0) return false;
  if (arcadeSession.arcadeSessionStartedAt) return false;
  if (!isRetroarchSessionReady()) return false;
  const now = Date.now();
  arcadeSession.arcadeSessionStartedAt = now;
  arcadeSession.arcadeTimeLastDeductedAt = now;
  console.log(`[ARCADE TIME] session start (${reason})`);
  return true;
}
function clearArcadeBalanceSyncLoop() {
  if (arcadeBalanceSyncTimer !== null) {
    clearTimeout(arcadeBalanceSyncTimer);
    arcadeBalanceSyncTimer = null;
  }
}
async function syncArcadeSessionBalance(options = {}) {
  if (!arcadeSession?.active) return;
  if (!hasSupabaseRpcConfig()) return;
  if (arcadeBalanceSyncInFlight) return;
  const forceBroadcast = options?.forceBroadcast === true;
  arcadeBalanceSyncInFlight = true;
  try {
    const latestBalance = await fetchDeviceBalanceSnapshot();
    if (!arcadeSession?.active) return;
    if (latestBalance === null || latestBalance === void 0) return;
    if (shouldDeferArcadeBalanceSync(latestBalance)) {
      console.log("[ARCADE LIFE BALANCE] deferred stale sync", {
        current: arcadeSession.lastKnownBalance,
        next: latestBalance,
        floor: arcadeBalancePushFloor
      });
      return;
    }
    const previous = arcadeSession.lastKnownBalance;
    const now = Date.now();
    const lastMutation = arcadeSession?.lastBalanceMutationAt || 0;
    if (previous !== null && latestBalance < previous && now - lastMutation < 2e3) {
      console.log("[ARCADE LIFE BALANCE] ignored stale regression", {
        previous,
        next: latestBalance
      });
      return;
    }
    arcadeSession.lastKnownBalance = latestBalance;
    if (Number.isFinite(arcadeBalancePushFloor) && latestBalance >= arcadeBalancePushFloor) {
      clearArcadeBalancePushFloor();
    }
    if (previous !== latestBalance) {
      console.log("[ARCADE LIFE BALANCE] applied", { previous, next: latestBalance });
      broadcastArcadeLifeState("balance_sync", { balance: latestBalance });
      refreshArcadeOsdMessage();
    }
  } catch {
  } finally {
    arcadeBalanceSyncInFlight = false;
  }
}
function scheduleArcadeBalanceSyncLoop() {
  clearArcadeBalanceSyncLoop();
  if (!hasSupabaseRpcConfig()) return;
  const tick = async () => {
    if (!arcadeSession?.active) {
      clearArcadeBalanceSyncLoop();
      return;
    }
    await syncArcadeSessionBalance();
    arcadeBalanceSyncTimer = setTimeout(tick, ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS);
  };
  tick();
}
function startArcadeLifeSession({
  gameId,
  gameName,
  pricePerLife,
  initialBalance = null,
  initialArcadeTimeMs = 0,
  joinMode = "simultaneous"
}) {
  clearArcadeBalanceSyncLoop();
  clearArcadePromptLoop();
  clearArcadeContinueCountdown();
  clearArcadeOverlayNotice();
  resetArcadeTimeoutPauseState();
  arcadeSession = {
    active: true,
    gameId: String(gameId || "").trim() || "unknown",
    gameName: String(gameName || "").trim() || String(gameId || "").trim() || "Arcade Game",
    pricePerLife: toMoney(pricePerLife, ARCADE_LIFE_PRICE_DEFAULT),
    joinMode: normalizeArcadeJoinMode(joinMode),
    sessionPhase: "prestart",
    arcadeTimeMs: Math.max(0, Number(initialArcadeTimeMs || 0)),
    arcadeSessionStartedAt: null,
    arcadeTimeLastDeductedAt: null,
    lastKnownBalance: initialBalance === null || initialBalance === void 0 ? null : toMoney(initialBalance, 0)
  };
  arcadeTimePersistRequestedMs = arcadeSession.arcadeTimeMs;
  arcadeTimePersistCommittedMs = arcadeSession.arcadeTimeMs;
  if (arcadeSession.arcadeTimeMs > 0) {
    showArcadeOsdMessage(composeArcadeOsdOverlay("PRESS START TO PLAY"));
    startArcadeTimeLoop();
  } else {
    const priceText = getArcadeSessionPrice().toFixed(2);
    const actionLabel = getArcadeLifePromptActionLabel();
    showArcadeOsdMessage(
      composeArcadeOsdOverlay(`TIME LOCKED | PRESS ${actionLabel} (P${priceText})`)
    );
  }
  broadcastArcadeLifeState("started");
  const sessionRef = arcadeSession;
  setTimeout(() => {
    if (!arcadeSession?.active || arcadeSession !== sessionRef) return;
    if (arcadeSession.arcadeTimeMs > 0) return;
    const promptPriceText = getArcadeSessionPrice().toFixed(2);
    const promptActionLabel = getArcadeLifePromptActionLabel();
    showArcadeOsdMessage(
      composeArcadeOsdOverlay(`TIME LOCKED | PRESS ${promptActionLabel} (P${promptPriceText})`)
    );
  }, 2e3);
  scheduleArcadePromptLoop();
  scheduleArcadeBalanceSyncLoop();
  syncArcadeSessionBalance({ forceBroadcast: true });
}
function clearArcadeLifeSession(reason = "ended") {
  if (!arcadeSession?.active) return;
  const endedSession = arcadeSession;
  scheduleArcadeTimePersistence(endedSession.arcadeTimeMs || 0, { immediate: true });
  stopArcadeTimeLoop();
  resetArcadeTimeoutPauseState();
  arcadeSession = null;
  clearArcadeBalancePushFloor();
  clearArcadeBalanceSyncLoop();
  clearArcadePromptLoop();
  clearArcadeContinueCountdown();
  clearArcadeOverlayNotice();
  clearArcadeTimePersistTimer();
  dispatch({
    type: "ARCADE_LIFE_SESSION_ENDED",
    status: reason,
    gameId: endedSession.gameId,
    gameName: endedSession.gameName,
    p1LivesPurchased: 0,
    p2LivesPurchased: 0,
    balance: endedSession.lastKnownBalance
  });
}
async function fetchGameProfileForArcadeLife(gameId) {
  if (!hasSupabaseRpcConfig()) return null;
  const safeId = String(gameId || "").trim();
  if (!safeId) return null;
  const url = `${SUPABASE_URL}/rest/v1/games?select=id,name,price,type,enabled,join_mode&id=eq.${encodeURIComponent(safeId)}&type=eq.arcade&limit=1`;
  try {
    const response = await requestJsonWithCurl(url, {
      method: "GET",
      headers: getSupabaseHeaders(),
      timeoutMs: 2500
    });
    if (!response.ok) {
      const text = response.text || "";
      console.error("[ARCADE LIFE] game profile fetch failed", response.status, text);
      return null;
    }
    const rows = response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.enabled === false) return null;
    return {
      gameId: row.id || safeId,
      gameName: row.name || safeId,
      pricePerLife: toMoney(row.price, ARCADE_LIFE_PRICE_DEFAULT),
      joinMode: normalizeArcadeJoinMode(row.join_mode)
    };
  } catch (err) {
    console.error("[ARCADE LIFE] game profile fetch error", err?.message || err);
    return null;
  }
}
async function fetchCabinetGamesForDevice(deviceId = DEVICE_ID) {
  if (!hasSupabaseRpcConfig()) return [];
  const safeDeviceId = String(deviceId || "").trim();
  if (!safeDeviceId) return [];
  const url = `${SUPABASE_URL}/rest/v1/cabinet_games?select=device_id,game_id,games!inner(id,name,type,price,join_mode,box_art_url,emulator_core,rom_path,package_url,version,enabled)&device_id=eq.${encodeURIComponent(safeDeviceId)}&installed=eq.true`;
  try {
    const response = await requestJsonWithCurl(url, {
      method: "GET",
      headers: getSupabaseHeaders(),
      timeoutMs: 2500
    });
    if (!response.ok) {
      console.error("[CABINET GAMES] fetch failed", response.status);
      return [];
    }
    const rows = response.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => row?.games).filter(Boolean).map((game) => ({
      id: game.id,
      name: game.name,
      type: game.type,
      enabled: game.enabled !== false,
      price: toMoney(game.price, 0),
      join_mode: normalizeArcadeJoinMode(game.join_mode),
      art: String(game.box_art_url || "").startsWith("assets/boxart/") ? `/roms/boxart/${String(game.box_art_url).slice("assets/boxart/".length)}` : String(game.box_art_url || ""),
      emulator_core: game.emulator_core || null,
      rom_path: game.rom_path || null,
      package_url: game.package_url || null,
      version: Number(game.version || 1)
    })).filter((game) => game.type !== "casino" || game.enabled !== false).sort((a, b) => {
      const enabledDelta = Number(b.enabled !== false) - Number(a.enabled !== false);
      if (enabledDelta !== 0) return enabledDelta;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  } catch (err) {
    console.error("[CABINET GAMES] fetch error", err?.message || err);
    return [];
  }
}
async function rpcBuyArcadeCredit({ deviceId, gameId }) {
  if (!hasSupabaseRpcConfig()) {
    return { ok: false, error: "missing_config" };
  }
  try {
    const response = await requestJsonWithCurl(
      `${SUPABASE_URL}/rest/v1/rpc/buy_arcade_credit`,
      // ✅ FIXED
      {
        method: "POST",
        headers: getSupabaseHeaders(),
        timeoutMs: 3500,
        body: {
          p_device_id: deviceId,
          p_game_id: gameId
        }
      }
    );
    if (!response.ok) {
      const text = response.text || "";
      console.error("[BUY CREDIT RPC] failed", response.status, text);
      return { ok: false, error: "rpc_failed" };
    }
    const body = response.json();
    const row = Array.isArray(body) ? body[0] : body;
    const ok = row?.ok === true || row?.ok === 1 || row?.ok === "1" || row?.ok === "t" || row?.ok === "true";
    return {
      ok,
      data: row
    };
  } catch (err) {
    console.error("[BUY CREDIT RPC] exception", err?.message || err);
    return { ok: false, error: err?.message || "exception" };
  }
}
var lastBuyAt = 0;
var BUY_COOLDOWN_MS = 1500;
function addArcadeTime(ms) {
  if (!arcadeSession?.active) return;
  arcadeSession.arcadeTimeMs = (arcadeSession.arcadeTimeMs || 0) + ms;
  arcadeTimePersistRequestedMs = arcadeSession.arcadeTimeMs;
  refreshArcadeOsdMessage?.();
}
async function handleBuyPressed() {
  const now = Date.now();
  if (Date.now() - lastBuyAt < BUY_COOLDOWN_MS) {
    console.log("[BUY] cooldown active");
    return;
  }
  console.log("[BUY] pressed", {
    state: buyState,
    sinceConfirm: now - buyConfirmAt
  });
  if (buyState === "processing") {
    console.log("[BUY] blocked: processing in progress");
    return;
  }
  if (buyState === "idle") {
    buyState = "confirm";
    buyConfirmAt = now;
    console.log("[BUY] confirm required");
    setArcadeOverlayNotice("BUY TIME?", BUY_CONFIRM_WINDOW_MS, "center");
    return;
  }
  if (buyState === "confirm" && now - buyConfirmAt > BUY_CONFIRM_WINDOW_MS) {
    console.log("[BUY] confirm expired");
    buyState = "idle";
    setArcadeOverlayNotice("BUY TIME?", BUY_CONFIRM_WINDOW_MS, "center");
    return;
  }
  if (buyState === "confirm") {
    buyState = "processing";
    const sessionRef = arcadeSession;
    console.log("[BUY] processing...");
    setArcadeOverlayNotice("PROCESSING...", 0, "center");
    try {
      const gameId = sessionRef?.gameId;
      if (!gameId) {
        throw new Error("missing_game_id");
      }
      console.log("[BUY CREDIT] sending RPC...", {
        deviceId: DEVICE_ID,
        gameId
      });
      const res = await withTimeout(
        rpcBuyArcadeCredit({
          deviceId: DEVICE_ID,
          gameId
        }),
        5e3
      );
      console.log("[BUY CREDIT] response", res);
      if (!res || !res.ok) {
        throw new Error("rpc_failed");
      }
      const nextTimeMs = Number(res?.data?.arcade_time_ms);
      const nextBalance = toMoney(res?.data?.balance, NaN);
      if (Number.isFinite(nextTimeMs)) {
        arcadeSession.arcadeTimeMs = nextTimeMs;
        arcadeTimePersistRequestedMs = arcadeSession.arcadeTimeMs;
        arcadeTimePersistCommittedMs = arcadeSession.arcadeTimeMs;
        maybeStartArcadeTimeSession("buy");
        startArcadeTimeLoop();
      } else {
        addArcadeTime(ARCADE_TIME_PURCHASE_MS);
        scheduleArcadeTimePersistence(arcadeSession.arcadeTimeMs || 0, { immediate: true });
      }
      if (Number.isFinite(nextBalance)) {
        arcadeSession.lastKnownBalance = nextBalance;
        noteArcadeBalancePush(nextBalance);
        broadcastArcadeLifeState("balance_sync", { balance: nextBalance });
      }
      if (arcadeTimeoutPauseConfirmed && (arcadeSession.arcadeTimeMs || 0) > 0) {
        resetArcadeTimeoutPauseState();
      }
      broadcastArcadeLifeState("time_added", {
        arcadeTimeMs: arcadeSession.arcadeTimeMs || 0,
        balance: arcadeSession.lastKnownBalance
      });
      showArcadeOsdMessage(composeArcadeOsdOverlay(""), { bypassCooldown: true });
      if (!arcadeSession || arcadeSession !== sessionRef) {
        console.warn("[BUY CREDIT] session changed mid-flight");
        return;
      }
      console.log("[BUY CREDIT] success");
      lastBuyAt = Date.now();
      setArcadeOverlayNotice("TIME ADDED", 1500, "center");
    } catch (err) {
      console.error("[BUY CREDIT] failed", err?.message || err);
      setArcadeOverlayNotice(
        err?.message === "missing_game_id" ? "ERROR" : "BUY FAILED",
        1500,
        "center"
      );
    } finally {
      buyState = "idle";
    }
  }
}
function handleDepositPulse() {
  if (arcadeSession?.active) {
    arcadeSession.lastBalanceMutationAt = Date.now();
  }
  const now = Date.now();
  if (depositPulseCount === 0) {
    depositStartTime = now;
    depositPulseGaps = [];
    console.log("\n[DEPOSIT] START");
  }
  const gap = depositLastPulseTime ? now - depositLastPulseTime : 0;
  depositLastPulseTime = now;
  depositPulseCount++;
  depositPulseGaps.push(gap);
  console.log(`[DEPOSIT] PULSE #${depositPulseCount} (+${gap}ms)`);
  if (depositIdleTimer) clearTimeout(depositIdleTimer);
  depositIdleTimer = setTimeout(finalizeDepositCoin, COIN_IDLE_GAP_MS);
}
function resolveDepositCredits(pulses) {
  const normalizedPulses = Number(pulses || 0);
  if (normalizedPulses <= 0) return 0;
  const mappedCredits = COIN_PESO_BY_PULSE_COUNT[normalizedPulses];
  if (Number.isFinite(mappedCredits)) return mappedCredits;
  return normalizedPulses * 5;
}
function finalizeDepositCoin() {
  const pulses = depositPulseCount;
  const duration = Date.now() - depositStartTime;
  resetDepositCoin();
  if (pulses <= 0) return;
  const finalCredits = resolveDepositCredits(pulses);
  if (arcadeSession?.active) {
    arcadeSession.lastBalanceMutationAt = Date.now();
  }
  console.log(`[DEPOSIT] COIN pulses=${pulses} duration=${duration}ms credits=${finalCredits}`);
  if (finalCredits <= 0) return;
  if (arcadeSession?.active) {
    const previousBalance = arcadeSession.lastKnownBalance;
    const optimisticBalance = toMoney((previousBalance || 0) + finalCredits, previousBalance || 0);
    arcadeSession.lastKnownBalance = optimisticBalance;
    noteArcadeBalancePush(optimisticBalance);
    broadcastArcadeLifeState("balance_push", { balance: optimisticBalance });
    showArcadeOsdMessage(composeArcadeOsdOverlay(""), { bypassCooldown: true });
  }
  dispatch({
    type: "COIN",
    credits: finalCredits
  });
  void recordCoinDeposit(finalCredits, { pulses, durationMs: duration, gaps: depositPulseGaps });
}
function resetDepositCoin() {
  depositPulseCount = 0;
  depositIdleTimer = null;
  depositLastPulseTime = 0;
  depositStartTime = 0;
  depositPulseGaps = [];
}
var HARD_MAX_MS = 9e4;
function startHopper(amount) {
  if (shuttingDown || hopperActive || amount <= 0) return;
  setCoinInhibit(true);
  outstandingWithdrawalAccountingAmount = toMoney(
    outstandingWithdrawalAccountingAmount + toMoney(amount, 0),
    0
  );
  activeWithdrawalContext = {
    requestId: `withdraw-${Date.now()}`,
    requestedAmount: toMoney(amount, 0),
    dispensedTotal: 0,
    startedAt: Date.now()
  };
  dispatch({
    type: "WITHDRAW_STARTED",
    requested: toMoney(amount, 0)
  });
  if (!IS_PI) {
    console.log("[HOPPER] compat-mode simulated payout target=", amount);
    const totalPulses = Math.max(0, Math.ceil(amount / 20));
    let emitted = 0;
    const tick = () => {
      if (emitted >= totalPulses) {
        setCoinInhibit(false);
        dispatch({
          type: "WITHDRAW_COMPLETE",
          dispensed: emitted * 20
        });
        activeWithdrawalContext = null;
        return;
      }
      emitted += 1;
      dispatch({
        type: "WITHDRAW_DISPENSE",
        dispensed: 20
      });
      void recordWithdrawalDispense(20);
      setTimeout(tick, 120);
    };
    tick();
    return;
  }
  hopperActive = true;
  hopperTarget = amount;
  hopperDispensed = 0;
  hopperLastPulseAt = Date.now();
  console.log("[HOPPER] START target=", amount);
  gpioOn(HOPPER_PAY_PIN);
  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout);
  }
  hopperNoPulseTimeout = setTimeout(() => {
    if (!hopperActive) return;
    const elapsed = Date.now() - hopperLastPulseAt;
    console.error(`[HOPPER] NO PULSE ${elapsed}ms \u2014 FORCED STOP`);
    stopHopper();
  }, HOPPER_NO_PULSE_TIMEOUT_MS);
  const estimated = amount / 20 * 1200;
  const buffer = 3e3;
  const minRuntime = 5e3;
  const runtime = Math.max(estimated + buffer, minRuntime);
  hopperTimeout = setTimeout(
    () => {
      console.error("[HOPPER] TIMEOUT \u2014 FORCED STOP");
      stopHopper();
    },
    Math.min(runtime, HOPPER_TIMEOUT_MS, HARD_MAX_MS)
  );
}
function handleWithdrawPulse() {
  if (!hopperActive) return;
  hopperLastPulseAt = Date.now();
  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout);
  }
  hopperNoPulseTimeout = setTimeout(() => {
    if (!hopperActive) return;
    const elapsed = Date.now() - hopperLastPulseAt;
    console.error(`[HOPPER] NO PULSE ${elapsed}ms \u2014 FORCED STOP`);
    stopHopper();
  }, HOPPER_NO_PULSE_TIMEOUT_MS);
  hopperDispensed += 20;
  console.log(`[HOPPER] DISPENSED ${hopperDispensed}/${hopperTarget}`);
  dispatch({
    type: "WITHDRAW_DISPENSE",
    dispensed: 20
  });
  void recordWithdrawalDispense(20);
  if (hopperDispensed >= hopperTarget) {
    stopHopper();
  }
}
function stopHopper() {
  if (!hopperActive) return;
  gpioOff(HOPPER_PAY_PIN);
  hopperActive = false;
  setCoinInhibit(false);
  if (hopperTimeout) {
    clearTimeout(hopperTimeout);
    hopperTimeout = null;
  }
  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout);
    hopperNoPulseTimeout = null;
  }
  hopperLastPulseAt = 0;
  console.log("[HOPPER] STOP dispensed=", hopperDispensed);
  const wasAborted = hopperDispensed < hopperTarget;
  if (wasAborted) {
    outstandingWithdrawalAccountingAmount = toMoney(
      Math.max(
        0,
        outstandingWithdrawalAccountingAmount - Math.max(0, hopperTarget - hopperDispensed)
      ),
      0
    );
  }
  dispatch({
    type: wasAborted ? "WITHDRAW_ABORTED" : "WITHDRAW_COMPLETE",
    dispensed: hopperDispensed,
    requested: hopperTarget,
    aborted: wasAborted
  });
  activeWithdrawalContext = null;
}
var hopperCtl = null;
var coinCtl = null;
function gpioOn(pin) {
  if (!IS_PI) return;
  if (hopperCtl) {
    hopperCtl.kill("SIGTERM");
    hopperCtl = null;
  }
  hopperCtl = (0, import_child_process.spawn)("gpioset", [GPIOCHIP, `${pin}=0`]);
}
function gpioOff(pin) {
  if (!IS_PI) return;
  if (hopperCtl) {
    hopperCtl.kill("SIGTERM");
    hopperCtl = null;
  }
  hopperCtl = (0, import_child_process.spawn)("gpioset", [GPIOCHIP, `${pin}=1`]);
}
var lastCoinState = null;
function setCoinInhibit(disabled) {
  if (!IS_PI) return;
  if (lastCoinState === disabled) return;
  if (coinCtl) {
    coinCtl.kill("SIGTERM");
    coinCtl = null;
  }
  const value = disabled ? 0 : 1;
  coinCtl = (0, import_child_process.spawn)("gpioset", [GPIOCHIP, `${COIN_INHIBIT_PIN}=${value}`]);
  lastCoinState = disabled;
  console.log(`[COIN] ${disabled ? "REJECT" : "ACCEPT"}`);
}
var internetOkCount = 0;
var internetFailCount = 0;
var internetState = "unknown";
var internetDebounceTimer = null;
var internetLastStableState = "unknown";
var internetBootGraceUntil = Date.now() + 3e3;
var coinInhibitedByNetwork = false;
var lastLatencyMs = null;
var lastLatencyUpdateTime = 0;
var networkConfirmed = false;
var LATENCY_UPDATE_INTERVAL_MS = 6e4;
async function checkInternetReachability() {
  try {
    const res = await checkCabinetBackendReachability();
    if (res.ok) {
      internetOkCount++;
      internetFailCount = 0;
      if (internetOkCount >= INTERNET_RESTORE_THRESHOLD) {
        if (internetLastStableState !== "ok") {
          clearTimeout(internetDebounceTimer);
          internetDebounceTimer = setTimeout(() => {
            if (Date.now() < internetBootGraceUntil) return;
            internetState = "ok";
            internetLastStableState = "ok";
            networkConfirmed = true;
            dispatch({ type: "INTERNET_OK" });
            if (coinInhibitedByNetwork) {
              setCoinInhibit(false);
              coinInhibitedByNetwork = false;
            }
          }, 800);
        }
      }
    } else {
      throw new Error("not ok");
    }
  } catch {
    internetFailCount++;
    internetOkCount = 0;
    if (internetLastStableState !== "offline" && Date.now() >= internetBootGraceUntil) {
      console.warn("[COIN] Network failure detected - immediately inhibiting coins");
      if (internetState !== "offline") {
        internetState = "offline";
        internetLastStableState = "offline";
        dispatch({ type: "INTERNET_LOST" });
        if (hopperActive) {
          console.warn("[HOPPER] FORCE STOP due to internet loss");
          stopHopper();
        }
      }
      setCoinInhibit(true);
      coinInhibitedByNetwork = true;
    }
  }
}
async function checkCabinetBackendReachability() {
  const startMs = Date.now();
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const res = await requestJsonWithCurl(
        `${SUPABASE_URL}/rest/v1/devices?select=device_id&limit=1`,
        {
          method: "GET",
          headers: getSupabaseHeaders(),
          timeoutMs: 2e3
        }
      );
      lastLatencyMs = Date.now() - startMs;
      updateDeviceLatency(lastLatencyMs);
      return res;
    } catch (error) {
      lastLatencyMs = Date.now() - startMs;
      console.warn(
        "[NETWORK] Supabase reachability probe failed, falling back",
        error?.message || error
      );
    }
  }
  try {
    const res = await requestJsonWithCurl("https://clients3.google.com/generate_204", {
      method: "GET",
      timeoutMs: 2e3
    });
    lastLatencyMs = Date.now() - startMs;
    updateDeviceLatency(lastLatencyMs);
    return res;
  } catch (error) {
    lastLatencyMs = Date.now() - startMs;
    console.warn("[NETWORK] public internet probe failed", error?.message || error);
    return {
      ok: false,
      status: 0,
      text: "",
      json() {
        return null;
      }
    };
  }
}
setCoinInhibit(true);
coinInhibitedByNetwork = true;
setTimeout(() => {
  internetBootGraceUntil = 0;
}, 3e3);
setInterval(checkInternetReachability, 2e3);
var EV_SYN = 0;
var SYN_REPORT = 0;
var EV_KEY = 1;
var EV_ABS = 3;
var BTN_SOUTH = 304;
var BTN_EAST = 305;
var BTN_NORTH = 307;
var BTN_WEST = 308;
var BTN_SELECT = 314;
var BTN_START = 315;
var BTN_TL = 310;
var BTN_TR = 311;
var BTN_DPAD_UP = 544;
var BTN_DPAD_DOWN = 545;
var BTN_DPAD_LEFT = 546;
var BTN_DPAD_RIGHT = 547;
var dpadState = {
  P1: { up: false, down: false, left: false, right: false },
  P2: { up: false, down: false, left: false, right: false }
};
function startVirtualDevice(name) {
  if (!IS_PI) {
    console.log(`[VIRTUAL] compat-mode skipping ${name}`);
    return null;
  }
  const helperPath = process.env.UINPUT_HELPER_PATH || "/opt/arcade/bin/uinput-helper";
  const proc = (0, import_child_process.spawn)(helperPath, [name], {
    stdio: ["pipe", "ignore", "ignore"]
  });
  proc.on("spawn", () => {
    console.log(`[VIRTUAL] ${name} created (pid=${proc.pid})`);
  });
  proc.on("error", (err) => {
    console.error(`[VIRTUAL] ${name} failed (${helperPath})`, err.message);
  });
  return proc;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function getArcadeShellUpdateStatus() {
  return {
    ...arcadeShellUpdateState,
    running: Boolean(arcadeShellUpdateChild),
    triggered: arcadeShellUpdateTriggered
  };
}
function setArcadeShellUpdateState(patch) {
  arcadeShellUpdateState = {
    ...arcadeShellUpdateState,
    ...patch
  };
}
function triggerArcadeShellUpdate(reason = "manual") {
  if (arcadeShellUpdateChild) {
    return { started: false, alreadyRunning: true, status: getArcadeShellUpdateStatus() };
  }
  if (arcadeShellUpdateTriggered) {
    return { started: false, alreadyTriggered: true, status: getArcadeShellUpdateStatus() };
  }
  const updaterPath = process.env.ARCADE_SHELL_UPDATER_BIN || "/usr/local/bin/arcade-shell-updater.mjs";
  if (!import_fs.default.existsSync(updaterPath)) {
    setArcadeShellUpdateState({
      status: "failed",
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      message: `missing updater: ${updaterPath}`,
      reason,
      exitCode: null
    });
    return { started: false, missingUpdater: true, status: getArcadeShellUpdateStatus() };
  }
  arcadeShellUpdateTriggered = true;
  setArcadeShellUpdateState({
    status: "running",
    phase: "shell-check",
    label: "Checking for updates",
    detail: null,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    finishedAt: null,
    message: "[arcade-shell-updater] starting",
    reason,
    exitCode: null
  });
  const child = (0, import_child_process.spawn)(updaterPath, ["--manual"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  arcadeShellUpdateChild = child;
  const handleOutput = (chunk) => {
    const statusPrefix = "[arcade-shell-updater:status] ";
    const lines = String(chunk || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;
    for (const line of lines) {
      if (line.startsWith(statusPrefix)) {
        try {
          const payload = JSON.parse(line.slice(statusPrefix.length));
          const nextState = {};
          if (typeof payload.phase === "string") nextState.phase = payload.phase;
          if (typeof payload.label === "string") nextState.label = payload.label;
          if ("detail" in payload) {
            nextState.detail = typeof payload.detail === "string" && payload.detail.trim() ? payload.detail : null;
          }
          if (typeof payload.message === "string") {
            nextState.message = payload.message;
          } else if (typeof payload.label === "string") {
            nextState.message = [payload.label, payload.detail].filter(Boolean).join(": ");
          }
          if (typeof payload.completed === "number") nextState.completed = payload.completed;
          if (typeof payload.total === "number") nextState.total = payload.total;
          setArcadeShellUpdateState(nextState);
          continue;
        } catch (error) {
          console.warn("[arcade-shell-updater] failed to parse status line", error);
        }
      }
      setArcadeShellUpdateState({ message: line });
      console.log(line);
    }
  };
  child.stdout.on("data", handleOutput);
  child.stderr.on("data", handleOutput);
  child.on("error", (err) => {
    arcadeShellUpdateChild = null;
    arcadeShellUpdateTriggered = false;
    setArcadeShellUpdateState({
      status: "failed",
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      message: err.message,
      exitCode: null
    });
  });
  child.on("exit", (code) => {
    arcadeShellUpdateChild = null;
    arcadeShellUpdateTriggered = false;
    setArcadeShellUpdateState({
      status: code === 0 ? "completed" : "failed",
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      exitCode: code
    });
  });
  return { started: true, status: getArcadeShellUpdateStatus() };
}
async function startVirtualDevices() {
  virtualP1 = startVirtualDevice("Arcade Virtual P1");
  await sleep(VIRTUAL_DEVICE_STAGGER_MS);
  virtualP2 = startVirtualDevice("Arcade Virtual P2");
  console.log("[VIRTUAL] P1 then P2 initialized");
}
function mapIndexToKey(index) {
  switch (index) {
    // Keep the virtual pad in standard RetroPad order.
    case 0:
      return BTN_SOUTH;
    case 1:
      return BTN_EAST;
    case 2:
      return BTN_NORTH;
    case 3:
      return BTN_WEST;
    case 4:
      return BTN_TL;
    case 5:
      return BTN_TR;
    // Support both legacy 6/7 and modern 8/9 select/start layouts.
    case 6:
    case 8:
      return BTN_SELECT;
    case 7:
    case 9:
      return BTN_START;
    // Some encoders expose dpad as digital buttons.
    case 10:
      return BTN_DPAD_UP;
    case 11:
      return BTN_DPAD_DOWN;
    case 12:
      return BTN_DPAD_LEFT;
    case 13:
      return BTN_DPAD_RIGHT;
    default:
      return null;
  }
}
function resolveRetroInputSource(source) {
  if (source === "CASINO" && RETROARCH_PRIMARY_INPUT === "CASINO") {
    return "P1";
  }
  return source;
}
function getRetroVirtualTarget(source) {
  const mapped = resolveRetroInputSource(source);
  if (mapped === "P1") return virtualP1;
  if (mapped === "P2") return virtualP2;
  return null;
}
function canAcceptRetroarchStop() {
  if (!retroarchActive) return false;
  if (!retroarchStartedAt) return true;
  return Date.now() - retroarchStartedAt >= RETROARCH_EXIT_GUARD_MS;
}
function canAcceptRetroarchStartInput() {
  if (!retroarchActive) return false;
  if (RETROARCH_TTY_X_SESSION && !import_fs.default.existsSync(RETROARCH_READY_FILE)) return false;
  if (!retroarchStartedAt) return true;
  return Date.now() - retroarchStartedAt >= RETROARCH_START_INPUT_GUARD_MS;
}
function clearRetroarchExitConfirm() {
  retroarchExitConfirmUntil = 0;
  if (arcadeOverlayNotice?.slot === "center" && arcadeOverlayNotice?.text === "EXIT GAME?") {
    clearArcadeOverlayNotice();
  }
}
function handleRetroarchMenuExitIntent() {
  if (!CASINO_MENU_EXITS_RETROARCH) return false;
  if (retroarchStopping) {
    console.warn("[LAUNCH] Ignored \u2014 RetroArch stopping");
    return true;
  }
  if (!canAcceptRetroarchStop()) {
    console.log("[RETROARCH] MENU ignored by guard", {
      elapsedMs: retroarchStartedAt ? Date.now() - retroarchStartedAt : null,
      guardMs: RETROARCH_EXIT_GUARD_MS
    });
    return true;
  }
  const now = Date.now();
  if (retroarchExitConfirmUntil > now) {
    clearRetroarchExitConfirm();
    requestRetroarchStop("menu");
    return true;
  }
  retroarchExitConfirmUntil = now + RETROARCH_EXIT_CONFIRM_WINDOW_MS;
  setArcadeOverlayNotice("EXIT GAME?", RETROARCH_EXIT_CONFIRM_WINDOW_MS, "center");
  showArcadeOsdMessage(composeArcadeOsdOverlay("EXIT GAME?"), {
    bypassCooldown: true,
    urgent: true
  });
  console.log("[RETROARCH] MENU exit armed", {
    windowMs: RETROARCH_EXIT_CONFIRM_WINDOW_MS
  });
  return true;
}
function sendVirtual(proc, type, code, value) {
  if (!proc || !proc.stdin.writable) return;
  proc.stdin.write(`${type} ${code} ${value}
`);
  proc.stdin.write(`${EV_SYN} ${SYN_REPORT} 0
`);
}
function getJsIndexFromSymlink(path2) {
  try {
    const target = import_fs.default.readlinkSync(path2);
    const match = target.match(/(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
var INPUT_DEVICE_RETRY_MISSING_MS = 250;
var INPUT_DEVICE_RETRY_ERROR_MS = 1e3;
var INPUT_DEVICE_RETRY_ENODEV_MS = 150;
var waitingInputDevices = /* @__PURE__ */ new Set();
var inputDeviceStates = /* @__PURE__ */ new Map();
function logInputLinks(reason = "snapshot") {
  console.log("[INPUT LINK]", {
    reason,
    casino: getJsIndexFromSymlink("/dev/input/casino"),
    player1: getJsIndexFromSymlink("/dev/input/player1"),
    player2: getJsIndexFromSymlink("/dev/input/player2")
  });
}
logInputLinks("boot");
function getInputLinkState() {
  const casino = getJsIndexFromSymlink("/dev/input/casino");
  const player12 = getJsIndexFromSymlink("/dev/input/player1");
  const player22 = getJsIndexFromSymlink("/dev/input/player2");
  return {
    casino,
    player1: player12,
    player2: player22,
    missing: {
      casino: casino === null,
      player1: player12 === null,
      player2: player22 === null
    },
    waiting: Array.from(waitingInputDevices.values()),
    healthy: casino !== null && player12 !== null && player22 !== null
  };
}
function describeInputPath(path2) {
  try {
    const realPath = import_fs.default.realpathSync(path2);
    return {
      path: path2,
      exists: true,
      realPath
    };
  } catch (error) {
    return {
      path: path2,
      exists: import_fs.default.existsSync(path2),
      realPath: null,
      error: error?.message || String(error || "unknown error")
    };
  }
}
function getInputDeviceState(path2, label) {
  let state = inputDeviceStates.get(path2);
  if (state) return state;
  state = {
    path: path2,
    label,
    fd: null,
    retryTimer: null,
    opening: false,
    generation: 0,
    realPath: null
  };
  inputDeviceStates.set(path2, state);
  return state;
}
function clearInputDeviceRetry(state) {
  if (state?.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
}
function closeInputDeviceFd(state) {
  if (!state || state.fd === null) return;
  const fd = state.fd;
  state.fd = null;
  import_fs.default.close(fd, () => {
  });
}
function scheduleInputDeviceRestart(state, reason, delay) {
  if (!state) return;
  closeInputDeviceFd(state);
  state.opening = false;
  if (state.retryTimer) return;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    startEventDevice(state.path, state.label);
  }, delay);
  console.log(`[${state.label}] restart scheduled`, { reason, delay });
}
function startEventDevice(path2, label) {
  if (!IS_PI) {
    console.log(`[${label}] compat-mode skipping ${path2}`);
    return;
  }
  const state = getInputDeviceState(path2, label);
  clearInputDeviceRetry(state);
  if (state.fd !== null || state.opening) return;
  if (!import_fs.default.existsSync(path2)) {
    if (!waitingInputDevices.has(path2)) {
      waitingInputDevices.add(path2);
      console.log(`[WAIT] ${label} waiting for ${path2}`);
      logInputLinks(`${label.toLowerCase()}-waiting`);
    }
    scheduleInputDeviceRestart(state, "missing", INPUT_DEVICE_RETRY_MISSING_MS);
    return;
  }
  if (waitingInputDevices.delete(path2)) {
    console.log(`[READY] ${label} detected`, describeInputPath(path2));
    logInputLinks(`${label.toLowerCase()}-ready`);
  }
  const openDetail = describeInputPath(path2);
  console.log(`[${label}] Opening`, openDetail);
  state.opening = true;
  const generation = ++state.generation;
  import_fs.default.open(path2, "r", (err, fd) => {
    if (generation !== state.generation) {
      state.opening = false;
      if (!err && Number.isInteger(fd)) import_fs.default.close(fd, () => {
      });
      return;
    }
    if (err) {
      state.opening = false;
      console.error(`[${label}] open error`, {
        path: path2,
        detail: describeInputPath(path2),
        error: err?.message || err
      });
      scheduleInputDeviceRestart(state, "open-error", INPUT_DEVICE_RETRY_ERROR_MS);
      return;
    }
    state.opening = false;
    state.fd = fd;
    state.realPath = openDetail.realPath || null;
    const buffer = Buffer.alloc(24);
    function readLoop() {
      import_fs.default.read(fd, buffer, 0, 24, null, (err2, bytesRead) => {
        if (generation !== state.generation || state.fd !== fd) {
          import_fs.default.close(fd, () => {
          });
          return;
        }
        if (err2 || bytesRead !== 24) {
          const errorMessage = err2?.message || err2 || null;
          const retryDelay = typeof errorMessage === "string" && errorMessage.includes("ENODEV") ? INPUT_DEVICE_RETRY_ENODEV_MS : INPUT_DEVICE_RETRY_ERROR_MS;
          console.error(`[${label}] read error`, {
            path: path2,
            bytesRead,
            detail: describeInputPath(path2),
            error: errorMessage
          });
          logInputLinks(`${label.toLowerCase()}-read-error`);
          closeInputDeviceFd(state);
          scheduleInputDeviceRestart(state, "read-error", retryDelay);
          return;
        }
        const type = buffer.readUInt16LE(16);
        const code = buffer.readUInt16LE(18);
        const value = buffer.readInt32LE(20);
        handleRawEvent(label, type, code, value);
        readLoop();
      });
    }
    readLoop();
  });
}
function handleRawEvent(source, type, code, value) {
  if (type === EV_KEY) {
    const index = resolveKeyName(code);
    if (index === null) return;
    const player = normalizeArcadePlayer(source);
    if (player && value === 1) {
      lastGameplayInputAt[player] = Date.now();
    }
    handleKey(source, index, value);
  }
  if (type === EV_ABS) {
    handleRawAxis(source, code, value);
  }
}
function resolveKeyName(code) {
  const index = RAW_BUTTON_MAP[code];
  if (index === void 0) return null;
  return index;
}
function handleRawAxis(source, code, value) {
  const DEAD_LOW = 40;
  const DEAD_HIGH = 215;
  const shouldSwapP2Axes = source === "P2" && retroarchActive && RETROARCH_P2_SWAP_AXES;
  const effectiveCode = shouldSwapP2Axes ? code === 0 ? 1 : code === 1 ? 0 : code : code;
  const effectiveValue = value;
  if (!retroarchActive) {
    if (code === 0) {
      if (value < DEAD_LOW) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick LEFT");
        }
        dispatch({ type: "PLAYER", player: source, button: "LEFT" });
      } else if (value > DEAD_HIGH) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick RIGHT");
        }
        dispatch({ type: "PLAYER", player: source, button: "RIGHT" });
      }
    }
    if (code === 1) {
      if (value < DEAD_LOW) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick UP");
        }
        dispatch({ type: "PLAYER", player: source, button: "UP" });
      } else if (value > DEAD_HIGH) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick DOWN");
        }
        dispatch({ type: "PLAYER", player: source, button: "DOWN" });
      }
    }
    return;
  }
  const mappedSource = resolveRetroInputSource(source);
  const target = getRetroVirtualTarget(source);
  if (!target || !retroarchActive) return;
  if (arcadeSession?.active) {
    if (isArcadeTimeLockActive()) return;
  }
  if (value !== 0 && shouldPromoteArcadeSessionToLive(mappedSource, -1)) {
    markArcadeSessionLive("axis_input");
  }
  const state = dpadState[mappedSource];
  function press(keyName, keyCode) {
    if (state[keyName]) return;
    state[keyName] = true;
    sendVirtual(target, EV_KEY, keyCode, 1);
  }
  function release(keyName, keyCode) {
    if (!state[keyName]) return;
    state[keyName] = false;
    sendVirtual(target, EV_KEY, keyCode, 0);
  }
  if (effectiveCode === 0) {
    if (effectiveValue < DEAD_LOW) {
      press("left", BTN_DPAD_LEFT);
      release("right", BTN_DPAD_RIGHT);
    } else if (effectiveValue > DEAD_HIGH) {
      press("right", BTN_DPAD_RIGHT);
      release("left", BTN_DPAD_LEFT);
    } else {
      release("left", BTN_DPAD_LEFT);
      release("right", BTN_DPAD_RIGHT);
    }
  }
  if (effectiveCode === 1) {
    if (effectiveValue < DEAD_LOW) {
      press("up", BTN_DPAD_UP);
      release("down", BTN_DPAD_DOWN);
    } else if (effectiveValue > DEAD_HIGH) {
      press("down", BTN_DPAD_DOWN);
      release("up", BTN_DPAD_UP);
    } else {
      release("up", BTN_DPAD_UP);
      release("down", BTN_DPAD_DOWN);
    }
  }
}
function handleKey(source, index, value) {
  if (index === void 0 || index === null) return;
  const player = normalizeArcadePlayer(source);
  if (arcadeSession?.active && player) {
    const hasTime = !isArcadeTimeLockActive();
    const isBuyInput = JOYSTICK_BUTTON_MAP[index] === "BUY";
    const isMenuInput = JOYSTICK_BUTTON_MAP[index] === "MENU";
    if (!hasTime && !isBuyInput && !isMenuInput) {
      return;
    }
    if (gameOverState[player]) {
      return;
    }
  }
  if (source === "CASINO") {
    const casinoAction = JOYSTICK_BUTTON_MAP[index];
    if (value === 1 && arcadeSession?.active && retroarchActive) {
      const now = Date.now();
      const isStart = isStartButton(index);
      const isPurchase = isLifePurchaseButton(index);
      const isGameplay = !isStart && !isPurchase;
      lastGameInputAt = now;
      if (isStart && arcadeSession.sessionPhase === "prestart") {
        console.log("[HEURISTIC] SESSION START DETECTED", {
          from: "prestart"
        });
        arcadeSession.sessionPhase = "live";
        maybeStartArcadeTimeSession("start_pressed");
        startArcadeTimeLoop();
        broadcastArcadeLifeState("session_start_detected", {
          reason: "start_pressed"
        });
      }
      if (isGameplay) {
        const player3 = normalizeArcadePlayer(source);
        if (player3) {
          lastGameplayInputAt[player3] = now;
        }
      }
    }
    if (retroarchActive && isBlockedCasinoActionDuringRetroarch(casinoAction)) {
      console.log(`[CASINO] blocked during RetroArch: ${casinoAction}`);
      return;
    }
    if (value === 1 && JOYSTICK_BUTTON_MAP[index] === "BUY") {
      const isArcadeContext = retroarchActive && !!retroarchCurrentGameId;
      if (!isArcadeContext) {
        dispatch({ type: "ACTION", action: "BUY" });
        return;
      }
      if (buyState === "processing") return;
      handleBuyPressed();
      return;
    }
    if (retroarchActive && RETROARCH_PRIMARY_INPUT === "CASINO") {
      if (value === 1 && JOYSTICK_BUTTON_MAP[index] === "MENU" && CASINO_MENU_EXITS_RETROARCH) {
        handleRetroarchMenuExitIntent();
        return;
      }
      routePlayerInput("P1", index, value);
      return;
    }
    if (retroarchActive && arcadeSession?.active) {
      const primaryPlayer = normalizeArcadePlayer(RETROARCH_PRIMARY_INPUT) || "P1";
      const primaryLocked = !playerHasStoredCredit(primaryPlayer);
      const casinoAction2 = JOYSTICK_BUTTON_MAP[index];
      if (primaryLocked) {
        if (casinoAction2 === "MENU" && CASINO_MENU_EXITS_RETROARCH) {
          if (value === 1) handleRetroarchMenuExitIntent();
          return;
        }
      }
    }
    if (!retroarchActive && value === 1) {
      if (index === 7) {
        dispatch({ type: "PLAYER", player: "CASINO", button: 7 });
        return;
      }
    }
    if (value !== 1) return;
    if (retroarchActive && casinoAction === "MENU" && CASINO_MENU_EXITS_RETROARCH) {
      handleRetroarchMenuExitIntent();
      return;
    }
    switch (casinoAction) {
      case "COIN":
        handleDepositPulse();
        break;
      case "HOPPER_COIN":
        void recordHopperTopup(HOPPER_TOPUP_COIN_VALUE);
        dispatch({
          type: "HOPPER_COIN",
          amount: HOPPER_TOPUP_COIN_VALUE
        });
        break;
      case "WITHDRAW_COIN":
        handleWithdrawPulse();
        break;
      default:
        dispatch({ type: "ACTION", action: casinoAction });
        break;
    }
    return;
  }
  routePlayerInput(source, index, value);
}
function routePlayerInput(source, index, value) {
  const keyCode = mapIndexToKey(index);
  if (!keyCode) return;
  if (retroarchActive) {
    const target = getRetroVirtualTarget(source);
    if (!target) return;
    const player = normalizeArcadePlayer(source);
    if (!player) return;
    const playerAction = JOYSTICK_BUTTON_MAP[index];
    const hasStoredCredit = playerHasStoredCredit(player);
    const needsCredit = !hasStoredCredit;
    if (arcadeSession?.active) {
      const player3 = normalizeArcadePlayer(source);
      if (!player3) return;
      const hasTime = Number(arcadeSession.arcadeTimeMs || 0) > 0;
      if (isStartButton(index)) {
        if (value === 1) {
          clearRetroarchExitConfirm();
        }
        if (value === 1 && arcadeContinueCountdownTimers[player3]) {
          console.log("[ARCADE] CONTINUE", { player: player3 });
          clearArcadeContinueCountdown(player3);
          broadcastArcadeLifeState("continue", {
            player: player3
          });
        }
        if (!canAcceptRetroarchStartInput()) {
          if (value === 1) {
            console.log("[RETROARCH] START ignored by launch guard", {
              elapsedMs: retroarchStartedAt ? Date.now() - retroarchStartedAt : null,
              guardMs: RETROARCH_START_INPUT_GUARD_MS,
              player: player3
            });
          }
          return;
        }
        if (!hasTime) {
          if (value === 1) {
            const priceText = getArcadeSessionPrice().toFixed(2);
            const prompt = `TIME LOCKED | PRESS ${getArcadeLifePromptActionLabel()} (P${priceText})`;
            setArcadeOverlayNotice("TIME LOCKED", 1800, player3 === "P1" ? "left" : "right");
            showArcadeOsdMessage(composeArcadeOsdOverlay(prompt), {
              bypassCooldown: true,
              urgent: true
            });
            broadcastArcadeLifeState("time_locked", {
              player: player3,
              balance: arcadeSession.lastKnownBalance,
              arcadeTimeMs: arcadeSession.arcadeTimeMs || 0
            });
          }
          return;
        }
        if (arcadeOverlayNotice?.slot === (player3 === "P1" ? "left" : "right")) {
          clearArcadeOverlayNotice();
        }
        if (handleSimultaneousRetroarchStart(player3, target, value)) {
          return;
        }
        sendVirtual(target, EV_KEY, keyCode, value);
        return;
      }
    }
    if (value === 1 && playerAction === "MENU" && !isStartButton(index) && CASINO_MENU_EXITS_RETROARCH) {
      handleRetroarchMenuExitIntent();
      return;
    }
    if (value === 1 && shouldPromoteArcadeSessionToLive(player, index)) {
      markArcadeSessionLive("player_input");
    }
    sendVirtual(target, EV_KEY, keyCode, value);
  } else {
    if (value !== 1) return;
    if (source === "P1" && (index === 0 || index === 1)) {
      console.log(
        `[MODAL DEBUG] P1 button ${index} press (${index === 0 ? "confirm/select" : "dismiss keyboard"})`
      );
    }
    dispatch({
      type: "PLAYER",
      player: source,
      button: index
    });
  }
}
function switchToVT(vt, reason) {
  if (SINGLE_X_MODE) return true;
  if (!RETROARCH_USE_TTY_MODE) return true;
  if (!IS_PI) return true;
  const result = (0, import_child_process.spawnSync)("chvt", [vt], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(
      `[VT] chvt ${vt} failed (${reason})`,
      result.stderr?.trim() || result.error?.message || ""
    );
    return false;
  }
  console.log(`[VT] switched to ${vt} (${reason})`);
  return true;
}
function switchToVTWithRetry(vt, reason, attempts = 5, delayMs = 150) {
  if (SINGLE_X_MODE) return;
  if (!RETROARCH_USE_TTY_MODE) return;
  if (!IS_PI) return;
  let remaining = attempts;
  const attempt = () => {
    const ok = switchToVT(vt, `${reason}#${attempts - remaining + 1}`);
    if (ok) return;
    remaining -= 1;
    if (remaining <= 0) return;
    setTimeout(attempt, delayMs);
  };
  attempt();
}
function scheduleForceSwitchToUI(reason, delayMs = 300) {
  if (SINGLE_X_MODE) return;
  if (!RETROARCH_USE_TTY_MODE || !IS_PI) return;
  if (pendingUiFallbackTimer !== null) {
    clearTimeout(pendingUiFallbackTimer);
    pendingUiFallbackTimer = null;
  }
  const targetUiVT = getTargetUiVT();
  const waitMs = Math.max(0, Math.round(delayMs));
  pendingUiFallbackTimer = setTimeout(() => {
    pendingUiFallbackTimer = null;
    switchToVTWithRetry(targetUiVT, `${reason}-timer`);
    setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-timer-post`), 120);
  }, waitMs);
  console.log(`[VT] scheduled fallback to ${targetUiVT} (${reason})`);
}
function clearScheduledForceSwitchToUI() {
  if (pendingUiFallbackTimer === null) return;
  clearTimeout(pendingUiFallbackTimer);
  pendingUiFallbackTimer = null;
}
function clearRetroarchStopTimers() {
  if (retroarchStopTermTimer !== null) {
    clearTimeout(retroarchStopTermTimer);
    retroarchStopTermTimer = null;
  }
  if (retroarchStopForceTimer !== null) {
    clearTimeout(retroarchStopForceTimer);
    retroarchStopForceTimer = null;
  }
}
var arcadeOverlayNotice = null;
var arcadeOverlayNoticeTimer = null;
function clearArcadeOverlayNotice() {
  if (arcadeOverlayNoticeTimer !== null) {
    clearTimeout(arcadeOverlayNoticeTimer);
    arcadeOverlayNoticeTimer = null;
  }
  arcadeOverlayNotice = null;
  refreshArcadeOsdMessage();
}
function setArcadeOverlayNotice(text, ttlMs = 1600, slot = "center") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    clearArcadeOverlayNotice();
    return;
  }
  arcadeOverlayNotice = {
    text: clean,
    slot: slot === "left" || slot === "right" || slot === "center" ? slot : "center"
  };
  refreshArcadeOsdMessage();
  if (arcadeOverlayNoticeTimer !== null) {
    clearTimeout(arcadeOverlayNoticeTimer);
    arcadeOverlayNoticeTimer = null;
  }
  if (Number.isFinite(ttlMs) && ttlMs > 0) {
    arcadeOverlayNoticeTimer = setTimeout(
      () => {
        arcadeOverlayNoticeTimer = null;
        arcadeOverlayNotice = null;
        refreshArcadeOsdMessage();
      },
      Math.max(250, ttlMs)
    );
  }
}
function refreshArcadeOsdMessage() {
  if (!arcadeSession?.active) return;
  const promptMessage = buildArcadePromptMessage();
  const message = promptMessage || composeArcadeOsdOverlay("");
  const changed = promptMessage !== lastArcadePromptLoopMessage;
  showArcadeOsdMessage(message, { bypassCooldown: changed || !promptMessage });
  lastArcadePromptLoopMessage = promptMessage;
  lastArcadePromptLoopSentAt = Date.now();
}
function maybeRestartUiAfterExit(reason) {
  const abnormalExit = typeof reason === "string" && (reason.includes("crash") || reason.includes("segfault") || reason.includes("abnormal"));
  if (RETROARCH_TTY_X_SESSION) {
    restartArcadeUiAfterRetroarch(reason, abnormalExit);
    return;
  }
  if (!IS_PI || !RETROARCH_USE_TTY_MODE || !RESTART_UI_ON_EXIT || shuttingDown) return;
  const now = Date.now();
  if (now - lastUiRestartAt < UI_RESTART_COOLDOWN_MS) return;
  lastUiRestartAt = now;
  const proc = (0, import_child_process.spawn)("systemctl", ["restart", "arcade-ui.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  console.log(`[UI] restart requested after game exit (${reason})`);
}
function killRetroarchProcess(signal, reason) {
  if (!retroarchProcess) return;
  const pid = retroarchProcess.pid;
  try {
    process.kill(-pid, signal);
    console.log(`[RETROARCH] group ${signal} (${reason}) pid=${pid}`);
    return;
  } catch {
  }
  try {
    retroarchProcess.kill(signal);
    console.log(`[RETROARCH] child ${signal} (${reason}) pid=${pid}`);
  } catch (err) {
    console.error("[RETROARCH] kill failed", err.message);
  }
}
function sendRetroarchSignal(signal, reason) {
  if (!retroarchProcess) return;
  killRetroarchProcess(signal, reason);
}
function finalizeRetroarchExit(reason) {
  if (!retroarchActive && !retroarchProcess) return;
  const wasActive = retroarchActive;
  const targetUiVT = getTargetUiVT();
  const abnormalExit = typeof reason === "string" && (reason.includes("crash") || reason.includes("segfault") || reason.includes("abnormal"));
  clearRetroarchStopTimers();
  clearRetroarchExitConfirm();
  clearRetroarchReadyWatch();
  retroarchActive = false;
  retroarchStopping = false;
  retroarchProcess = null;
  lastExitTime = Date.now();
  lastExitedGameId = arcadeSession?.gameId || retroarchCurrentGameId || lastExitedGameId;
  retroarchCurrentGameId = null;
  retroarchStartedAt = 0;
  resetRetroarchStartPressState("P1");
  resetRetroarchStartPressState("P2");
  stopArcadeTimeLoop();
  arcadeSession.arcadeSessionStartedAt = null;
  arcadeSession.arcadeTimeLastDeductedAt = null;
  if (retroarchLogFd !== null) {
    try {
      import_fs.default.closeSync(retroarchLogFd);
    } catch {
    }
    retroarchLogFd = null;
  }
  stopSplashForRetroarch(reason);
  if (SINGLE_X_MODE) {
    restoreChromiumUiAfterRetroarch();
  } else {
    switchToVTWithRetry(targetUiVT, reason);
    setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-post`), 120);
    scheduleForceSwitchToUI(`${reason}-detached`);
    if (abnormalExit) {
      setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-crash-retry`, 8, 250), 300);
      setTimeout(() => maybeRestartUiAfterExit(`${reason}-crash-ui-restart`), 400);
    }
  }
  if (wasActive) {
    clearArcadeLifeSession(reason);
    dispatch({ type: "GAME_EXITED" });
    setTimeout(() => maybeRestartUiAfterExit(reason), 50);
  }
}
function requestRetroarchStop(reason) {
  clearRetroarchExitConfirm();
  if (!retroarchActive) return;
  dispatch({ type: "GAME_EXITING", reason });
  const targetUiVT = getTargetUiVT();
  if (!retroarchProcess) {
    console.warn("[RETROARCH] stop requested with no process");
    finalizeRetroarchExit(`${reason}-missing-process`);
    return;
  }
  if (retroarchStopping) return;
  retroarchStopping = true;
  clearRetroarchStopTimers();
  const stopTargetPid = retroarchProcess.pid;
  sendRetroarchSignal("SIGINT", `${reason}-graceful`);
  if (SINGLE_X_MODE) {
    console.log("[DISPLAY] waiting for RetroArch exit on DISPLAY=:0");
  } else {
    console.log(`[VT] waiting for RetroArch exit before returning to ${targetUiVT}`);
  }
  retroarchStopTermTimer = setTimeout(() => {
    retroarchStopTermTimer = null;
    if (!retroarchActive) return;
    if (!retroarchProcess || retroarchProcess.pid !== stopTargetPid) return;
    sendRetroarchSignal("SIGTERM", `${reason}-term-fallback`);
  }, RETROARCH_TERM_FALLBACK_MS);
  retroarchStopForceTimer = setTimeout(() => {
    retroarchStopForceTimer = null;
    if (!retroarchActive) return;
    if (!retroarchProcess || retroarchProcess.pid !== stopTargetPid) return;
    console.warn("[RETROARCH] force-killing hung process");
    killRetroarchProcess("SIGKILL", `${reason}-force`);
    finalizeRetroarchExit(`${reason}-force-ui`);
  }, RETROARCH_STOP_GRACE_MS);
}
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[SYSTEM] SHUTDOWN START");
  try {
    gpioOff(HOPPER_PAY_PIN);
    if (hopperCtl) {
      hopperCtl.kill("SIGTERM");
      hopperCtl = null;
    }
    gpioOff(COIN_INHIBIT_PIN);
    if (coinCtl) {
      coinCtl.kill("SIGTERM");
      coinCtl = null;
    }
    player1?.removeAllListeners?.();
    player2?.removeAllListeners?.();
    player1?.close?.();
    player2?.close?.();
    clearArcadeLifeSession("shutdown");
    requestRetroarchStop("shutdown");
    clearRetroarchStopTimers();
    clearScheduledForceSwitchToUI();
    if (sseClients.size > 0) {
      for (const client of [...sseClients]) {
        try {
          client.end();
        } catch {
        }
        sseClients.delete(client);
      }
    }
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
  } catch (err) {
    console.error("[SHUTDOWN ERROR]", err);
  }
  console.log("[SYSTEM] SHUTDOWN COMPLETE");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  console.log("Process exiting...");
});
if (IS_PI) {
  startVirtualDevices().then(() => {
    startEventDevice("/dev/input/casino", "CASINO");
    startEventDevice("/dev/input/player1", "P1");
    startEventDevice("/dev/input/player2", "P2");
  }).catch((err) => {
    console.error("[BOOT] hardware init failed", err);
    process.exit(1);
  });
} else {
  console.log("[INPUT] compat-mode: hardware readers disabled");
}
var PORT = 5174;
var wifiOperationInFlight = false;
function execCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    (0, import_child_process.execFile)(command, args, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
async function rescanWifiNetworks() {
  await execCommand("nmcli", ["device", "wifi", "rescan"]);
}
async function listWifiNetworks({ rescan = false } = {}) {
  if (rescan) {
    try {
      await rescanWifiNetworks();
    } catch (error) {
      console.warn("[WIFI] rescan warning", error?.stderr || error?.message || error);
    }
  }
  const { stdout } = await execCommand("nmcli", [
    "-t",
    "--escape",
    "no",
    "-f",
    "SSID,SIGNAL",
    "device",
    "wifi",
    "list",
    "--rescan",
    "no"
  ]);
  const strongestBySsid = /* @__PURE__ */ new Map();
  for (const line of String(stdout || "").split("\n").filter(Boolean)) {
    const sep = line.lastIndexOf(":");
    if (sep <= 0) continue;
    const ssid = line.slice(0, sep).trim();
    const signal = Number(line.slice(sep + 1));
    if (!ssid) continue;
    const network = {
      ssid,
      signal: Number.isFinite(signal) ? signal : 0
    };
    const existing = strongestBySsid.get(ssid);
    if (!existing || network.signal > existing.signal) {
      strongestBySsid.set(ssid, network);
    }
  }
  return [...strongestBySsid.values()].sort((a, b) => b.signal - a.signal);
}
async function listKnownWifiProfiles() {
  const { stdout } = await execCommand("nmcli", [
    "-t",
    "--escape",
    "no",
    "-f",
    "NAME,TYPE",
    "connection",
    "show"
  ]);
  const profiles = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (const line of String(stdout || "").split("\n").filter(Boolean)) {
    const parts = line.split(":");
    if (parts.length < 2) continue;
    const id = (parts[0] || "").trim();
    const type = (parts[1] || "").trim();
    if (!id) continue;
    if (!(type === "wifi" || type === "802-11-wireless" || type === "wireless")) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    let ssid = id;
    try {
      const { stdout: ssidStdout } = await execCommand("nmcli", [
        "--escape",
        "no",
        "-g",
        "802-11-wireless.ssid",
        "connection",
        "show",
        id
      ]);
      const resolvedSsid = String(ssidStdout || "").trim();
      if (resolvedSsid) ssid = resolvedSsid;
    } catch (error) {
      console.warn("[WIFI] profile ssid fallback", id, error?.stderr || error?.message || error);
    }
    profiles.push({ id, ssid });
  }
  return profiles;
}
function readHardwareSerial() {
  if (!IS_PI) {
    const host = import_os.default.hostname() || "dev-host";
    return `dev-${host.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24).toLowerCase()}`;
  }
  try {
    const raw = import_fs.default.readFileSync("/sys/firmware/devicetree/base/serial-number");
    return raw.toString("utf8").replace(/\u0000/g, "").replace(/[^a-fA-F0-9]/g, "").trim();
  } catch (err) {
    console.error("[DEVICE] Failed to read hardware serial", err);
    return null;
  }
}
var DEVICE_ID = readHardwareSerial();
if (!DEVICE_ID) {
  console.error("FATAL: No hardware serial found");
  process.exit(1);
}
console.log("[DEVICE] ID =", DEVICE_ID);
function getMimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
import_fs.default.mkdirSync(RUNTIME_GAMES_DIR, { recursive: true });
function sanitizePathSegment(value, fallback = "default") {
  const safe = String(value ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  return safe || fallback;
}
function getRuntimeGameDir(gameId, version) {
  return import_path.default.join(
    RUNTIME_GAMES_DIR,
    sanitizePathSegment(gameId, "game"),
    sanitizePathSegment(version, "1")
  );
}
function getRuntimeGameEntry(gameId, version) {
  const safeId = sanitizePathSegment(gameId, "game");
  const safeVersion = sanitizePathSegment(version, "1");
  return `/runtime-games/${safeId}/${safeVersion}/index.html`;
}
function setJsonCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
function scheduleSystemPowerAction(action) {
  const command = action === "restart" ? "reboot" : "poweroff";
  console.log(`[SYSTEM] ${command} requested`);
  setTimeout(() => {
    if (!IS_PI) {
      console.log(`[SYSTEM] ${command} simulated (compat mode)`);
      return;
    }
    if (retroarchActive) {
      requestRetroarchStop(`system-${command}`);
    }
    const primary = (0, import_child_process.spawn)("systemctl", [command], {
      stdio: "ignore",
      detached: true
    });
    primary.on("error", (err) => {
      console.error(`[SYSTEM] systemctl ${command} failed, trying fallback`, err.message);
      const fallback = (0, import_child_process.spawn)(command, [], {
        stdio: "ignore",
        detached: true
      });
      fallback.unref();
    });
    primary.unref();
  }, 400);
}
function scheduleManagedServiceRestart(serviceName, delayMs = 400) {
  const safeServiceName = String(serviceName || "").trim();
  if (!safeServiceName) return;
  console.log(`[SYSTEM] restart requested for ${safeServiceName}`);
  setTimeout(() => {
    if (!IS_PI) {
      console.log(`[SYSTEM] restart simulated for ${safeServiceName} (compat mode)`);
      return;
    }
    const restartCommand = `sleep 0.5; systemctl restart ${safeServiceName}`;
    const proc = (0, import_child_process.spawn)("sh", ["-lc", restartCommand], {
      stdio: "ignore",
      detached: true
    });
    proc.unref();
  }, delayMs);
}
function getPackageKey() {
  const keyHex = process.env.GAME_PACKAGE_KEY_HEX || "";
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) return null;
  return Buffer.from(keyHex, "hex");
}
function getDevCasinoEntryEnvKey(gameId) {
  return `ARCADE_DEV_CASINO_ENTRY_${String(gameId || "").trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
}
function isAllowedCompatEntryUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (!["localhost", "127.0.0.1"].includes(host)) return false;
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if ([3001, 5173, 5174].includes(port)) return false;
    return true;
  } catch {
    return false;
  }
}
async function probeCompatEntryUrl(entryUrl) {
  try {
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-L",
      "--max-time",
      "2",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      entryUrl
    ]);
    const status = Number.parseInt(String(stdout || "").trim(), 10);
    return Number.isFinite(status) && status >= 200 && status < 400;
  } catch {
    return false;
  }
}
async function resolveCompatGamePackageEntry({ id, packageUrl }) {
  if (IS_PI) return null;
  const gameId = String(id || "").trim().toLowerCase();
  const candidates = [];
  const gameSpecificEnv = process.env[getDevCasinoEntryEnvKey(gameId)];
  if (gameSpecificEnv) candidates.push(gameSpecificEnv);
  if (gameId === "ultraace" && process.env.ULTRAACE_DEV_URL) {
    candidates.push(process.env.ULTRAACE_DEV_URL);
  }
  if (isAllowedCompatEntryUrl(packageUrl)) {
    candidates.push(packageUrl);
  }
  if (gameId === "ultraace") {
    candidates.push(
      "http://127.0.0.1:4173",
      "http://localhost:4173",
      "http://127.0.0.1:4174",
      "http://localhost:4174",
      "http://127.0.0.1:5175",
      "http://localhost:5175",
      "http://127.0.0.1:4175",
      "http://localhost:4175"
    );
  }
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const entry = String(candidate || "").trim();
    if (!entry || seen.has(entry) || !isAllowedCompatEntryUrl(entry)) continue;
    seen.add(entry);
    if (await probeCompatEntryUrl(entry)) {
      return {
        entry,
        installed: false,
        cached: false,
        compatBypass: true
      };
    }
  }
  return null;
}
async function installEncryptedGamePackage({ id, packageUrl, version, force = false }) {
  const key = getPackageKey();
  if (!key) {
    throw new Error("GAME_PACKAGE_KEY_HEX is missing or invalid");
  }
  const gameId = sanitizePathSegment(id, "game");
  const gameVersion = sanitizePathSegment(version, "1");
  const installDir = getRuntimeGameDir(gameId, gameVersion);
  const markerPath = import_path.default.join(installDir, ".installed.json");
  const entryPath = import_path.default.join(installDir, "index.html");
  if (!force && import_fs.default.existsSync(markerPath)) {
    if (normalizeRuntimeIndexHtml(entryPath)) {
      return {
        entry: getRuntimeGameEntry(gameId, gameVersion),
        installed: true,
        cached: true
      };
    }
  }
  const downloadPath = import_path.default.join(import_os.default.tmpdir(), `arcade-${gameId}-${gameVersion}-${Date.now()}.enc`);
  let encrypted;
  try {
    await execFileAsync("curl", ["-fsSL", "--max-time", "30", "--output", downloadPath, packageUrl]);
    encrypted = import_fs.default.readFileSync(downloadPath);
    if (encrypted.length < 29) {
      throw new Error("invalid encrypted payload");
    }
  } finally {
    import_fs.default.rmSync(downloadPath, { force: true });
  }
  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(12, 28);
  const cipherText = encrypted.subarray(28);
  const decipher = (0, import_crypto.createDecipheriv)("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let plainTar;
  try {
    plainTar = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  } catch {
    throw new Error("decrypt failed: auth check failed");
  }
  import_fs.default.rmSync(installDir, { recursive: true, force: true });
  import_fs.default.mkdirSync(installDir, { recursive: true });
  const tmpTarPath = import_path.default.join(import_os.default.tmpdir(), `arcade-${gameId}-${gameVersion}-${Date.now()}.tar.gz`);
  import_fs.default.writeFileSync(tmpTarPath, plainTar);
  const untar = (0, import_child_process.spawnSync)("tar", ["-xzf", tmpTarPath, "-C", installDir], {
    stdio: "pipe",
    encoding: "utf8"
  });
  import_fs.default.rmSync(tmpTarPath, { force: true });
  if (untar.status !== 0) {
    throw new Error(`extract failed: ${untar.stderr || untar.stdout || untar.status}`);
  }
  if (!import_fs.default.existsSync(entryPath)) {
    throw new Error("invalid package: missing index.html");
  }
  normalizeRuntimeIndexHtml(entryPath);
  import_fs.default.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        gameId,
        version: gameVersion,
        installedAt: (/* @__PURE__ */ new Date()).toISOString(),
        packageSha256: (0, import_crypto.createHash)("sha256").update(encrypted).digest("hex")
      },
      null,
      2
    )
  );
  return {
    entry: getRuntimeGameEntry(gameId, gameVersion),
    installed: true,
    cached: false
  };
}
function normalizeRuntimeIndexHtml(indexPath) {
  if (!import_fs.default.existsSync(indexPath)) return false;
  let html = import_fs.default.readFileSync(indexPath, "utf8");
  const original = html;
  html = html.replace(/(src|href)="\/assets\//g, '$1="./assets/');
  if (html !== original) {
    import_fs.default.writeFileSync(indexPath, html);
  }
  return true;
}
var NO_AUDIO_DEVICE_PATTERN = /cannot find card|no such file|mixer attach|audio open error|invalid ctl|default.*not found/i;
function isNoAudioDeviceError(error, stderr = "") {
  const message = `${error?.message || ""}
${stderr || ""}`;
  return NO_AUDIO_DEVICE_PATTERN.test(message);
}
function parseSpeakerVolumeState(controlStdout, stateStdout) {
  const controlText = String(controlStdout || "");
  const stateText = String(stateStdout || "");
  const rawRangeMatch = controlText.match(/min=(\d+),max=(\d+)/);
  const rawValueMatch = controlText.match(/:\s*values=(\d+)(?:,(\d+))?/);
  const dbRangeMatch = controlText.match(/dBminmaxmute-min=([-\d.]+)dB,max=([-\d.]+)dB/);
  const dbValueMatch = stateText.match(/\[([-\d.]+)dB\]/);
  if (!rawRangeMatch || !rawValueMatch) {
    throw new Error("Unable to parse Speaker control range");
  }
  const rawMin = Number(rawRangeMatch[1]);
  const rawMax = Number(rawRangeMatch[2]);
  const rawValue = Number(rawValueMatch[1]);
  const dbMin = dbRangeMatch ? Number(dbRangeMatch[1]) : null;
  const dbMax = dbRangeMatch ? Number(dbRangeMatch[2]) : null;
  const dbValue = dbValueMatch ? Number(dbValueMatch[1]) : null;
  const percent = rawMax > rawMin ? Math.round((rawValue - rawMin) / (rawMax - rawMin) * 100) : 0;
  return {
    success: true,
    control: "Speaker",
    rawValue,
    rawMin,
    rawMax,
    percent: Math.max(0, Math.min(100, percent)),
    db: dbValue,
    dbMin,
    dbMax,
    volume: dbValue === null ? `${percent}%` : `${dbValue.toFixed(1)} dB`
  };
}
async function getSpeakerVolumeState() {
  try {
    const control = await execFileAsync("amixer", ["-c", "0", "cget", "numid=6"]);
    const state = await execFileAsync("amixer", ["-c", "0", "sget", "Speaker"]);
    return parseSpeakerVolumeState(control.stdout, state.stdout);
  } catch (error) {
    if (isNoAudioDeviceError(error, error?.stderr || "")) {
      return {
        success: false,
        error: "NO_AUDIO_DEVICE",
        volume: "NO AUDIO DEVICE",
        percent: null,
        db: null,
        dbMin: null,
        dbMax: null
      };
    }
    throw error;
  }
}
function removeRuntimeGamePackage({ id, version, allVersions = false }) {
  const gameId = sanitizePathSegment(id, "game");
  if (allVersions) {
    const gameRoot = import_path.default.join(RUNTIME_GAMES_DIR, gameId);
    import_fs.default.rmSync(gameRoot, { recursive: true, force: true });
    return { removed: true, path: gameRoot };
  }
  const gameVersion = sanitizePathSegment(version, "1");
  const installDir = getRuntimeGameDir(gameId, gameVersion);
  import_fs.default.rmSync(installDir, { recursive: true, force: true });
  return { removed: true, path: installDir };
}
function purgeRuntimeGamePackages() {
  import_fs.default.rmSync(RUNTIME_GAMES_DIR, { recursive: true, force: true });
  import_fs.default.mkdirSync(RUNTIME_GAMES_DIR, { recursive: true });
  return { purged: true };
}
function getNetworkInfo() {
  const nets = import_os.default.networkInterfaces();
  const getExternalIpv4 = (name) => {
    const entries = nets[name] || [];
    return entries.find((e) => e && e.family === "IPv4" && !e.internal) || null;
  };
  if (!IS_PI) {
    const entries = Object.entries(nets).map(([name, list]) => ({
      name,
      ipv4: (list || []).find((entry) => entry && entry.family === "IPv4" && !entry.internal) || null
    })).filter((entry) => entry.ipv4);
    const wifiEntry = entries.find((entry) => /^(wi-?fi|wlan|wl|airport|en0)$/i.test(entry.name)) || null;
    const ethernetEntry = entries.find(
      (entry) => entry.name !== wifiEntry?.name && /^(eth|en|bridge|lan)/i.test(entry.name)
    ) || null;
    const fallbackEntry = entries[0] || null;
    return {
      ethernet: ethernetEntry?.ipv4?.address || (!wifiEntry ? fallbackEntry?.ipv4?.address || null : null),
      wifi: wifiEntry?.ipv4?.address || null,
      ethernet_name: ethernetEntry?.name || (!wifiEntry ? fallbackEntry?.name || null : null),
      wifi_name: wifiEntry?.name || null,
      latency_ms: lastLatencyMs
    };
  }
  return {
    ethernet: getExternalIpv4("eth0")?.address || null,
    wifi: getExternalIpv4("wlan0")?.address || null,
    ethernet_name: getExternalIpv4("eth0") ? "ETHERNET" : null,
    wifi_name: getExternalIpv4("wlan0") ? "wlan0" : null,
    latency_ms: lastLatencyMs
  };
}
function getCoreCandidates(coreValue) {
  const normalized = String(coreValue ?? "").trim().toLowerCase().replace(/\\/g, "/").replace(/^.*\//, "").replace(/\.so$/i, "").replace(/_libretro$/i, "").replace(/-/g, "_");
  const candidates = [];
  if (normalized) {
    candidates.push(normalized);
  }
  if (normalized === "ps1" || normalized === "psx" || normalized === "playstation" || normalized.includes("psx") || normalized.includes("playstation")) {
    candidates.push(...PS1_CORE_ALIASES);
  }
  return Array.from(new Set(candidates));
}
function resolveCorePath(coreValue) {
  const coreCandidates = getCoreCandidates(coreValue);
  const attempted = [];
  for (const coreName of coreCandidates) {
    for (const baseDir of LIBRETRO_DIR_CANDIDATES) {
      const soPath = import_path.default.join(baseDir, `${coreName}_libretro.so`);
      attempted.push(soPath);
      if (import_fs.default.existsSync(soPath)) {
        return { path: soPath, coreName, attempted };
      }
    }
  }
  return { path: null, coreName: null, attempted };
}
function resolveRomPath(romValue) {
  const raw = String(romValue ?? "").trim();
  if (!raw) return null;
  const normalizedRaw = raw.replace(/\\/g, "/").trim();
  const romRelative = normalizedRaw.replace(/^\/+/, "").replace(/^(\.\.\/)+roms\//, "").replace(/^roms\//, "");
  const candidates = [
    raw,
    import_path.default.resolve(SERVICE_DIR, raw),
    import_path.default.resolve(ARCADE_RUNTIME_DIR, raw),
    import_path.default.resolve(ROMS_ROOT, raw),
    import_path.default.join(ROMS_ROOT, romRelative)
  ];
  for (const candidate of candidates) {
    const resolved = import_path.default.resolve(candidate);
    if (import_fs.default.existsSync(resolved)) {
      return resolved;
    }
  }
  console.error("[ROM RESOLVE] not found", {
    raw,
    romRelative,
    serviceDir: SERVICE_DIR,
    runtimeDir: ARCADE_RUNTIME_DIR,
    romsRoot: ROMS_ROOT,
    candidates: candidates.map((candidate) => import_path.default.resolve(candidate))
  });
  return null;
}
var server = import_http.default.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "OPTIONS" && req.url.startsWith("/game-package/")) {
    setJsonCors(res);
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/device-id") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        deviceId: DEVICE_ID,
        isPi: IS_PI,
        compatMode: !IS_PI,
        devInputBypass: DEV_INPUT_BYPASS_ENABLED,
        platform: process.platform
      })
    );
    return;
  }
  if (req.method === "POST" && req.url === "/device-register") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
      if (body2.length > 32 * 1024) {
        req.destroy(new Error("Payload too large"));
      }
    });
    req.on("end", async () => {
      try {
        const payload = body2 ? JSON.parse(body2) : {};
        const requestedDeviceId = String(payload?.deviceId || DEVICE_ID || "").trim() || DEVICE_ID;
        await ensureDeviceRegistered(requestedDeviceId);
        return sendJson(res, 200, {
          success: true,
          deviceId: requestedDeviceId
        });
      } catch (error) {
        console.error("[DEVICE] local register failed", error);
        return sendJson(res, 500, {
          success: false,
          error: "DEVICE_REGISTER_FAILED",
          message: String(error?.message || error || "unknown error")
        });
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/dev-input") {
    if (!DEV_INPUT_BYPASS_ENABLED) {
      return sendJson(res, 403, { success: false, error: "DEV_INPUT_DISABLED" });
    }
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body2 || "{}");
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return sendJson(res, 400, { success: false, error: "INVALID_PAYLOAD" });
        }
        broadcast(payload);
        return sendJson(res, 200, { success: true, forwarded: true });
      } catch (error) {
        console.error("[DEV INPUT] invalid payload", error);
        return sendJson(res, 400, { success: false, error: "INVALID_JSON" });
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/dev-coin-drop") {
    if (!DEV_INPUT_BYPASS_ENABLED) {
      return sendJson(res, 403, { success: false, error: "DEV_INPUT_DISABLED" });
    }
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
      if (body2.length > 32 * 1024) {
        req.destroy(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        const payload = body2 ? JSON.parse(body2) : {};
        const pulses = Number(payload?.pulses ?? 4);
        const validPulses = Math.max(1, Math.min(10, Math.round(pulses)));
        depositPulseCount = validPulses;
        depositStartTime = Date.now();
        depositLastPulseTime = depositStartTime;
        finalizeDepositCoin();
        return sendJson(res, 200, { success: true, pulses: validPulses });
      } catch (error) {
        console.error("[DEV COIN DROP] invalid payload", error);
        return sendJson(res, 400, { success: false, error: "INVALID_JSON" });
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/network-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getNetworkInfo()));
    return;
  }
  if (req.method === "GET" && req.url === "/withdraw-limits") {
    ;
    (async () => {
      try {
        const state = IS_PI && hasSupabaseRpcConfig() ? await fetchDeviceFinancialState(DEVICE_ID) : null;
        const balance = toMoney(state?.balance, 0);
        const hopperBalance = toMoney(state?.hopperBalance, 0);
        const withdrawEnabled = Boolean(state?.withdrawEnabled);
        const configuredMax = state ? getMaxWithdrawalAmountForHopperBalance(hopperBalance) : null;
        const maxWithdrawalAmount = !withdrawEnabled || configuredMax === null ? null : Math.max(0, Math.min(balance, hopperBalance, configuredMax));
        return sendJson(res, 200, {
          success: true,
          balance,
          hopperBalance,
          maxWithdrawalAmount,
          configuredMax,
          enabled: Boolean(IS_PI && hasSupabaseRpcConfig() && withdrawEnabled)
        });
      } catch (error) {
        console.error("[WITHDRAW] limits fetch failed", error);
        return sendJson(res, 500, { success: false, error: "WITHDRAW_LIMITS_FAILED" });
      }
    })();
    return;
  }
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("\n");
    sseClients.add(res);
    console.log("[SSE] client connected");
    checkInternetOnce().then((online) => {
      const hasLink = hasLocalNetworkLink();
      const effectiveOnline = getCompatOnlineState(online, hasLink);
      sendSse(res, { type: effectiveOnline ? "INTERNET_OK" : "INTERNET_LOST" });
    }).catch(() => {
      sendSse(res, { type: hasLocalNetworkLink() ? "INTERNET_OK" : "INTERNET_LOST" });
    });
    req.on("close", () => {
      sseClients.delete(res);
      console.log("[SSE] client disconnected");
    });
    return;
  }
  if (req.method === "GET" && req.url === "/arcade-shell-update/status") {
    return sendJson(res, 200, { success: true, ...getArcadeShellUpdateStatus() });
  }
  if (req.method === "GET" && req.url === "/input-link-status") {
    return sendJson(res, 200, { success: true, ...getInputLinkState() });
  }
  if (req.method === "GET" && req.url === "/network-state") {
    return sendJson(res, 200, {
      success: true,
      internetState,
      internetLastStableState,
      compatOnline: lastInternetState,
      hasLocalLink: hasLocalNetworkLink(),
      wifi: getNetworkInfo()?.wifi || null,
      ethernet: getNetworkInfo()?.ethernet || null
    });
  }
  if (req.method === "GET" && req.url === "/arcade-life/overlay-state") {
    return sendJson(res, 200, { success: true, ...getArcadeRetroOverlayState() });
  }
  if (req.method === "GET" && req.url === "/wifi-scan") {
    if (!IS_PI) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify([
          { ssid: "DEV_WIFI", signal: 85 },
          { ssid: "DEV_HOTSPOT", signal: 62 }
        ])
      );
    }
    ;
    (async () => {
      try {
        const networks = await listWifiNetworks({ rescan: true });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(networks));
      } catch (error) {
        console.error("[WIFI] Scan failed", error?.stderr || error?.message || error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "WIFI_SCAN_FAILED" }));
      }
    })();
    return;
  }
  if (req.method === "GET" && req.url === "/wifi-known") {
    if (!IS_PI) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify([
          { ssid: "DEV_WIFI", type: "wifi" },
          { ssid: "DEV_HOTSPOT", type: "wifi" }
        ])
      );
    }
    ;
    (async () => {
      try {
        const profiles = await listKnownWifiProfiles();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(profiles));
      } catch (error) {
        console.error("[WIFI] Known profiles scan failed", error?.stderr || error?.message || error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "WIFI_KNOWN_FAILED" }));
      }
    })();
    return;
  }
  if (req.method === "GET") {
    const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
    const safePath = import_path.default.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, "");
    if (safePath === "/arcade-shell-build.json") {
      const versionFilePath = import_path.default.join(ARCADE_RUNTIME_DIR, "os", ".arcade-shell-version");
      let version = "";
      let createdAt = null;
      try {
        if (import_fs.default.existsSync(versionFilePath)) {
          version = String(import_fs.default.readFileSync(versionFilePath, "utf8") || "").trim();
          const stats = import_fs.default.statSync(versionFilePath);
          createdAt = stats.mtime.toISOString();
        }
      } catch (err) {
        console.error("Build metadata read error:", err);
      }
      if (!version) {
        version = String(process.env.ARCADE_SHELL_VERSION || "").trim();
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache"
      });
      return res.end(
        JSON.stringify({
          version: version || "unknown",
          created_at: createdAt
        })
      );
    }
    if (safePath === "/boot.png") {
      const bootPath = import_path.default.join(ARCADE_RUNTIME_DIR, "os", "boot", "boot.png");
      if (!import_fs.default.existsSync(bootPath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        const data = import_fs.default.readFileSync(bootPath);
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=3600"
        });
        return res.end(data);
      } catch (err) {
        console.error("Boot image read error:", err);
        res.writeHead(500);
        return res.end("Server error");
      }
    }
    if (safePath.startsWith("/roms/")) {
      const romAssetPath = safePath.replace(/^\/roms\//, "");
      const filePath2 = import_path.default.join(ROMS_ROOT, romAssetPath);
      if (!filePath2.startsWith(ROMS_ROOT)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      if (!import_fs.default.existsSync(filePath2)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        const data = import_fs.default.readFileSync(filePath2);
        res.writeHead(200, {
          "Content-Type": getMimeType(filePath2),
          "Cache-Control": "public, max-age=3600"
        });
        return res.end(data);
      } catch (err) {
        console.error("ROM static read error:", err);
        res.writeHead(500);
        return res.end("Server error");
      }
    }
    if (safePath.startsWith("/runtime-games/")) {
      const runtimePath = safePath.replace("/runtime-games/", "");
      let filePath2 = import_path.default.join(RUNTIME_GAMES_DIR, runtimePath);
      if (!filePath2.startsWith(RUNTIME_GAMES_DIR)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      if (safePath.endsWith("/")) {
        filePath2 = import_path.default.join(filePath2, "index.html");
      }
      if (!import_fs.default.existsSync(filePath2)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        const data = import_fs.default.readFileSync(filePath2);
        const isHtml = filePath2.endsWith(".html");
        res.writeHead(200, {
          "Content-Type": getMimeType(filePath2),
          "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000"
        });
        return res.end(data);
      } catch (err) {
        console.error("Runtime static read error:", err);
        res.writeHead(500);
        return res.end("Server error");
      }
    }
    if (safePath === "/cabinet-games") {
      const requestedDeviceId = parsedUrl.searchParams.get("deviceId") || DEVICE_ID;
      fetchCabinetGamesForDevice(requestedDeviceId).then((games) => {
        sendJson(res, 200, { success: true, deviceId: requestedDeviceId, games });
      }).catch((error) => {
        console.error("[CABINET GAMES] endpoint failed", error?.message || error);
        sendJson(res, 500, { success: false, deviceId: requestedDeviceId, games: [] });
      });
      return;
    }
    if (safePath === "/system/volume") {
      getSpeakerVolumeState().then((state) => {
        sendJson(res, 200, state);
      }).catch((error) => {
        console.error("[AUDIO] volume read failed", error?.message || error);
        sendJson(res, 500, { success: false, error: "VOLUME_READ_FAILED" });
      });
      return;
    }
    let filePath = import_path.default.join(DIST_DIR, safePath === "/" ? "index.html" : safePath);
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (!import_fs.default.existsSync(filePath)) {
      filePath = import_path.default.join(DIST_DIR, "index.html");
    }
    console.log("Serving:", filePath);
    try {
      const data = import_fs.default.readFileSync(filePath);
      const isHtml = filePath.endsWith(".html");
      res.writeHead(200, {
        "Content-Type": getMimeType(filePath),
        "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000"
      });
      return res.end(data);
    } catch (err) {
      console.error("Static read error:", err);
      res.writeHead(500);
      return res.end("Server error");
    }
  }
  if (req.method === "POST" && req.url === "/wifi-connect") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        const { ssid, password } = JSON.parse(body2 || "{}");
        if (!ssid || !password) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing credentials" }));
        }
        if (!IS_PI) {
          console.log("[WIFI] compat-mode connect accepted for", ssid);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
          broadcast({ type: "INTERNET_RESTORED" });
          return;
        }
        if (wifiOperationInFlight) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "WIFI_BUSY" }));
        }
        wifiOperationInFlight = true;
        console.log("[WIFI] Attempting connection to", ssid);
        const nm = (0, import_child_process.spawn)("nmcli", ["device", "wifi", "connect", ssid, "password", password]);
        let nmStderr = "";
        nm.stderr?.on("data", (chunk) => {
          nmStderr += String(chunk || "");
        });
        nm.on("close", async (code) => {
          if (code !== 0) {
            wifiOperationInFlight = false;
            console.error("[WIFI] nmcli failed with code", code, nmStderr.trim());
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ success: false }));
          }
          setTimeout(async () => {
            const online = await checkInternetOnce();
            wifiOperationInFlight = false;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: online }));
            if (online) {
              broadcast({ type: "INTERNET_RESTORED" });
            }
          }, 3e3);
        });
      } catch (e) {
        wifiOperationInFlight = false;
        console.error("[WIFI] Invalid request", e);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/wifi-connect-known") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        const { id, ssid } = JSON.parse(body2 || "{}");
        const profileId = String(id || ssid || "").trim();
        if (!profileId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing profile" }));
        }
        if (!IS_PI) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
          broadcast({ type: "INTERNET_RESTORED" });
          return;
        }
        if (wifiOperationInFlight) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "WIFI_BUSY" }));
        }
        wifiOperationInFlight = true;
        console.log("[WIFI] Activating known profile", profileId);
        (0, import_child_process.exec)("nmcli device disconnect wlan0 || true", (err) => {
          if (err) {
            console.warn("[WIFI] wlan0 disconnect pre-step warning", err.message);
          }
        });
        const nm = (0, import_child_process.spawn)("nmcli", ["connection", "up", "id", profileId]);
        let nmStderr = "";
        nm.stderr?.on("data", (chunk) => {
          nmStderr += String(chunk || "");
        });
        nm.on("close", async (code) => {
          if (code !== 0) {
            wifiOperationInFlight = false;
            console.error("[WIFI] known profile activation failed with code", code, nmStderr.trim());
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ success: false }));
          }
          setTimeout(async () => {
            const online = await checkInternetOnce();
            wifiOperationInFlight = false;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: online }));
            if (online) {
              broadcast({ type: "INTERNET_RESTORED" });
            }
          }, 2e3);
        });
      } catch (e) {
        wifiOperationInFlight = false;
        console.error("[WIFI] Invalid known profile request", e);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/wifi-delete-known") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        const { id, ssid } = JSON.parse(body2 || "{}");
        const profileId = String(id || "").trim();
        const profileSsid = String(ssid || "").trim();
        if (!profileId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing profile" }));
        }
        if (!IS_PI) {
          console.log("[WIFI] compat-mode delete accepted for", profileId);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true }));
        }
        let activeSsid = "";
        try {
          const { stdout: activeStdout } = await execCommand("nmcli", [
            "-t",
            "--escape",
            "no",
            "-f",
            "ACTIVE,SSID",
            "device",
            "wifi",
            "list",
            "--rescan",
            "no"
          ]);
          const activeLine = String(activeStdout || "").split("\n").find((line) => line.startsWith("yes:"));
          activeSsid = activeLine ? activeLine.replace(/^yes:/, "").trim() : "";
        } catch (error) {
          console.warn(
            "[WIFI] active SSID lookup failed before delete",
            error?.stderr || error?.message || error
          );
        }
        if (profileSsid && activeSsid && profileSsid === activeSsid) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "CONNECTED_PROFILE" }));
        }
        console.log("[WIFI] Deleting known profile", profileId);
        const { stderr } = await execCommand("nmcli", ["connection", "delete", "id", profileId]);
        if (stderr && String(stderr).trim()) {
          console.warn("[WIFI] delete known profile stderr", String(stderr).trim());
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error("[WIFI] delete known profile failed", e?.stderr || e?.message || e);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "DELETE_FAILED" }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/game-package/prepare") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        setJsonCors(res);
        const { id, packageUrl, version, force } = JSON.parse(body2 || "{}");
        if (!id || !packageUrl) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing id or packageUrl" }));
        }
        const compatResult = await resolveCompatGamePackageEntry({
          id,
          packageUrl
        });
        const result = compatResult || await installEncryptedGamePackage({
          id,
          packageUrl,
          version: version ?? 1,
          force: Boolean(force)
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        console.error("[GAME PACKAGE] prepare failed", err);
        setJsonCors(res);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/game-package/remove") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        setJsonCors(res);
        const { id, version, allVersions } = JSON.parse(body2 || "{}");
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing id" }));
        }
        const result = removeRuntimeGamePackage({
          id,
          version: version ?? 1,
          allVersions: Boolean(allVersions)
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        console.error("[GAME PACKAGE] remove failed", err);
        setJsonCors(res);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/game-package/purge") {
    try {
      setJsonCors(res);
      const result = purgeRuntimeGamePackages();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      console.error("[GAME PACKAGE] purge failed", err);
      setJsonCors(res);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
    }
  }
  if (req.method === "POST" && req.url === "/system/restart") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      try {
        if (body2) JSON.parse(body2);
      } catch {
      }
      sendJson(res, 200, { success: true, action: "restart", scheduled: true });
      scheduleSystemPowerAction("restart");
    });
    return;
  }
  if (req.method === "POST" && req.url === "/system/restart-input") {
    try {
      sendJson(res, 200, { success: true, service: "arcade-input.service", scheduled: true });
      scheduleManagedServiceRestart("arcade-input.service");
    } catch (error) {
      console.error("[SYSTEM] input restart failed", error);
      return sendJson(res, 500, { success: false, error: "INPUT_RESTART_FAILED" });
    }
    return;
  }
  if (req.method === "POST" && req.url === "/system/shutdown") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      try {
        if (body2) JSON.parse(body2);
      } catch {
      }
      sendJson(res, 200, { success: true, action: "shutdown", scheduled: true });
      scheduleSystemPowerAction("shutdown");
    });
    return;
  }
  if (req.method === "POST" && req.url === "/system/volume") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      let direction = "up";
      try {
        const payload = body2 ? JSON.parse(body2) : {};
        direction = String(payload.direction || "up").trim().toLowerCase() === "down" ? "down" : "up";
      } catch {
      }
      try {
        const current = await getSpeakerVolumeState();
        if (current.error === "NO_AUDIO_DEVICE") {
          return sendJson(res, 200, current);
        }
        let stepCount = 1;
        try {
          const payload = body2 ? JSON.parse(body2) : {};
          const parsedStep = Number(payload.step ?? 1);
          if (Number.isFinite(parsedStep)) {
            stepCount = Math.max(1, Math.min(8, Math.round(parsedStep)));
          }
        } catch {
        }
        const step = direction === "down" ? -stepCount : stepCount;
        const nextRaw = Math.max(current.rawMin, Math.min(current.rawMax, current.rawValue + step));
        await execFileAsync("amixer", ["-c", "0", "cset", "numid=6", `${nextRaw},${nextRaw}`]);
        await execFileAsync("amixer", ["-c", "0", "cset", "numid=5", "on,on"]).catch(() => {
        });
        const updated = await getSpeakerVolumeState();
        return sendJson(res, 200, {
          ...updated,
          direction
        });
      } catch (error) {
        console.error("[AUDIO] volume adjust failed", error?.message || error);
        return sendJson(res, 500, { success: false, error: "VOLUME_ADJUST_FAILED" });
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/arcade-shell-update/run") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      let reason = "manual";
      try {
        const payload = body2 ? JSON.parse(body2) : {};
        if (typeof payload.reason === "string" && payload.reason.trim()) {
          reason = payload.reason.trim();
        }
      } catch {
      }
      const result = triggerArcadeShellUpdate(reason);
      return sendJson(res, 200, { success: true, ...result });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/arcade-life/balance") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      try {
        const { balance } = JSON.parse(body2 || "{}");
        const nextBalance = toMoney(balance, NaN);
        if (!Number.isFinite(nextBalance)) {
          console.warn("[ARCADE LIFE BALANCE] invalid payload", body2);
          return sendJson(res, 400, { success: false, error: "Invalid balance" });
        }
        if (!arcadeSession?.active) {
          console.warn("[ARCADE LIFE BALANCE] rejected (no active session)", {
            nextBalance
          });
          return sendJson(res, 403, { success: false, error: "NOT_IN_SESSION" });
        }
        console.log("[ARCADE LIFE BALANCE] push", {
          nextBalance,
          active: Boolean(arcadeSession?.active)
        });
        const previous = arcadeSession.lastKnownBalance;
        const changed = previous !== nextBalance;
        arcadeSession.lastKnownBalance = nextBalance;
        noteArcadeBalancePush(nextBalance);
        if (changed) {
          console.log("[ARCADE LIFE BALANCE] applied", {
            previous,
            next: nextBalance
          });
          broadcastArcadeLifeState("balance_push", { balance: nextBalance });
          showArcadeOsdMessage(composeArcadeOsdOverlay(""), { bypassCooldown: true });
        }
        return sendJson(res, 200, { success: true, balance: nextBalance });
      } catch (err) {
        console.warn("[ARCADE LIFE BALANCE] invalid JSON", err?.message || err);
        return sendJson(res, 400, { success: false, error: "Invalid JSON" });
      }
    });
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      let onRetroarchStarted2 = function() {
        if (!arcadeSession?.active) {
          console.warn("[ARCADE TIME] retroarch started but no session");
        } else {
          maybeStartArcadeTimeSession("retroarch_started");
          startArcadeTimeLoop();
        }
        stopSplashForRetroarch("retroarch-ready");
      };
      var onRetroarchStarted = onRetroarchStarted2;
      const payload = JSON.parse(body || "{}");
      console.log("[INPUT HTTP]", payload);
      if (payload.type === "WITHDRAW") {
        if (retroarchActive) {
          console.log("[HOPPER] blocked HTTP withdraw during RetroArch");
          res.writeHead(409);
          return res.end("Withdraw blocked during RetroArch");
        }
        if (withdrawRequestInFlight) {
          res.writeHead(409);
          return res.end("Withdrawal already in progress");
        }
        withdrawRequestInFlight = true;
        try {
          const validation = await validateWithdrawRequest(payload.amount);
          if (!validation.ok) {
            console.warn("[HOPPER] withdraw rejected", validation);
            res.writeHead(validation.status || 409);
            return res.end(validation.error || "Withdraw rejected");
          }
          startHopper(validation.amount);
          res.writeHead(200);
          return res.end("OK");
        } finally {
          withdrawRequestInFlight = false;
        }
      }
      if (payload.type === "LAUNCH_GAME") {
        if (typeof payload.core !== "string" || typeof payload.rom !== "string") {
          res.writeHead(400);
          return res.end("Missing core or rom");
        }
        const payloadGameId = String(payload.id || "").trim();
        const payloadGameName = String(payload.name || "").trim();
        const payloadPrice = toMoney(payload.price, ARCADE_LIFE_PRICE_DEFAULT);
        const payloadBalance = toMoney(payload.balance, 0);
        const payloadJoinMode = normalizeArcadeJoinMode(payload.joinMode);
        const duplicateLaunchDuringRecovery = Boolean(payloadGameId) && Boolean(lastExitedGameId) && payloadGameId === lastExitedGameId && Date.now() - lastExitTime < RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS;
        let gameProfile = {
          gameId: payloadGameId || import_path.default.basename(payload.rom || "") || "unknown",
          gameName: payloadGameName || payloadGameId || "Arcade Game",
          pricePerLife: payloadPrice > 0 ? payloadPrice : ARCADE_LIFE_PRICE_DEFAULT,
          joinMode: payloadJoinMode,
          initialBalance: payloadBalance
        };
        if (retroarchStopping) {
          console.warn("[LAUNCH] Ignored \u2014 RetroArch stopping");
          res.writeHead(409);
          return res.end("Stopping");
        }
        if (retroarchActive) {
          console.warn("[LAUNCH] Ignored \u2014 RetroArch already active");
          res.writeHead(409);
          return res.end("Already running");
        }
        if (payloadPrice > 0 && payloadBalance < payloadPrice) {
          console.warn("[LAUNCH] Ignored \u2014 insufficient balance", {
            gameId: payloadGameId,
            balance: payloadBalance,
            price: payloadPrice
          });
          res.writeHead(402);
          return res.end("Insufficient balance");
        }
        if (Date.now() - lastExitTime < RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS) {
          if (duplicateLaunchDuringRecovery) {
            console.log("[LAUNCH] Ignored \u2014 duplicate launch during exit recovery", {
              gameId: payloadGameId,
              cooldownMs: RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS
            });
            res.writeHead(409);
            return res.end("Duplicate launch during recovery");
          }
          console.log("[LAUNCH] Ignored \u2014 cooldown", {
            cooldownMs: RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS
          });
          res.writeHead(409);
          return res.end("Cooling down");
        }
        const needsGameProfileFetch = payloadGameId && (!payloadGameName || payloadPrice <= 0 || !payload.joinMode || normalizeArcadeJoinMode(payload.joinMode) !== payloadJoinMode);
        if (needsGameProfileFetch) {
          const fetchedGameProfile = await fetchGameProfileForArcadeLife(payloadGameId);
          if (fetchedGameProfile) {
            gameProfile = {
              ...gameProfile,
              ...fetchedGameProfile,
              initialBalance: payloadBalance
            };
          }
        }
        if (hasSupabaseRpcConfig()) {
          try {
            const deviceState = await fetchDeviceFinancialState(DEVICE_ID);
            if (deviceState) {
              gameProfile = {
                ...gameProfile,
                initialBalance: deviceState.balance,
                initialArcadeTimeMs: deviceState.arcadeTimeMs
              };
            }
          } catch (error) {
            console.warn("[ARCADE LIFE] launch state hydrate failed", error?.message || error);
          }
        }
        if (!IS_PI) {
          console.log("[LAUNCH] compat-mode simulated arcade launch");
          retroarchActive = true;
          retroarchStopping = false;
          clearRetroarchExitConfirm();
          retroarchStartedAt = Date.now();
          startArcadeLifeSession(gameProfile);
          setTimeout(() => {
            finalizeRetroarchExit("compat-simulated");
          }, 250);
          res.writeHead(200);
          return res.end("OK");
        }
        console.log("[LAUNCH] emulator");
        retroarchActive = true;
        retroarchStopping = false;
        retroarchCurrentGameId = gameProfile.gameId;
        clearRetroarchExitConfirm();
        retroarchStartedAt = Date.now();
        const romPath = resolveRomPath(payload.rom);
        if (!romPath) {
          retroarchActive = false;
          stopArcadeTimeLoop();
          arcadeSession.arcadeSessionStartedAt = null;
          arcadeSession.arcadeTimeLastDeductedAt = null;
          retroarchStopping = false;
          retroarchCurrentGameId = null;
          retroarchStartedAt = 0;
          clearArcadeLifeSession("launch-rom-missing");
          console.error("[LAUNCH] ROM not found", { rom: payload.rom });
          res.writeHead(400);
          return res.end(`ROM not found: ${payload.rom}`);
        }
        const core = resolveCorePath(payload.core);
        if (!core.path) {
          retroarchActive = false;
          stopArcadeTimeLoop();
          arcadeSession.arcadeSessionStartedAt = null;
          arcadeSession.arcadeTimeLastDeductedAt = null;
          retroarchStopping = false;
          retroarchCurrentGameId = null;
          retroarchStartedAt = 0;
          clearArcadeLifeSession("launch-core-missing");
          console.error("[LAUNCH] Core not found", {
            core: payload.core,
            attempted: core.attempted
          });
          res.writeHead(400);
          return res.end(`Core not found: ${payload.core}`);
        }
        console.log("[LAUNCH] resolved", {
          core: core.coreName,
          corePath: core.path,
          romPath,
          gameId: gameProfile.gameId,
          pricePerLife: gameProfile.pricePerLife
        });
        startArcadeLifeSession(gameProfile);
        retroarchLogFd = import_fs.default.openSync(RETROARCH_LOG_PATH, "a");
        clearScheduledForceSwitchToUI();
        dispatch({
          type: "GAME_LAUNCHING",
          gameId: gameProfile.gameId,
          gameName: gameProfile.gameName
        });
        if (SINGLE_X_MODE) {
          hideChromiumUiForRetroarch();
          console.log("[DISPLAY] launching RetroArch into DISPLAY=:0");
        } else {
          const activeVT = getActiveVT();
          if (activeVT) {
            lastUiVT = activeVT;
            console.log(`[VT] captured UI VT ${lastUiVT} before launch`);
          }
          if (RETROARCH_TTY_X_SESSION) {
            stopArcadeUiForRetroarch();
            if (USE_SPLASH_TRANSITIONS) {
              startSplashForRetroarch();
              switchToVT(SPLASH_VT, "launch-splash");
            }
          } else {
            switchToVT(GAME_VT, "launch");
          }
        }
        const command = ["-u", RETROARCH_RUN_USER, "env"];
        if (SINGLE_X_MODE) {
          command.push("DISPLAY=:0", `XAUTHORITY=${RETROARCH_RUN_HOME}/.Xauthority`);
        } else if (!RETROARCH_TTY_X_SESSION) {
          command.push("-u", "DISPLAY", "-u", "XAUTHORITY", "-u", "WAYLAND_DISPLAY");
        }
        command.push(
          `HOME=${RETROARCH_RUN_HOME}`,
          `USER=${RETROARCH_RUN_USER}`,
          `LOGNAME=${RETROARCH_RUN_USER}`,
          `XDG_RUNTIME_DIR=${RETROARCH_RUNTIME_DIR}`,
          `DBUS_SESSION_BUS_ADDRESS=${RETROARCH_DBUS_ADDRESS}`,
          `PULSE_SERVER=${RETROARCH_PULSE_SERVER}`
        );
        let launchCommand = "sudo";
        let launchArgs;
        if (RETROARCH_TTY_X_SESSION) {
          const launcherScript = process.env.RETROARCH_TTY_X_LAUNCHER_SCRIPT || import_path.default.join(ARCADE_RUNTIME_DIR, "os", "bin", "arcade-retro-launch.sh");
          const sessionScript = process.env.RETROARCH_TTY_X_SESSION_SCRIPT || import_path.default.join(ARCADE_RUNTIME_DIR, "os", "bin", "arcade-retro-session.sh");
          launchCommand = "env";
          launchArgs = [
            `ARCADE_RETRO_DISPLAY=:1`,
            `ARCADE_RETRO_VT=vt${GAME_VT}`,
            `ARCADE_RETRO_SESSION_SCRIPT=${sessionScript}`,
            `ARCADE_RETRO_RUN_USER=${RETROARCH_RUN_USER}`,
            `ARCADE_RETRO_RUN_HOME=${RETROARCH_RUN_HOME}`,
            `ARCADE_RETRO_XDG_RUNTIME_DIR=${RETROARCH_RUNTIME_DIR}`,
            `ARCADE_RETRO_DBUS_ADDRESS=${RETROARCH_DBUS_ADDRESS}`,
            `ARCADE_RETRO_PULSE_SERVER=${RETROARCH_PULSE_SERVER}`,
            `ARCADE_RETRO_BIN=${RETROARCH_BIN}`,
            `ARCADE_RETRO_SWITCH_TO_VT=${GAME_VT}`,
            `ARCADE_RETRO_PREWARMED_X=${RETROARCH_TTY_X_PREWARM ? "1" : "0"}`,
            `ARCADE_RETRO_CORE_PATH=${core.path}`,
            `ARCADE_RETRO_ROM_PATH=${romPath}`,
            `ARCADE_RETRO_OVERLAY_URL=http://127.0.0.1:${PORT}/retro-overlay.html`,
            ...RETROARCH_CONFIG_PATH ? [`ARCADE_RETRO_CONFIG_PATH=${RETROARCH_CONFIG_PATH}`] : [],
            launcherScript
          ];
          console.log("[LAUNCH] tty-x-session argv", launchArgs);
        } else {
          if (RETROARCH_USE_DBUS_RUN_SESSION) command.push("dbus-run-session", "--");
          command.push(RETROARCH_BIN, "--fullscreen", "--verbose");
          if (RETROARCH_CONFIG_PATH) {
            command.push("--config", RETROARCH_CONFIG_PATH);
          }
          command.push("-L", core.path, romPath);
          launchArgs = command;
          console.log("[LAUNCH] sudo argv", launchArgs);
        }
        retroarchProcess = (0, import_child_process.spawn)(launchCommand, launchArgs, {
          stdio: ["pipe", retroarchLogFd, retroarchLogFd],
          detached: true
        });
        retroarchProcess.unref();
        retroarchProcess.on("error", (err) => {
          console.error("[PROCESS] RetroArch spawn error", err.message);
          retroarchCurrentGameId = null;
          clearArcadeLifeSession("spawn-error");
          finalizeRetroarchExit("spawn-error");
        });
        retroarchProcess.on("exit", (code, signal) => {
          console.log(`[PROCESS] RetroArch exited code=${code} signal=${signal}`);
          const abnormal = code !== 0 && code !== 130 && code !== 143 && signal !== "SIGINT" && signal !== "SIGTERM";
          finalizeRetroarchExit(abnormal ? `abnormal-exit-code-${code ?? "null"}` : "normal-exit");
        });
        scheduleRetroarchReadyWatch(onRetroarchStarted2);
      }
      startArcadeTimeLoop();
      res.writeHead(200);
      res.end("OK");
    } catch (err) {
      console.error("[INPUT HTTP] Invalid JSON", err);
      res.writeHead(400);
      res.end("Invalid JSON");
    }
  });
});
serverInstance = server.listen(PORT, "127.0.0.1", () => {
  console.log(`[INPUT HTTP] Listening on http://localhost:${PORT}`);
});
var lastInternetState = null;
var internetFailStreak = 0;
var internetOkStreak = 0;
function checkInternetOnce() {
  return checkCabinetBackendReachability().then((res) => res.ok);
}
function hasLocalNetworkLink() {
  const info = getNetworkInfo();
  return Boolean(info?.ethernet || info?.wifi);
}
function getCompatOnlineState(online, hasLink) {
  if (!IS_PI) return Boolean(online || hasLink);
  return Boolean(online);
}
var checkingNetwork = false;
async function monitorInternet() {
  if (checkingNetwork) return;
  checkingNetwork = true;
  const online = await checkInternetOnce();
  const hasLink = hasLocalNetworkLink();
  const effectiveOnline = getCompatOnlineState(online, hasLink);
  checkingNetwork = false;
  if (lastInternetState === null) {
    lastInternetState = effectiveOnline;
    internetOkStreak = effectiveOnline ? 1 : 0;
    internetFailStreak = effectiveOnline ? 0 : 1;
    return;
  }
  if (effectiveOnline) {
    internetOkStreak += 1;
    internetFailStreak = 0;
  } else if (hasLink) {
    internetOkStreak = 0;
    internetFailStreak = 0;
  } else {
    internetFailStreak += 1;
    internetOkStreak = 0;
  }
  if (lastInternetState && internetFailStreak >= INTERNET_FAIL_THRESHOLD) {
    lastInternetState = false;
    internetFailStreak = 0;
    console.warn("[NETWORK] Internet LOST");
    broadcast({ type: "INTERNET_LOST" });
    return;
  }
  if (!lastInternetState && internetOkStreak >= INTERNET_RESTORE_THRESHOLD) {
    lastInternetState = true;
    internetOkStreak = 0;
    console.log("[NETWORK] Internet RESTORED");
    broadcast({ type: "INTERNET_RESTORED" });
  }
}
var wifiReading = false;
function readWifiSignal() {
  if (wifiReading) return;
  wifiReading = true;
  if (!IS_PI) {
    const info = getNetworkInfo();
    const connected = Boolean(info.ethernet || info.wifi);
    wifiReading = false;
    broadcastWifi({
      type: "WIFI_STATUS",
      connected,
      signal: null,
      ssid: info.wifi ? "dev-wifi" : null
    });
    return;
  }
  (0, import_child_process.exec)("nmcli -t -f TYPE,STATE dev", (err, stdout) => {
    if (err || !stdout) {
      wifiReading = false;
      return;
    }
    const lines = stdout.trim().split("\n");
    const wifiConnected = lines.some((line) => {
      const [type, state] = line.split(":");
      return type === "wifi" && state === "connected";
    });
    if (!wifiConnected) {
      wifiReading = false;
      broadcastWifi({ type: "WIFI_STATUS", connected: false, signal: null, ssid: null });
      return;
    }
    ;
    (async () => {
      try {
        const { stdout: stdout2 } = await execCommand("nmcli", [
          "-t",
          "--escape",
          "no",
          "-f",
          "ACTIVE,SSID,SIGNAL",
          "dev",
          "wifi",
          "list",
          "--rescan",
          "no"
        ]);
        wifiReading = false;
        const activeLine = String(stdout2 || "").trim().split("\n").find((line) => line.startsWith("yes:"));
        if (!activeLine) {
          broadcastWifi({ type: "WIFI_STATUS", connected: true, signal: null, ssid: null });
          return;
        }
        const signalSep = activeLine.lastIndexOf(":");
        const left = signalSep > -1 ? activeLine.slice(0, signalSep) : activeLine;
        const signalRaw = signalSep > -1 ? activeLine.slice(signalSep + 1) : "";
        const ssid = left.replace(/^yes:/, "").trim() || null;
        const signal = Number(signalRaw ?? 0);
        broadcastWifi({
          type: "WIFI_STATUS",
          connected: true,
          signal: Number.isFinite(signal) ? signal : null,
          ssid
        });
      } catch (error) {
        wifiReading = false;
        console.error("[WIFI] status read failed", error?.stderr || error?.message || error);
      }
    })();
  });
}
var lastWifiState = null;
function broadcastWifi(state) {
  const serialized = JSON.stringify(state);
  if (serialized === lastWifiState) return;
  lastWifiState = serialized;
  broadcast(state);
}
readWifiSignal();
setInterval(readWifiSignal, 5e3);
setInterval(monitorInternet, INTERNET_MONITOR_INTERVAL_MS);
