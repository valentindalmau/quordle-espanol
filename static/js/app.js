const BOARD_COUNT = 4
const WORD_LEN = 5
const ROWS = 9
const STORAGE_MODE_KEY = 'quordle-es-mode'

let state = null
let currentGuess = ''
let activeMode = localStorage.getItem(STORAGE_MODE_KEY) || 'practice'
let submitting = false

const qs = selector => document.querySelector(selector)

const KEY_LAYOUT = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
    ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace']
]

function statusClass(status) {
    return status === 'correct' || status === 'present' || status === 'absent' ? status : ''
}

function showToast(message) {
    const toast = qs('#toast')
    toast.textContent = message
    toast.classList.add('show')
    setTimeout(() => toast.classList.remove('show'), 1600)
}

function showOverlay(title, text) {
    qs('#overlay-title').textContent = title
    qs('#overlay-text').textContent = text
    qs('#overlay').classList.remove('hidden')
}

function hideOverlay() {
    qs('#overlay').classList.add('hidden')
}

function tileAt(board, row, col) {
    const grid = document.querySelector(`.grid[data-grid="${board}"]`)
    if (!grid) return null
    return grid.children[row * WORD_LEN + col] || null
}

function emptyGrid() {
    for (let board = 0; board < BOARD_COUNT; board++) {
        const grid = document.querySelector(`.grid[data-grid="${board}"]`)
        grid.innerHTML = ''

        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < WORD_LEN; col++) {
                const tile = document.createElement('div')
                tile.className = 'tile'
                grid.appendChild(tile)
            }
        }
    }
}

function fillHistory() {
    if (!state || !state.history) return

    state.history.forEach((entry, rowIdx) => {
        const guess = entry.guess.toUpperCase()

        for (let board = 0; board < BOARD_COUNT; board++) {
            const evals = entry.evals[board]

            for (let col = 0; col < WORD_LEN; col++) {
                const tile = tileAt(board, rowIdx, col)
                if (!tile) continue

                tile.textContent = guess[col]
                tile.className = `tile ${statusClass(evals[col])}`.trim()
            }
        }
    })
}

function drawCurrentGuess() {
    if (!state || state.ended || state.attempt >= ROWS) return

    for (let col = 0; col < WORD_LEN; col++) {
        const char = currentGuess[col] ? currentGuess[col].toUpperCase() : ''

        for (let board = 0; board < BOARD_COUNT; board++) {
            const tile = tileAt(board, state.attempt, col)
            if (!tile) continue

            tile.textContent = char
            tile.classList.toggle('filled', Boolean(char))
        }
    }
}

function buildKeyboard() {
    const root = qs('#keyboard')
    root.innerHTML = ''

    KEY_LAYOUT.forEach(row => {
        const rowEl = document.createElement('div')
        rowEl.className = 'kb-row'
        row.forEach(key => rowEl.appendChild(makeKey(key)))
        root.appendChild(rowEl)
    })
}

function makeKey(key) {
    const button = document.createElement('button')
    button.className = 'key' + (key === 'enter' || key === 'backspace' ? ' wide' : '')
    button.dataset.key = key
    button.type = 'button'
    button.setAttribute('aria-label', key === 'backspace' ? 'Borrar' : key)

    const label = document.createElement('div')
    label.className = 'key-label'
    label.textContent = key === 'enter' ? 'ENTER' : key === 'backspace' ? 'BORRAR' : key.toUpperCase()

    const quarters = document.createElement('div')
    quarters.className = 'key-quarters'

    for (let slot = 0; slot < BOARD_COUNT; slot++) {
        const quarter = document.createElement('div')
        quarter.className = 'q'
        quarters.appendChild(quarter)
    }

    button.appendChild(label)
    button.appendChild(quarters)
    button.addEventListener('click', () => onKey(key))
    return button
}

function paintKeyboard() {
    if (!state) return

    Object.entries(state.keyboard).forEach(([char, slots]) => {
        const button = document.querySelector(`.key[data-key="${char}"]`)
        if (!button) return

        button.querySelectorAll('.q').forEach((quarter, idx) => {
            quarter.classList.remove('absent', 'present', 'correct')
            if (slots[idx] && slots[idx] !== 'u') {
                quarter.classList.add(slots[idx])
            }
        })
    })
}

function setAttemptIndicator() {
    if (!state) return
    qs('#attempt-indicator').textContent = `${Math.min(state.attempt + 1, state.max_attempts)} / ${state.max_attempts}`
}

function setModeUi() {
    document.querySelectorAll('.mode-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.mode === activeMode)
    })

    const modeLabel = activeMode === 'daily' ? 'Diario' : 'Practica'
    const dateLabel = state && state.mode === 'daily' && state.date ? ` ${state.date}` : ''
    qs('#mode-label').textContent = `${modeLabel}${dateLabel}`
    qs('#btn-new').textContent = activeMode === 'daily' ? 'Reiniciar' : 'Nuevo'
}

function resetBoardFromState() {
    emptyGrid()
    fillHistory()
    setAttemptIndicator()
    paintKeyboard()
    setModeUi()
    currentGuess = ''

    if (!state.ended) drawCurrentGuess()
    maybeEndOverlay()
}

function onKey(key) {
    if (!state || state.ended || submitting) return

    if (key === 'enter') {
        if (currentGuess.length !== WORD_LEN) {
            showToast('La palabra debe tener 5 letras')
            return
        }
        submitGuess(currentGuess)
        return
    }

    if (key === 'backspace') {
        currentGuess = currentGuess.slice(0, -1)
        drawCurrentGuess()
        return
    }

    if (key.length === 1 && currentGuess.length < WORD_LEN) {
        currentGuess += key.toLowerCase()
        drawCurrentGuess()
    }
}

function onPhysicalKey(event) {
    const key = event.key.toLowerCase()

    if (key === 'enter' || key === 'backspace') {
        event.preventDefault()
        onKey(key)
        return
    }

    if (/^[a-zñ]$/.test(key)) {
        event.preventDefault()
        onKey(key)
    }
}

async function fetchJSON(url, opts) {
    try {
        const res = await fetch(url, Object.assign({
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        }, opts || {}))

        const text = await res.text()
        let data = {}

        try {
            data = text ? JSON.parse(text) : {}
        } catch {
            data = { ok: false, error: 'Respuesta no valida del servidor' }
        }

        if (!res.ok && data.ok !== false) {
            data = { ok: false, error: 'Error del servidor' }
        }

        return data
    } catch {
        return { ok: false, error: 'No se pudo conectar con el servidor' }
    }
}

async function loadState() {
    const data = await fetchJSON(`/api/state?mode=${encodeURIComponent(activeMode)}`)

    if (!data.ok) {
        showToast(data.error || 'No se pudo cargar el estado')
        return
    }

    state = data.state
    resetBoardFromState()
}

async function newGame() {
    hideOverlay()
    qs('#btn-new').blur()

    const data = await fetchJSON('/api/new', {
        method: 'POST',
        body: JSON.stringify({ mode: activeMode })
    })

    if (!data.ok) {
        showToast(data.error || 'No se pudo crear un nuevo juego')
        return
    }

    state = data.state
    resetBoardFromState()
}

async function submitGuess(word) {
    submitting = true

    const data = await fetchJSON('/api/guess', {
        method: 'POST',
        body: JSON.stringify({ word, mode: activeMode })
    })

    submitting = false

    if (!data.ok) {
        showToast(data.error || 'No se pudo enviar')
        return
    }

    state = data.state
    resetBoardFromState()
}

function maybeEndOverlay() {
    if (!state || !state.ended) return

    const answers = Array.isArray(state.answers) ? state.answers : []
    const title = state.win ? 'Ganaste' : 'Perdiste'
    const text = answers.length ? `Las palabras eran: ${answers.map(word => word.toUpperCase()).join(' - ')}` : ''
    showOverlay(title, text)
}

function switchMode(mode) {
    if (mode === activeMode) return

    activeMode = mode
    localStorage.setItem(STORAGE_MODE_KEY, activeMode)
    hideOverlay()
    setModeUi()
    loadState()
}

function init() {
    buildKeyboard()
    emptyGrid()
    setModeUi()

    document.addEventListener('keydown', onPhysicalKey)
    qs('#btn-new').addEventListener('click', newGame)
    qs('#overlay-close').addEventListener('click', hideOverlay)

    document.querySelectorAll('.mode-btn').forEach(button => {
        button.addEventListener('click', () => switchMode(button.dataset.mode))
    })

    loadState()
}

document.addEventListener('DOMContentLoaded', init)
