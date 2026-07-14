"""
app/__init__.py

Initialization module for the DB RAG application package.
Exposes the core FastAPI application instance (`app`) so that the server
can be run directly using `uvicorn app:app`.
"""

from .main import app

__all__ = ["app"]
