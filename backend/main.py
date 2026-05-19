from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings
from session_manager import session_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Live Chyron Pipeline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateSessionRequest(BaseModel):
    youtube_url: str = Field(..., alias="youtubeUrl")
    mode: str = "chyron"
    context_window_sec: int | None = Field(None, alias="contextWindowSec")
    start_sec: int = Field(0, alias="startSec", ge=0)

    model_config = {"populate_by_name": True}


class CreateSessionResponse(BaseModel):
    session_id: str = Field(..., alias="sessionId")

    model_config = {"populate_by_name": True}


class SessionStateResponse(BaseModel):
    session_id: str = Field(..., alias="sessionId")
    status: str
    mode: str
    start_sec: int = Field(0, alias="startSec")
    youtube_url: str = Field("", alias="youtubeUrl")
    active_chyron: str = Field(..., alias="activeChyron")
    approved_log: list[dict[str, Any]] = Field(..., alias="approvedLog")
    latest_suggestions: dict[str, Any] | None = Field(None, alias="latestSuggestions")
    latest_verbatim: str = Field("", alias="latestVerbatim")
    usage: dict[str, Any] | None = None
    error: str | None = None

    model_config = {"populate_by_name": True}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sessions", response_model=CreateSessionResponse)
async def create_session(body: CreateSessionRequest) -> CreateSessionResponse:
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")

    url = body.youtube_url.strip()
    if "youtube.com" not in url and "youtu.be" not in url:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")

    session = session_manager.create(
        youtube_url=url,
        mode=body.mode,
        context_window_sec=body.context_window_sec,
        start_sec=body.start_sec,
    )
    return CreateSessionResponse(sessionId=session.session_id)


@app.post("/api/sessions/{session_id}/stop")
async def stop_session(session_id: str) -> dict[str, str]:
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await session_manager.stop(session_id)
    return {"status": "stopped"}


@app.get("/api/sessions/{session_id}", response_model=SessionStateResponse)
async def get_session(session_id: str) -> SessionStateResponse:
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionStateResponse(
        sessionId=session.session_id,
        status=session.status.value,
        mode=session.mode,
        startSec=session.start_sec,
        youtubeUrl=session.youtube_url,
        activeChyron=session.active_chyron,
        approvedLog=[
            {"text": e.text, "timestamp": e.timestamp} for e in session.approved_log
        ],
        latestSuggestions=session.latest_suggestions,
        latestVerbatim=session.latest_verbatim,
        usage=session.usage.to_payload(),
        error=session.error,
    )



@app.websocket("/ws/sessions/{session_id}")
async def session_websocket(websocket: WebSocket, session_id: str) -> None:
    session = session_manager.get(session_id)
    if not session:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    session.subscribers.add(websocket)

    await websocket.send_json(
        {
            "type": "session.status",
            "status": session.status.value,
            "error": session.error,
        }
    )
    await websocket.send_json({"type": "usage.update", **session.usage.to_payload()})
    if session.latest_suggestions:
        await websocket.send_json({"type": "chyron.suggestions", **session.latest_suggestions})
    if session.active_chyron:
        await websocket.send_json(
            {"type": "chyron.approved", "text": session.active_chyron}
        )

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "chyron.approve":
                text = data.get("text", "")
                chyron_id = data.get("id", "")
                session_manager.approve_chyron(session_id, chyron_id, text)
                await session.broadcast({"type": "chyron.approved", "text": text, "id": chyron_id})
                await session.broadcast(
                    {
                        "type": "chyron.log",
                        "text": text,
                        "timestamp": session.approved_log[-1].timestamp,
                    }
                )
            elif msg_type == "chyron.edit":
                text = data.get("text", "")
                chyron_id = data.get("id", "")
                session_manager.approve_chyron(session_id, chyron_id, text)
                await session.broadcast({"type": "chyron.approved", "text": text, "id": chyron_id})
                await session.broadcast(
                    {
                        "type": "chyron.log",
                        "text": text,
                        "timestamp": session.approved_log[-1].timestamp,
                    }
                )
            elif msg_type == "chyron.reject":
                chyron_id = data.get("id", "")
                text = data.get("text", "")
                session_manager.reject_chyron(session_id, chyron_id, text)
                await session.broadcast({"type": "chyron.rejected", "id": chyron_id})
            elif msg_type == "mode.set":
                mode = data.get("mode", "chyron")
                session_manager.set_mode(session_id, mode)
                await session.broadcast({"type": "mode.changed", "mode": mode})
            elif msg_type == "context.clear":
                session_manager.clear_context(session_id)
                await session.broadcast(
                    {
                        "type": "context.cleared",
                        "timestamp": time.time(),
                    }
                )
    except WebSocketDisconnect:
        session.subscribers.discard(websocket)
    except Exception:
        logger.exception("WebSocket error")
        session.subscribers.discard(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
