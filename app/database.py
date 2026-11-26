import os

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker


DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

# Render and other hosts may provide the legacy postgres:// scheme. Normalize
# every PostgreSQL URL to the psycopg 3 driver installed by requirements-api.txt.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

database_url = make_url(DATABASE_URL)
if (
    database_url.get_backend_name() == "postgresql"
    and database_url.drivername != "postgresql+psycopg"
):
    database_url = database_url.set(drivername="postgresql+psycopg")

if database_url.username and "yourprojectref" in database_url.username.lower():
    raise RuntimeError(
        "DATABASE_URL still contains the Supabase placeholder 'YOURPROJECTREF'. "
        "Set it to this project's Supabase connection string in the hosting environment."
    )

DATABASE_URL = database_url

# Require TLS for remote databases while keeping local Docker PostgreSQL usable.
local_hosts = {"postgres", "localhost", "127.0.0.1", "::1"}
default_sslmode = "disable" if (database_url.host or "").lower() in local_hosts else "require"
DB_SSLMODE = os.getenv("DB_SSLMODE", database_url.query.get("sslmode", default_sslmode))

engine = create_engine(
    str(DATABASE_URL),
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=2,
    max_overflow=1,
    connect_args={
        "sslmode": DB_SSLMODE,
    },
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
