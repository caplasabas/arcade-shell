// index.js

import express from 'express'
import {spawn} from 'child_process'
import {endSession, notifyInput, startGame, startLaunch,} from './session.js'
import {addBalance} from './balance.js'
import {getOverlayState} from './overlay.js'

const app = express()
app.use(express.json())

let retroarchProcess = null

const games = {
    bikermice: {
        id: 'bikermice',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.smc',
        rom: '../../roms/snes/BikerMiceFromMars.sfc',
    },
    contra: {
        id: 'contra',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.sfc',
        rom: '../../roms/snes/Contra3.sfc',
    },
    gradius: {
        id: 'gradius',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.sfc',
        rom: '../../roms/snes/Gradius3.sfc',
    },
    puzzlebobble: {
        id: 'puzzlebobble',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.sfc',
        rom: '../../roms/snes/PuzzleBobble.sfc',
    },
    streetfighter: {
        id: 'streetfighter',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.sfc',
        rom: '../../roms/snes/StreetFighter2Turbo.sfc',
    },
    bomberman: {
        id: 'bomberman',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.sfc',
        rom: '../../roms/snes/SuperBomberman.sfc',
    },
    mario: {
        id: 'mario',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.smc',
        rom: '../../roms/snes/SuperMarioWorld.smc',
    },
    topgear: {
        id: 'topgear',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.smc',
        rom: '../../roms/snes/TopGear.sfc',
    },
    mortalkombat: {
        id: 'mortalkombat',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.smc',
        rom: '../../roms/snes/UltimateMortalKombat3.md',
    },
    tekken: {
        id: 'tekken',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/psx/Tekken2.sfc',
        rom: '../../roms/snes/Tekken2.sfc',
    },
    xmen: {
        id: 'xmen',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/XMenMutantApocalypse.sfc',
        rom: '../../roms/snes/XMenMutantApocalypse.sfc',
    },

    xmenvsstreet: {
        id: 'xmenvsstreet',
        type: 'arcade',
        price: 10,
        core: 'snes9x',
        //     rom: '../../roms/snes/SuperMarioWorld.smc',
        rom: '../../roms/snes/XMenVsStreetFighter.smc',
    },
    ultraace: {id: 'ultraace', type: 'casino', price: 0},
}

app.use((_, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    next()
})

/* ---------------- API ---------------- */

app.post('/launch/:game', (req, res) => {
    const game = games[req.params.game]
    if (!game) return res.status(404).end()

    if (!startLaunch(game)) {
        return res.status(409).end()
    }

    console.log('[LAUNCH] emulator')

    retroarchProcess = spawn(
        'bash',
        ['../../scripts/launch_arcade.sh', game.core, game.rom]
        // {
        //     stdio: 'inherit',   // REQUIRED on macOS
        //     detached: false,    // REQUIRED on macOS
        // }
    )
    
    retroarchProcess.on('exit', () => {
        console.log('[PROCESS] RetroArch exited')
        retroarchProcess = null
        endSession()
    })

    res.json({ok: true})
})

app.post('/start', (_, res) => {
    if (!startGame()) {
        return res.status(402).end()
    }

    // 🔑 input unlock / injection will live here later
    console.log('[START] accepted')
    res.json({ok: true})
})

app.post('/input', (_, res) => {
    // called later by USB encoder / joystick
    notifyInput()
    res.json({ok: true})
})

app.post('/coin', (req, res) => {
    addBalance(req.body.amount ?? 10)
    res.json({ok: true})
})

app.get('/overlay', (_, res) => {
    res.json(getOverlayState())
})

app.post('/exit', (_, res) => {
    if (retroarchProcess) {
        retroarchProcess.kill('SIGTERM')
        retroarchProcess = null
    }

    endSession()
    res.json({ok: true})
})

app.listen(3001, () => {
    console.log('[SERVICE] http://localhost:3001')
})
