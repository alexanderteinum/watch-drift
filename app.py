"""A small local watch accuracy logger."""

import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "watches.db"
app = Flask(__name__)


def connect_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    with connect_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS watches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS measurement_series (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS measurements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                series_id INTEGER NOT NULL REFERENCES measurement_series(id) ON DELETE CASCADE,
                measured_at TEXT NOT NULL,
                offset_seconds REAL NOT NULL
            );
        """)
        columns = {row[1] for row in db.execute("PRAGMA table_info(measurements)")}
        if "note" in columns:
            db.execute("ALTER TABLE measurements DROP COLUMN note")
        columns = {row[1] for row in db.execute("PRAGMA table_info(measurement_series)")}
        if "name" in columns:
            db.execute("ALTER TABLE measurement_series DROP COLUMN name")


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/watches")
def list_watches():
    with connect_db() as db:
        rows = db.execute("""
            SELECT w.id, w.name,
                   (SELECT COUNT(*) FROM measurement_series s WHERE s.watch_id = w.id) AS series_count
            FROM watches w ORDER BY w.name COLLATE NOCASE
        """).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/watches")
def create_watch():
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify(error="Enter a name for the watch."), 400
    with connect_db() as db:
        cur = db.execute("INSERT INTO watches (name) VALUES (?)", (name,))
        watch_id = cur.lastrowid
    return jsonify(id=watch_id, name=name), 201


@app.get("/api/series")
def list_series():
    with connect_db() as db:
        rows = db.execute("""
            SELECT s.id, s.watch_id, s.started_at, w.name AS watch_name,
                   (SELECT COUNT(*) FROM measurements m WHERE m.series_id = s.id) AS measurement_count,
                   (SELECT m.measured_at FROM measurements m WHERE m.series_id = s.id
                    ORDER BY julianday(m.measured_at) DESC, m.id DESC LIMIT 1) AS ended_at
            FROM measurement_series s JOIN watches w ON w.id = s.watch_id
            ORDER BY s.started_at DESC
        """).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/series")
def create_series():
    data = request.json or {}
    watch_id = data.get("watch_id")
    started_at = data.get("started_at") or datetime.now().astimezone().isoformat(timespec="minutes")
    if not watch_id:
        return jsonify(error="Select a watch first."), 400
    try:
        with connect_db() as db:
            cur = db.execute("INSERT INTO measurement_series (watch_id, started_at) VALUES (?, ?)",
                             (watch_id, started_at))
            series_id = cur.lastrowid
            db.execute("INSERT INTO measurements (series_id, measured_at, offset_seconds) VALUES (?, ?, 0)",
                       (series_id, started_at))
    except sqlite3.IntegrityError:
        return jsonify(error="The selected watch was not found."), 400
    return jsonify(id=series_id), 201


@app.get("/api/series/<int:series_id>/measurements")
def list_measurements(series_id):
    with connect_db() as db:
        series = db.execute("SELECT id, watch_id, started_at FROM measurement_series WHERE id = ?", (series_id,)).fetchone()
        if not series:
            return jsonify(error="Measurement series not found."), 404
        rows = db.execute("SELECT id, measured_at, offset_seconds FROM measurements WHERE series_id = ? ORDER BY julianday(measured_at), id",
                          (series_id,)).fetchall()
    return jsonify(series=dict(series), measurements=[dict(row) for row in rows])


@app.delete("/api/series/<int:series_id>/measurements/<int:measurement_id>")
def delete_measurement(series_id, measurement_id):
    with connect_db() as db:
        measurement = db.execute(
            "SELECT id FROM measurements WHERE id = ? AND series_id = ?",
            (measurement_id, series_id),
        ).fetchone()
        if not measurement:
            return jsonify(error="Measurement not found."), 404

        first = db.execute(
            "SELECT id FROM measurements WHERE series_id = ? ORDER BY julianday(measured_at), id LIMIT 1",
            (series_id,),
        ).fetchone()
        is_start_measurement = first["id"] == measurement_id
        db.execute("DELETE FROM measurements WHERE id = ?", (measurement_id,))

        series_deleted = False
        if is_start_measurement:
            next_measurement = db.execute(
                "SELECT measured_at, offset_seconds FROM measurements WHERE series_id = ? ORDER BY julianday(measured_at), id LIMIT 1",
                (series_id,),
            ).fetchone()
            if next_measurement:
                db.execute("UPDATE measurement_series SET started_at = ? WHERE id = ?",
                           (next_measurement["measured_at"], series_id))
                db.execute("UPDATE measurements SET offset_seconds = offset_seconds - ? WHERE series_id = ?",
                           (next_measurement["offset_seconds"], series_id))
            else:
                db.execute("DELETE FROM measurement_series WHERE id = ?", (series_id,))
                series_deleted = True

    return jsonify(series_deleted=series_deleted)


@app.post("/api/series/<int:series_id>/measurements")
def add_measurement(series_id):
    data = request.json or {}
    measured_at = data.get("measured_at") or datetime.now().astimezone().isoformat(timespec="minutes")
    try:
        offset = float(data.get("offset_seconds"))
    except (TypeError, ValueError):
        return jsonify(error="Deviation must be a number of seconds."), 400
    with connect_db() as db:
        if not db.execute("SELECT 1 FROM measurement_series WHERE id = ?", (series_id,)).fetchone():
            return jsonify(error="Measurement series not found."), 404
        cur = db.execute("INSERT INTO measurements (series_id, measured_at, offset_seconds) VALUES (?, ?, ?)",
                         (series_id, measured_at, offset))
    return jsonify(id=cur.lastrowid), 201


init_db()

if __name__ == "__main__":
    from waitress import serve

    serve(app, host="127.0.0.1", port=5000)
