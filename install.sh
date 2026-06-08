#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "Installing Mraprguild Speed Test..."
pkg update -y
pkg install python git -y

python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

chmod +x start.sh update.sh
echo
echo "Installation completed."
echo "Run: ./start.sh"
