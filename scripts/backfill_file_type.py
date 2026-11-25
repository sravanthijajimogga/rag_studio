
import os
from pathlib import Path
from qdrant_client import QdrantClient

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = "documents"

client = QdrantClient(url=QDRANT_URL)


def backfill_file_types():
    offset = None
    updated = 0

    while True:
        points, next_offset = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        for point in points:
            payload = point.payload or {}

            filename = payload.get("filename", "")
            current_type = payload.get("file_type")

            if current_type and current_type != "unknown":
                continue

            extension = Path(filename).suffix.lower().lstrip(".")

            if extension not in {"txt", "pdf", "docx"}:
                continue

            client.set_payload(
                collection_name=COLLECTION_NAME,
                payload={"file_type": extension},
                points=[point.id],
                wait=True,
            )

            updated += 1
            print(f"Updated: {filename} -> {extension}")

        if next_offset is None:
            break

        offset = next_offset

    print(f"\nMigration complete. Records updated: {updated}")


if __name__ == "__main__":
    backfill_file_types()
