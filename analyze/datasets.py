"""Describe the selected packages for exploring them: topics, civic issues and descriptions.

Taken from each package's CKAN metadata, one row per package. ``topics`` and
``civic_issues`` are the portal's own categories (``civic_issues`` is often empty).
"""

from __future__ import annotations

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = pa.schema([
    ("name", pa.string()),
    ("id", pa.string()),
    ("title", pa.string()),
    ("publisher", pa.string()),
    ("excerpt", pa.string()),
    ("description", pa.string()),  # Markdown, as on the portal
    ("topics", pa.list_(pa.string())),
    ("civic_issues", pa.list_(pa.string())),
    ("tags", pa.list_(pa.string())),
    ("category", pa.string()),  # Table, Map, Document, ...
    ("refresh_rate", pa.string()),
    ("last_refreshed", pa.string()),  # ISO date
])


def text(value) -> str:
    return (value or "").replace("\r\n", "\n").strip()


def strings(value) -> list:
    """A CKAN list field as a list of strings (it may be null or a comma-separated string)."""
    if not value:
        return []
    if isinstance(value, str):
        value = value.split(",")
    return [s.strip() for s in value if s and s.strip()]


def dataset_row(package) -> dict:
    meta = package.metadata
    return {
        "name": package.name,
        "id": package.id,
        "title": text(meta.get("title")) or package.name,
        "publisher": text(package.owner),
        "excerpt": text(meta.get("excerpt")),
        "description": text(meta.get("notes")),
        "topics": strings(meta.get("topics")),
        "civic_issues": strings(meta.get("civic_issues")),
        "tags": [t["display_name"] for t in meta.get("tags") or [] if t.get("display_name")],
        "category": text(meta.get("dataset_category")),
        "refresh_rate": text(meta.get("refresh_rate")),
        "last_refreshed": text(meta.get("last_refreshed"))[:10],
    }


def datasets_table(packages) -> pa.Table:
    return pa.Table.from_pylist([dataset_row(p) for p in packages], schema=SCHEMA)


def write_datasets(path, packages) -> int:
    table = datasets_table(packages)
    pq.write_table(table, path)  # Snappy by default
    return table.num_rows
