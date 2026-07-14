"""
app/exceptions.py

Custom exceptions module for the DB RAG application.
Defines exceptions used throughout the application to handle validation, safety,
and engine errors.
"""

class UnsafeSQLError(Exception):
    """Raised when the model-generated SQL fails the read-only safety check."""
