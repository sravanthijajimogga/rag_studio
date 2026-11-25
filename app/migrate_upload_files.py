
import os
import shutil
from qdrant_client import QdrantClient

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
COLLECTION_NAME = "documents"

client = QdrantClient(url=QDRANT_URL)

def migrate_files():
    offset = None
    files_to_migrate = set()

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

            user_id = payload.get("user_id")
            document_hash = payload.get("document_hash")
            filename = payload.get("filename", "")

            if not user_id or not document_hash:
                continue

            extension = os.path.splitext(filename)[1].lower()

            if (
                len(document_hash) == 64
                and all(c in "0123456789abcdef" for c in document_hash.lower())
                and extension in {".txt", ".pdf", ".docx"}
            ):
                files_to_migrate.add(
                    (str(user_id), document_hash, extension)
                )

        if next_offset is None:
            break

        offset = next_offset

    copied = 0
    already_present = 0
    missing = 0

    for user_id, document_hash, extension in files_to_migrate:
        filename = f"{document_hash}{extension}"

        source = os.path.join(UPLOAD_DIR, filename)
        user_dir = os.path.join(UPLOAD_DIR, user_id)
        destination = os.path.join(user_dir, filename)

        os.makedirs(user_dir, exist_ok=True)

        if os.path.isfile(destination):
            already_present += 1
            continue

        if os.path.isfile(source):
            shutil.copy2(source, destination)
            copied += 1
            print(f"Copied file for user {user_id}: {filename}")
        else:
            missing += 1
            print(f"Original file not found: {filename}")

    print("\nMigration completed.")
    print("Copied:", copied)
    print("Already present:", already_present)
    print("Missing:", missing)

if __name__ == "__main__":
    migrate_files()
