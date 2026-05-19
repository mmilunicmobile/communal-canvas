cd frontend
npm run build
cd ..
rsync -avz --progress --delete --exclude-from=backend/.gitignore backend/. $1:~/communal-canvas-backend
rsync -avz --progress --delete frontend/dist/. $1:~/communal-canvas-backend/static