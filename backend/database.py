from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from pathlib import Path
from models import Base

DB_PATH = Path(__file__).parent / "bringe.db"
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


# Lightweight migration: columns we want to ensure exist on each table.
# `Base.metadata.create_all` only creates missing tables, not missing columns,
# so we add anything we've introduced after the table was first created.
_REQUIRED_COLUMNS = {
    "venues": [
        ("lat", "REAL"),
        ("lng", "REAL"),
        ("geocoded_at", "TIMESTAMP"),
    ],
}


async def _ensure_columns(conn):
    for table, cols in _REQUIRED_COLUMNS.items():
        result = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
        existing = {row[1] for row in result.fetchall()}
        for name, sql_type in cols:
            if name not in existing:
                await conn.exec_driver_sql(
                    f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"
                )


async def _cleanup_bad_venues(conn):
    """Older scraper versions captured the site nav link as the venue,
    creating a single 'Venues' venue with slug 'venues' pointing at
    /venues/ (no slug). Null its venue_id on attached shows so they
    display as venue-unknown, and delete the bogus venue row.

    Affected shows are picked up by the next 'Force re-scrape all'."""
    result = await conn.exec_driver_sql(
        "SELECT id FROM venues WHERE slug = 'venues' "
        "AND (url IS NULL OR url LIKE '%/venues/' OR url LIKE '%/venues')"
    )
    row = result.fetchone()
    if row:
        bad_id = row[0]
        await conn.exec_driver_sql(
            f"UPDATE shows SET venue_id = NULL WHERE venue_id = {bad_id}"
        )
        await conn.exec_driver_sql(
            f"DELETE FROM venues WHERE id = {bad_id}"
        )


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_columns(conn)
        await _cleanup_bad_venues(conn)


async def get_db():
    async with SessionLocal() as session:
        yield session
