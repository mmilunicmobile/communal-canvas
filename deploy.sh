#!/bin/bash
set -e
cd /home/pi/ledmatrix
git pull origin main
cd frontend
npm install
npm run build
rm -rf /home/pi/ledmatrix/backend/static/*
cp -r dist/* /home/pi/ledmatrix/backend/static/
echo "Deploy complete"
