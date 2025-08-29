import os, random
from pathlib import Path
from flask import Flask, render_template, request, jsonify, session

# ---------- Config ----------
BASE_DIR = Path(__file__).resolve().parent
WORDS_PATH = BASE_DIR / "palabras_para_quordle.txt"
MAX_ATTEMPTS = 9
NUM_WORDS = 4
SECRET_KEY = os.getenv("SECRET_KEY", "cambiame-por-uno-seguro")

# ---------- App ----------
app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = SECRET_KEY

# ---------- Palabras ----------
def load_words(path: Path):
    if not path.exists():
        raise FileNotFoundError(
            f"No se encontró {path}. Creá el archivo con una palabra de 5 letras por línea, en minúsculas."
        )
    words = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            w = line.strip().lower()
            if len(w) == 5:
                words.append(w)
    if not words:
        raise ValueError("El archivo de palabras está vacío o no tiene palabras de 5 letras.")
    return list(dict.fromkeys(words))  # dedup conservando orden

ALL_WORDS = load_words(WORDS_PATH)
ALL_WORDS_SET = set(ALL_WORDS)

# ---------- Utils de juego ----------
RANK = {"u": 0, "absent": 1, "present": 2, "correct": 3}

def new_game_state():
    targets = random.sample(ALL_WORDS, k=NUM_WORDS)
    keyboard = {ch: ["u", "u", "u", "u"] for ch in "qwertyuiopasdfghjklñzxcvbnm"}
    return {
        "targets": targets,          # lista de 4 palabras
        "attempt": 0,                # 0..9
        "history": [],               # [{guess, evals: [ [s,s,s,s,s] *4 ]}]
        "solved": [False, False, False, False],
        "keyboard": keyboard,        # 'a' -> ['u','u','u','u']
        "ended": False,
        "win": False,
        "max_attempts": MAX_ATTEMPTS
    }

def score_guess(secret: str, guess: str):
    """
    Devuelve lista de 5 estados: 'correct' (verde), 'present' (amarillo), 'absent' (gris)
    Maneja letras repetidas correctamente.
    """
    n = len(secret)
    result = ["absent"] * n
    secret_counts = {}

    # Marcar correctas y contar sobrantes
    for i in range(n):
        s = secret[i]
        g = guess[i]
        if s == g:
            result[i] = "correct"
        else:
            secret_counts[s] = secret_counts.get(s, 0) + 1

    # Marcar presentes si hay remanente
    for i in range(n):
        if result[i] == "correct":
            continue
        g = guess[i]
        if secret_counts.get(g, 0) > 0:
            result[i] = "present"
            secret_counts[g] -= 1
        else:
            result[i] = "absent"

    return result

def update_keyboard(keyboard: dict, guess: str, evals_by_board: list):
    for b_idx in range(NUM_WORDS):
        evals = evals_by_board[b_idx]
        for i, st in enumerate(evals):
            ch = guess[i]
            if ch not in keyboard:
                continue
            if RANK[st] > RANK[keyboard[ch][b_idx]]:
                keyboard[ch][b_idx] = st

def public_state(state, include_answers=False):
    data = {
        "attempt": state["attempt"],
        "history": state["history"],
        "solved": state["solved"],
        "keyboard": state["keyboard"],
        "ended": state["ended"],
        "win": state["win"],
        "max_attempts": state["max_attempts"]
    }
    if include_answers and state["ended"]:
        data["answers"] = state["targets"]
    return data

# ---------- Rutas ----------
@app.route("/")
def index():
    if "game" not in session:
        session["game"] = new_game_state()
        session.modified = True
    return render_template("index.html")

@app.post("/api/new")
def api_new():
    session["game"] = new_game_state()
    session.modified = True
    return jsonify({"ok": True, "state": public_state(session["game"])})

@app.get("/api/state")
def api_state():
    if "game" not in session:
        session["game"] = new_game_state()
    st = session["game"]
    return jsonify({"ok": True, "state": public_state(st, include_answers=True)})

@app.post("/api/guess")
def api_guess():
    if "game" not in session:
        session["game"] = new_game_state()

    st = session["game"]

    # Si la partida ya terminó, devolvés estado + respuestas
    if st["ended"]:
        return jsonify({"ok": True, "state": public_state(st, include_answers=True), "answers": st["targets"]})

    data = request.get_json(silent=True) or {}
    guess = (data.get("word") or "").strip().lower()

    if len(guess) != 5:
        return jsonify({"ok": False, "error": "La palabra debe tener 5 letras"}), 400
    if guess not in ALL_WORDS_SET:
        return jsonify({"ok": False, "error": "Esa palabra no está en la lista"}), 400

    # Evaluar contra las 4 palabras
    evals_by_board = [score_guess(target, guess) for target in st["targets"]]

    # Actualizar resolved
    for b_idx, target in enumerate(st["targets"]):
        if guess == target:
            st["solved"][b_idx] = True

    # Guardar intento
    st["history"].append({"guess": guess, "evals": evals_by_board})
    st["attempt"] += 1

    # Actualizar teclado
    update_keyboard(st["keyboard"], guess, evals_by_board)

    # ¿Ganó o terminó?
    st["win"] = all(st["solved"])
    st["ended"] = st["win"] or (st["attempt"] >= st["max_attempts"])

    session["game"] = st
    session.modified = True

    # Si terminó (ganó o perdió), devolvemos respuestas también
    if st["ended"]:
        return jsonify({"ok": True, "state": public_state(st, include_answers=True), "answers": st["targets"]})

    return jsonify({"ok": True, "state": public_state(st)})

# ---------- Runner ----------
if __name__ == "__main__":
    # En local, correr con:
    #   flask --app app run --debug
    # o   python app.py
    app.run(debug=True)
