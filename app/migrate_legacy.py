
import argparse
import os

from qdrant_client import QdrantClient
from app.database import SessionLocal
from app.models import User

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = "documents"

client = QdrantClient(url=QDRANT_URL)


def migrate_legacy_documents(user_id=None):
    db = SessionLocal()

    try:
        users = db.query(User).all()

        if user_id is not None:
            user = next((user for user in users if user.id == user_id), None)
            if user is None:
                available_users = ", ".join(
                    f"{user.id} ({user.username})" for user in users
                )
                raise RuntimeError(
                    f"User ID {user_id} was not found. "
                    f"Available users: {available_users or 'none'}."
                )
        elif len(users) == 1:
            user = users[0]
        elif not users:
            raise RuntimeError(
                "No users are registered. Create a user before migrating "
                "legacy documents."
            )
        else:
            available_users = ", ".join(
                f"{user.id} ({user.username})" for user in users
            )
            raise RuntimeError(
                f"Found {len(users)} users, so ownership cannot be inferred. "
                f"Choose the owner and rerun with --user-id <ID>. "
                f"Available users: {available_users}."
            )

        owner_id = user.id
        print(f"Assigning legacy documents to user ID: {owner_id}")

        offset = None
        migrated = 0

        while True:
            points, next_offset = client.scroll(
                collection_name=COLLECTION_NAME,
                limit=100,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )

            legacy_ids = [
                point.id
                for point in points
                if (point.payload or {}).get("user_id") is None
            ]

            if legacy_ids:
                client.set_payload(
                    collection_name=COLLECTION_NAME,
                    payload={"user_id": owner_id},
                    points=legacy_ids,
                    wait=True,
                )
                migrated += len(legacy_ids)
                print(f"Migrated {migrated} chunks")

            if next_offset is None:
                break

            offset = next_offset

        print(f"Migration complete. Updated {migrated} chunks.")

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Assign unowned Qdrant documents to a registered user."
    )
    parser.add_argument(
        "--user-id",
        type=int,
        default=os.getenv("LEGACY_OWNER_ID"),
        help=(
            "ID of the user who should own legacy documents. Required when "
            "more than one user is registered. Can also be set with "
            "LEGACY_OWNER_ID."
        ),
    )
    args = parser.parse_args()
    migrate_legacy_documents(user_id=args.user_id)
