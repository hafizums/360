from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_upload_dir
from app.database import init_db
from app.routers import projects, uploads

app = FastAPI(title="360 Scene Stager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

uploads_dir = get_upload_dir()
uploads_dir.mkdir(parents=True, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")
app.include_router(projects.router)
app.include_router(uploads.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
