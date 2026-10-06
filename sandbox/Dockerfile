# Shell:B code sandbox — run with --network none; this image is the whole toolbox.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      bc curl file jq less nano unzip xz-utils zip fonts-dejavu-core \
      git build-essential cmake pkg-config nodejs npm ripgrep sqlite3 \
      poppler-utils tesseract-ocr tesseract-ocr-spa tesseract-ocr-jpn \
      ffmpeg sox libsndfile1 fluidsynth fluid-soundfont-gm socat \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir \
      numpy pandas scipy sympy scikit-learn matplotlib seaborn pillow openpyxl xlsxwriter \
      pyarrow tabulate networkx statsmodels python-docx python-pptx pdfplumber pypdf pymupdf pytesseract opencv-python-headless reportlab beautifulsoup4 lxml pyyaml rich \
      pytest pytest-cov hypothesis ruff mypy black requests httpx fastapi pydantic flask
# creative + back-end: audio editing/MIDI, meshes, and a real app server (Studio dev servers run uvicorn or node)
RUN pip install --no-cache-dir \
      soundfile pydub mido pretty_midi midiutil pyloudnorm trimesh pygltflib \
      'uvicorn[standard]' sqlalchemy sqlmodel aiosqlite python-multipart jinja2 pyjwt passlib bcrypt
RUN npm install -g --no-fund --no-audit typescript tsx prettier eslint vitest \
      express sql.js ws zod
# the sandbox is offline, so project code require()s these global packages instead of npm install
ENV NODE_PATH=/usr/local/lib/node_modules
ENV MPLBACKEND=Agg PYTHONUNBUFFERED=1
WORKDIR /work
