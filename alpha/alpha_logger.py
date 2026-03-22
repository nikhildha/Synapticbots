"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_logger.py                                              ║
║  Purpose: Rotating file logger → alpha/data/alpha.log only.                 ║
║           Never writes to data/bot.log or any root-level log file.          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import from root engine. ✓ Writes only to alpha/data/alpha.log    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import logging
import logging.handlers
from alpha.alpha_config import ALPHA_LOG_FILE


def get_logger(name: str) -> logging.Logger:
    """
    Return a named logger that writes to alpha/data/alpha.log.
    Daily rotation, 7-day retention. Also echoes to console.
    Call once per module: logger = get_logger(__name__)
    """
    logger = logging.getLogger(f"alpha.{name}")

    if logger.handlers:
        return logger  # already configured — avoid duplicate handlers

    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotating file handler — daily rotation, keep 7 days
    file_handler = logging.handlers.TimedRotatingFileHandler(
        ALPHA_LOG_FILE,
        when="midnight",
        interval=1,
        backupCount=7,
        utc=True,
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(fmt)

    # Console handler — INFO and above
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(fmt)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    logger.propagate = False

    return logger
