"""Shared Rich theme and console for all NozKash CLI tools."""

from rich.console import Console
from rich.theme import Theme

_BASE_STYLES: dict[str, str] = {
    "primary": "bold cyan",
    "secondary": "dim cyan",
    "success": "bold green",
    "warning": "bold yellow",
    "error": "bold red",
    "muted": "dim white",
    "label": "bold white",
    "value": "cyan",
    "addr": "yellow",
    "hash": "magenta",
    "num": "bright_blue",
    "accent": "bright_cyan",
    "banner": "bold bright_cyan",
    "step": "bold cyan",
    "mock": "bold magenta",
    "dryrun": "bold magenta",
    "key": "bold bright_yellow",
    "secret": "bold red",
}

nozk_theme = Theme(_BASE_STYLES)


def make_console() -> Console:
    """Create a Console with the shared NozKash theme."""
    return Console(theme=nozk_theme, highlight=False)
