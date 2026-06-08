# server.py

#!/usr/bin/env python3

import os
import secrets
import time

from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024

APP_NAME = os.getenv("APP_NAME", "Mraprguild Speed Test")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8080"))


@app.after_request
def set_headers(response):
    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, max-age=0"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Encoding"] = "identity"
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.get("/")
def index():
    return render_template("index.html", app_name=APP_NAME)


@app.get("/api/ping")
def ping():
    return jsonify(
        ok=True,
        server_time_ns=time.time_ns(),
    )


@app.get("/api/download")
def download():
    try:
        size = int(
            request.args.get(
                "size",
                16 * 1024 * 1024,
            )
        )
    except ValueError:
        size = 16 * 1024 * 1024

    size = max(
        256 * 1024,
        min(size, 128 * 1024 * 1024),
    )

    chunk_size = 256 * 1024
    random_chunk = secrets.token_bytes(chunk_size)

    def generate():
        remaining = size

        while remaining > 0:
            if remaining >= chunk_size:
                data = random_chunk
            else:
                data = random_chunk[:remaining]

            remaining -= len(data)
            yield data

    response = Response(
        generate(),
        mimetype="application/octet-stream",
        direct_passthrough=True,
    )

    response.headers["Content-Length"] = str(size)
    response.headers["Content-Disposition"] = (
        "inline; filename=speedtest.bin"
    )

    return response


@app.post("/api/upload")
def upload():
    received_bytes = 0

    while True:
        chunk = request.stream.read(256 * 1024)

        if not chunk:
            break

        received_bytes += len(chunk)

    return jsonify(
        ok=True,
        received=received_bytes,
    )


@app.get("/api/info")
def info():
    forwarded_for = request.headers.get(
        "X-Forwarded-For",
        "",
    )

    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    else:
        client_ip = request.remote_addr

    return jsonify(
        app=APP_NAME,
        client_ip=client_ip,
    )


@app.get("/health")
def health():
    return jsonify(status="ok")


if __name__ == "__main__":
    print()
    print(APP_NAME)
    print(f"Local URL:   http://127.0.0.1:{PORT}")
    print(f"Network URL: http://YOUR_PHONE_IP:{PORT}")
    print()

    app.run(
        host=HOST,
        port=PORT,
        threaded=True,
        debug=False,
    )
