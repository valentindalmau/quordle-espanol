import hashlib
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Flask, jsonify, render_template, request, session
from flask_session import Session


BASE_DIR = Path(__file__).resolve().parent
WORDS_PATH = BASE_DIR / "palabras_para_quordle.txt"
SESSION_DIR = BASE_DIR / ".flask_session"

MAX_ATTEMPTS = 9
NUM_WORDS = 4
WORD_LEN = 5
MODES = {"practice", "daily"}
SECRET_KEY = os.getenv("SECRET_KEY")
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "America/Argentina/Buenos_Aires")


app = Flask(__name__, static_folder="static", template_folder="templates")
app.config.update(
    SECRET_KEY=SECRET_KEY or "dev-only-change-me",
    SESSION_TYPE="filesystem",
    SESSION_FILE_DIR=str(SESSION_DIR),
    SESSION_PERMANENT=False,
    SESSION_USE_SIGNER=True,
)
Session(app)


def load_words(path: Path):
    if not path.exists():
        raise FileNotFoundError(
            f"No se encontro {path}. Crea el archivo con una palabra de 5 letras por linea."
        )

    words = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            word = line.strip().lower()
            if len(word) == WORD_LEN and word.isalpha():
                words.append(word)

    if not words:
        raise ValueError("El archivo de palabras esta vacio o no tiene palabras de 5 letras.")

    return list(dict.fromkeys(words))


ALL_WORDS = load_words(WORDS_PATH)
ALL_WORDS_SET = set(ALL_WORDS)
RANK = {"u": 0, "absent": 1, "present": 2, "correct": 3}
KEYBOARD_LETTERS = "qwertyuiopasdfghjklñzxcvbnm"


def today_key():
    try:
        tz = ZoneInfo(APP_TIMEZONE)
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    return datetime.now(tz).date().isoformat()


def daily_seed(day_key: str):
    digest = hashlib.sha256(f"quordle-espanol:{day_key}".encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def choose_targets(mode: str, day_key: str | None = None):
    if mode == "daily":
        rng = random.Random(daily_seed(day_key or today_key()))
        return rng.sample(ALL_WORDS, k=NUM_WORDS)
    return random.sample(ALL_WORDS, k=NUM_WORDS)


def new_game_state(mode="practice"):
    mode = mode if mode in MODES else "practice"
    day_key = today_key() if mode == "daily" else None
    keyboard = {ch: ["u"] * NUM_WORDS for ch in KEYBOARD_LETTERS}

    return {
        "mode": mode,
        "date": day_key,
        "targets": choose_targets(mode, day_key),
        "attempt": 0,
        "history": [],
        "solved": [False] * NUM_WORDS,
        "keyboard": keyboard,
        "ended": False,
        "win": False,
        "max_attempts": MAX_ATTEMPTS,
    }


def get_requested_mode():
    payload = request.get_json(silent=True) or {}
    mode = payload.get("mode") or request.args.get("mode") or session.get("active_mode") or "practice"
    return mode if mode in MODES else "practice"


def get_game(mode: str):
    games = session.setdefault("games", {})
    game = games.get(mode)

    if mode == "daily":
        day_key = today_key()
        if not game or game.get("date") != day_key:
            game = new_game_state("daily")
            games["daily"] = game
            session.modified = True
    elif not game:
        game = new_game_state("practice")
        games["practice"] = game
        session.modified = True

    session["active_mode"] = mode
    return game


def save_game(mode: str, game: dict):
    games = session.setdefault("games", {})
    games[mode] = game
    session["active_mode"] = mode
    session.modified = True


def score_guess(secret: str, guess: str):
    result = ["absent"] * WORD_LEN
    secret_counts = {}

    for i, secret_char in enumerate(secret):
        guess_char = guess[i]
        if secret_char == guess_char:
            result[i] = "correct"
        else:
            secret_counts[secret_char] = secret_counts.get(secret_char, 0) + 1

    for i, guess_char in enumerate(guess):
        if result[i] == "correct":
            continue
        if secret_counts.get(guess_char, 0) > 0:
            result[i] = "present"
            secret_counts[guess_char] -= 1

    return result


def update_keyboard(keyboard: dict, guess: str, evals_by_board: list):
    for board_idx, evals in enumerate(evals_by_board):
        for char_idx, status in enumerate(evals):
            char = guess[char_idx]
            if char in keyboard and RANK[status] > RANK[keyboard[char][board_idx]]:
                keyboard[char][board_idx] = status


def public_state(game, include_answers=False):
    data = {
        "mode": game["mode"],
        "date": game["date"],
        "attempt": game["attempt"],
        "history": game["history"],
        "solved": game["solved"],
        "keyboard": game["keyboard"],
        "ended": game["ended"],
        "win": game["win"],
        "max_attempts": game["max_attempts"],
    }
    if include_answers and game["ended"]:
        data["answers"] = game["targets"]
    return data


@app.route("/")
def index():
    get_game(session.get("active_mode") or "practice")
    return render_template("index.html")


@app.post("/api/new")
def api_new():
    mode = get_requested_mode()
    game = new_game_state(mode)
    save_game(mode, game)
    return jsonify({"ok": True, "state": public_state(game)})


@app.get("/api/state")
def api_state():
    mode = get_requested_mode()
    game = get_game(mode)
    return jsonify({"ok": True, "state": public_state(game, include_answers=True)})


@app.post("/api/guess")
def api_guess():
    mode = get_requested_mode()
    game = get_game(mode)

    if game["ended"]:
        return jsonify({"ok": True, "state": public_state(game, include_answers=True)})

    data = request.get_json(silent=True) or {}
    guess = (data.get("word") or "").strip().lower()

    if len(guess) != WORD_LEN:
        return jsonify({"ok": False, "error": "La palabra debe tener 5 letras"}), 400
    if guess not in ALL_WORDS_SET:
        return jsonify({"ok": False, "error": "Esa palabra no esta en la lista"}), 400

    evals_by_board = [score_guess(target, guess) for target in game["targets"]]

    for board_idx, target in enumerate(game["targets"]):
        if guess == target:
            game["solved"][board_idx] = True

    game["history"].append({"guess": guess, "evals": evals_by_board})
    game["attempt"] += 1
    update_keyboard(game["keyboard"], guess, evals_by_board)
    game["win"] = all(game["solved"])
    game["ended"] = game["win"] or game["attempt"] >= game["max_attempts"]

    save_game(mode, game)
    return jsonify({"ok": True, "state": public_state(game, include_answers=game["ended"])})


if __name__ == "__main__":
    app.run(debug=True)
