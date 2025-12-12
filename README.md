# TPMS Analysis Dashboard

TPMS Analysis Dashboard with Integration of UI for Automation Testing.

## How to Run

### 1. Create Virtual Environment
Set up a Python virtual environment to manage backend dependencies.
```bash
python -m venv .venv
# Activate the virtual environment:
# Windows:
.\.venv\Scripts\Activate.ps1
# Linux/Mac:
source .venv/bin/activate

# Install backend dependencies
pip install -r requirements.txt
```

### 2. Frontend Setup
Install the necessary Node.js packages for the frontend.
```bash
cd frontend
npm install
```

### 3. Run Backend
Start the backend server using Uvicorn.
```bash
# Run from the root directory
python -m uvicorn Backend.app.main:app
```

### 4. Run Frontend
Start the frontend development server.
```bash
cd frontend
npm run dev
```