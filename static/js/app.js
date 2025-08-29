const BOARD_COUNT = 4
const WORD_LEN = 5
const rows = 9

let state = null
let currentGuess = ''

const qs = s => document.querySelector(s)
const qsa = s => Array.from(document.querySelectorAll(s))

const KEY_LAYOUT = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
    ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace']
]

const STATUS_CLASS = st => st === 'correct' ? 'correct' : st === 'present' ? 'present' : st === 'absent' ? 'absent' : ''

function showToast(msg) {
    const el = qs('#toast')
    el.textContent = msg
    el.classList.add('show')
    setTimeout(() => el.classList.remove('show'), 1600)
}

function showOverlay(title, text) {
    qs('#overlay-title').textContent = title
    qs('#overlay-text').textContent = text
    qs('#overlay').classList.remove('hidden')
}
function hideOverlay() {
    qs('#overlay').classList.add('hidden')
}

function emptyGrid() {
    for (let b = 0; b < BOARD_COUNT; b++) {
        const grid = document.querySelector(`.grid[data-grid="${b}"]`)
        grid.innerHTML = ''
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < WORD_LEN; c++) {
                const d = document.createElement('div')
                d.className = 'tile'
                d.dataset.row = r
                d.dataset.col = c
                grid.appendChild(d)
            }
        }
    }
}

function fillHistory() {
    if (!state || !state.history) return
    state.history.forEach((h, rIdx) => {
        const guess = h.guess.toUpperCase()
        for (let b = 0; b < BOARD_COUNT; b++) {
            const evals = h.evals[b]
            for (let c = 0; c < WORD_LEN; c++) {
                const tile = tileAt(b, rIdx, c)
                tile.textContent = guess[c]
                const cl = STATUS_CLASS(evals[c])
                if (cl) tile.classList.add(cl)
            }
        }
    })
}

function tileAt(board, row, col) {
    const grid = document.querySelector(`.grid[data-grid="${board}"]`)
    if (!grid) return null
    const idx = row * WORD_LEN + col
    return grid.children[idx] || null
}

function drawCurrentGuess() {
    if (!state) return
    const attempt = state.attempt || 0

    // ⛔ No intentes dibujar si el juego terminó o si la fila no existe
    if (state.ended || attempt >= rows) return

    for (let c = 0; c < WORD_LEN; c++) {
        const ch = currentGuess[c] ? currentGuess[c].toUpperCase() : ''
        for (let b = 0; b < BOARD_COUNT; b++) {
            const tile = tileAt(b, attempt, c)
            if (!tile) continue
            tile.textContent = ch
            tile.classList.toggle('filled', !!ch)
        }
    }
}

function buildKeyboard() {
    const root = qs('#keyboard')
    root.innerHTML = ''
    KEY_LAYOUT.forEach(row => {
        const rowEl = document.createElement('div')
        rowEl.className = 'kb-row'
        row.forEach(k => rowEl.appendChild(makeKey(k)))
        root.appendChild(rowEl)
    })
}

function makeKey(k) {
    const btn = document.createElement('button')
    btn.className = 'key' + ((k === 'enter' || k === 'backspace') ? ' wide' : '')
    btn.dataset.key = k

    const label = document.createElement('div')
    label.className = 'key-label'
    label.textContent = k === 'enter' ? 'ENTER' : k === 'backspace' ? 'BORRAR' : k.toUpperCase()

    const quarters = document.createElement('div')
    quarters.className = 'key-quarters'
    for (let i = 0; i < 4; i++) {
        const q = document.createElement('div')
        q.className = 'q'
        q.dataset.slot = i
        quarters.appendChild(q)
    }

    btn.appendChild(label)
    btn.appendChild(quarters)
    btn.addEventListener('click', () => onKey(k))
    return btn
}

function paintKeyboard() {
    if (!state) return
    Object.entries(state.keyboard).forEach(([ch, slots]) => {
        const btn = document.querySelector(`.key[data-key="${ch}"]`)
        if (!btn) return
        const blocks = btn.querySelectorAll('.q')
        slots.forEach((st, i) => {
            const el = blocks[i]
            el.classList.remove('absent', 'present', 'correct')
            if (st !== 'u') el.classList.add(st)
        })
    })
}

function setAttemptIndicator() {
    if (!state) return
    const el = qs('#attempt-indicator')
    el.textContent = `${Math.min(state.attempt + 1, state.max_attempts)} / ${state.max_attempts}`
}

function onKey(k) {
    if (!state || state.ended) return

    if (k === 'enter') {
        if (currentGuess.length !== WORD_LEN) {
            showToast('La palabra debe tener 5 letras')
            return
        }
        submitGuess(currentGuess)
        return
    }

    if (k === 'backspace') {
        currentGuess = currentGuess.slice(0, -1)
        drawCurrentGuess()
        return
    }

    if (k.length === 1) {
        const ch = k.toLowerCase()
        if (currentGuess.length < WORD_LEN) {
            currentGuess += ch
            drawCurrentGuess()
        }
    }
}

function onPhysicalKey(e) {
    const active = document.activeElement
    const k = e.key.toLowerCase()

    // 🔧 si el foco está en un botón (ej. "Nuevo juego"), no dejes que ENTER lo dispare
    if (active && active.tagName === 'BUTTON' && (k === 'enter')) {
        e.preventDefault()
    }

    if (k === 'enter' || k === 'backspace') {
        e.preventDefault()   // 🔧 evitá comportamiento por defecto del navegador
        onKey(k)
        return
    }

    if (/^[a-zñ]$/.test(k)) {
        // opcional: e.preventDefault() para que no haga nada raro el navegador
        onKey(k)
    }
}

async function fetchJSON(url, opts) {
    try {
        const res = await fetch(
            url,
            Object.assign(
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin'  // manda cookie de sesión
                },
                opts || {}
            )
        )
        const text = await res.text()
        let data = {}
        try { data = text ? JSON.parse(text) : {} } catch { data = { ok: false, error: 'Respuesta no válida del servidor' } }
        return data
    } catch (e) {
        return { ok: false, error: 'No se pudo conectar con el servidor' }
    }
}

async function loadState() {
    const data = await fetchJSON('/api/state')
    if (!data.ok) {
        showToast(data.error || 'No se pudo cargar el estado')
        return
    }
    state = data.state
    emptyGrid()
    fillHistory()
    setAttemptIndicator()
    paintKeyboard()
    currentGuess = ''

    // ✅ No intentes dibujar la fila “actual” si ya terminó
    if (!state.ended) drawCurrentGuess()

    maybeEndOverlay()
}

async function newGame() {
    hideOverlay()

    // 🔧 quitar foco del botón para que ENTER no lo dispare de nuevo
    const btn = document.getElementById('btn-new')
    if (btn) btn.blur()

    const data = await fetchJSON('/api/new', { method: 'POST' })
    if (!data.ok) {
        showToast(data.error || 'No se pudo crear un nuevo juego')
        return
    }

    state = data.state
    emptyGrid()
    currentGuess = ''
    setAttemptIndicator()

    document.querySelectorAll('.key .q').forEach(q => {
        q.classList.remove('absent', 'present', 'correct')
    })

    paintKeyboard()
    drawCurrentGuess()
}


async function submitGuess(word) {
    const data = await fetchJSON('/api/guess', {
        method: 'POST',
        body: JSON.stringify({ word })
    })

    if (!data.ok) {
        showToast(data.error || 'No se pudo enviar')
        return  // no vaciamos currentGuess en error
    }

    state = data.state

    // pintar la última fila confirmada por backend
    const rIdx = state.history.length - 1
    if (rIdx >= 0) {
        const guessUp = state.history[rIdx].guess.toUpperCase()
        for (let b = 0; b < BOARD_COUNT; b++) {
            const evals = state.history[rIdx].evals[b]
            for (let c = 0; c < WORD_LEN; c++) {
                const tile = tileAt(b, rIdx, c)
                tile.textContent = guessUp[c]
                tile.classList.remove('filled')
                const cl = STATUS_CLASS(evals[c])
                if (cl) tile.classList.add(cl)
            }
        }
    }

    paintKeyboard()
    setAttemptIndicator()
    currentGuess = ''

    // ✅ Sólo dibujá la fila de tipeo si NO terminó
    if (!state.ended) drawCurrentGuess()

    if (state.ended) {
        ensureAnswersThenOverlay()
    }
}

function maybeEndOverlay() {
    if (!state || !state.ended) return
    ensureAnswersThenOverlay()
}

async function ensureAnswersThenOverlay() {
    // Si ya tengo answers, muestro y salgo
    console.log(state.answers)
    if (state && Array.isArray(state.answers) && state.answers.length === 4) {
        const title = state.win ? '¡Ganaste!' : 'Perdiste'
        const txt = `Las palabras eran: ${state.answers.map(w => w.toUpperCase()).join(' • ')}`
        showOverlay(title, txt)
        return
    }

    // Si no tengo answers pero el juego terminó, pido /api/state (trae answers)
    if (state && state.ended) {
        const data = await fetchJSON('/api/state')
        if (data.ok && data.state) {
            state = data.state
            const answers = Array.isArray(state.answers) ? state.answers : []
            const title = state.win ? '¡Ganaste!' : 'Perdiste'
            const txt = answers.length ? `Las palabras eran: ${answers.map(w => w.toUpperCase()).join(' • ')}` : ''
            showOverlay(title, txt)
        } else {
            // fallback: al menos mostrar “Perdiste”
            showOverlay('Perdiste', '')
        }
    }
}


function init() {
    buildKeyboard()
    document.addEventListener('keydown', onPhysicalKey)
    qs('#btn-new').addEventListener('click', newGame)
    qs('#overlay-close').addEventListener('click', hideOverlay)
    loadState()
}

document.addEventListener('DOMContentLoaded', init)
