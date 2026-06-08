#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Virtual environment missing. Run: bash install.sh"
  exit 1
fi

. .venv/bin/activate

IP="$(python - <<'PY'
import socket
try:
    s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
    s.connect(("8.8.8.8",80))
    print(s.getsockname()[0])
    s.close()
except Exception:
    print("127.0.0.1")
PY
)"

PORT="${PORT:-8080}"
echo "Starting Mraprguild Speed Test"
echo "Phone:   http://127.0.0.1:${PORT}"
echo "Wi-Fi:   http://${IP}:${PORT}"
echo "Stop:    CTRL+C"
exec python server.py
