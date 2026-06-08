#!/usr/bin/env python3
import os
import time
import secrets
from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024

APP_NAME = os.getenv("APP_NAME", "Mraprguild Speed Test")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8080"))

@app.after_request
def no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

@app.get("/")
def index():
    return render_template("index.html", app_name=APP_NAME)

@app.get("/api/ping")
def ping():
    return jsonify(ok=True, server_time=time.time_ns())

@app.get("/api/download")
def download():
    try:
        size = int(request.args.get("size", 8 * 1024 * 1024))
    except ValueError:
        size = 8 * 1024 * 1024

    size = max(64 * 1024, min(size, 64 * 1024 * 1024))
    chunk_size = 64 * 1024
    chunk = secrets.token_bytes(chunk_size)

    def generate():
        remaining = size
        while remaining > 0:
            part = chunk if remaining >= chunk_size else chunk[:remaining]
            remaining -= len(part)
            yield part

    response = Response(generate(), mimetype="application/octet-stream")
    response.headers["Content-Length"] = str(size)
    return response

@app.post("/api/upload")
def upload():
    total = 0
    stream = request.stream
    while True:
        chunk = stream.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
    return jsonify(ok=True, received=total)

@app.get("/api/info")
def info():
    forwarded = request.headers.get("X-Forwarded-For", "")
    client_ip = forwarded.split(",")[0].strip() if forwarded else request.remote_addr
    return jsonify(
        app=APP_NAME,
        client_ip=client_ip,
        user_agent=request.headers.get("User-Agent", ""),
    )

@app.get("/health")
def health():
    return jsonify(status="ok")

if __name__ == "__main__":
    print(f"\n{APP_NAME}")
    print(f"Local URL:   http://127.0.0.1:{PORT}")
    print(f"Network URL: http://YOUR_PHONE_IP:{PORT}\n")
    app.run(host=HOST, port=PORT, threaded=True, debug=False)
