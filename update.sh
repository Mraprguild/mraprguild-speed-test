#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
git pull --ff-only
. .venv/bin/activate
python -m pip install -r requirements.txt
echo "Update completed."
