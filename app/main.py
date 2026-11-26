
import io
import json
import logging
import os
import re
import uuid
import hashlib
import zipfile
from sqlalchemy.orm import Session

from app import models
from app.database import Base, engine, get_db
from datetime import datetime, timezone

from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FilterSelector,
    FieldCondition,
    MatchValue,
)
from urllib.error import URLError
from urllib.request import Request, urlopen

from app.auth import router as auth_router, get_current_user
from app.models import ChatConversation, ChatMessage, User

from app.ingestion.document_loader import extract_text
from app.ingestion.chunker import chunk_text
from app.embeddings.embedder import generate_embeddings
from app.generation.ollama_client import (
    OLLAMA_MODEL,
    OLLAMA_URL,
    generate_answer,
)

logger = logging.getLogger(__name__)


# ==================================================
# 1. APPLICATION CONFIGURATION
# ==================================================

app = FastAPI(
    title="RAG Engineering Platform",
    description="AI-powered document question answering using RAG",
    version="2.1.0",
)

Base.metadata.create_all(bind=engine)
app.include_router(auth_router)

COLLECTION_NAME = os.getenv("QDRANT_COLLECTION", "documents")
VECTOR_SIZE = 384
SIMILARITY_THRESHOLD = 0.40
MAX_RETRIEVAL_CANDIDATES = 20

MAX_FILE_SIZE = 10 * 1024 * 1024

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333").strip()
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "").strip() or None

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
)


# ==================================================
# 2. COMMON HELPERS
# ==================================================

def user_filter(user_id: int) -> Filter:
    return Filter(
        must=[
            FieldCondition(
                key="user_id",
                match=MatchValue(value=user_id),
            )
        ]
    )


def filename_filter(filename: str, user_id: int) -> Filter:
    return Filter(
        must=[
            FieldCondition(
                key="filename",
                match=MatchValue(value=filename),
            ),
            FieldCondition(
                key="user_id",
                match=MatchValue(value=user_id),
            ),
        ]
    )


def document_hash_filter(document_hash: str, user_id: int):
    return Filter(
        must=[
            FieldCondition(
                key="document_hash",
                match=MatchValue(value=document_hash),
            ),
            FieldCondition(
                key="user_id",
                match=MatchValue(value=user_id),
            ),
        ]
    )


def get_document_points_by_hash(document_hash: str, user_id: int):
    points = []
    offset = None

    while True:
        batch, next_offset = client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=document_hash_filter(document_hash, user_id),
            limit=100,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        points.extend(batch)

        if next_offset is None:
            break

        offset = next_offset

    return points


def get_user_file_path(
    document_hash: str,
    filename: str,
    user_id: int,
) -> str:
    extension = os.path.splitext(filename)[1].lower()

    user_directory = os.path.join(
        UPLOAD_DIR,
        str(user_id),
    )

    return os.path.join(
        user_directory,
        f"{document_hash}{extension}",
    )


def remove_duplicate_chunks(points):
    unique_points = []
    seen_texts = set()

    for point in points:
        payload = point.payload or {}
        document_text = payload.get("text", "")

        normalized_text = " ".join(
            document_text.split()
        ).casefold()

        if not normalized_text or normalized_text in seen_texts:
            continue

        seen_texts.add(normalized_text)
        unique_points.append(point)

    return unique_points


STOP_WORDS = {
    "the", "is", "are", "was", "were", "a", "an",
    "and", "or", "of", "to", "in", "on", "for",
    "with", "what", "when", "where", "who", "how",
    "many", "much", "does", "do", "can", "could",
    "would", "should", "explain", "tell", "me",
    "about", "please", "give", "show"
}


def extract_keywords(text: str) -> set:
    words = re.findall(r"[a-z0-9]+", text.casefold())

    return {
        word for word in words
        if len(word) > 2 and word not in STOP_WORDS
    }


def calculate_keyword_overlap(question: str, document_text: str) -> float:
    query_terms = extract_keywords(question)
    document_terms = extract_keywords(document_text)

    if not query_terms:
        return 0.0

    matching_terms = query_terms.intersection(document_terms)

    return len(matching_terms) / len(query_terms)


def retrieve_relevant_chunks(
    question: str,
    user_id: int,
    limit: int = 5,
):
    """
    Retrieve vector candidates and rerank them using
    semantic similarity plus keyword overlap.
    """
    query_vector = generate_embeddings([question])[0]
    safe_limit = max(
        1,
        min(int(limit), MAX_RETRIEVAL_CANDIDATES)
    )
    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        query_filter=user_filter(user_id),
        limit=MAX_RETRIEVAL_CANDIDATES,
        with_payload=True,
    )

    candidates = []

    for point in results.points:
        payload = point.payload or {}
        score = point.score
        document_text = payload.get("text", "")

        if score is None or score < SIMILARITY_THRESHOLD:
            continue
        if not isinstance(document_text, str):
            continue
        if not document_text.strip():
            continue

        candidates.append(point)

    candidates = remove_duplicate_chunks(candidates)

    ranked_candidates = []

    for point in candidates:
        payload = point.payload or {}

        semantic_score = max(0.0, min(1.0, float(point.score)))

        keyword_score = calculate_keyword_overlap(
            question,
            payload.get("text", "")
        )

        combined_score = (
            0.65 * semantic_score
            + 0.35 * keyword_score
        )

        ranked_candidates.append(
            (point, combined_score)
        )

    ranked_candidates.sort(
        key=lambda item: item[1],
        reverse=True
    )

    return [
        point
        for point, combined_score in ranked_candidates[:safe_limit]
    ]


def get_document_points(filename: str, user_id: int):
    offset = None
    all_points = []

    while True:
        points, next_offset = client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=filename_filter(filename, user_id),
            limit=100,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        all_points.extend(points)

        if next_offset is None:
            break

        offset = next_offset

    return all_points


def document_already_exists(
    document_hash: str,
    document_text: str,
    user_id: int,
) -> bool:

    offset = None
    legacy_documents = {}

    while True:
        points, next_offset = client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=user_filter(user_id),
            limit=256,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        for point in points:
            payload = point.payload or {}

            if payload.get("document_hash") == document_hash:
                return True

            if not payload.get("document_hash"):
                filename = payload.get("filename", "unknown")
                chunk_index = payload.get("chunk_index")
                text_value = payload.get("text", "")

                if chunk_index is not None and text_value:
                    legacy_documents.setdefault(
                        filename, {}
                    ).setdefault(chunk_index, text_value)

        if next_offset is None:
            break

        offset = next_offset

    # Check older documents that did not have a SHA-256 hash.
    for chunks in legacy_documents.values():
        ordered_chunks = [
            chunks[index]
            for index in sorted(chunks)
        ]

        if not ordered_chunks:
            continue

        reconstructed_words = ordered_chunks[0].split()

        for chunk in ordered_chunks[1:]:
            next_words = chunk.split()
            overlap = 0

            max_overlap = min(
                30,
                len(reconstructed_words),
                len(next_words),
            )

            for size in range(max_overlap, 0, -1):
                if reconstructed_words[-size:] == next_words[:size]:
                    overlap = size
                    break

            reconstructed_words.extend(next_words[overlap:])

        reconstructed_text = " ".join(reconstructed_words)

        if reconstructed_text.casefold() == " ".join(
            document_text.split()
        ).casefold():
            return True

    return False


def save_original_file(content: bytes, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)

    with open(path, "wb") as stored_file:
        stored_file.write(content)


def ensure_collection():
    collections = client.get_collections().collections

    exists = any(
        collection.name == COLLECTION_NAME
        for collection in collections
    )

    if not exists:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=VECTOR_SIZE,
                distance=Distance.COSINE,
            ),
        )


# ==================================================
# 3. REQUEST MODELS
# ==================================================

class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=10)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=10)
    history: list[dict[str, str]] = Field(
        default_factory=list,
        max_length=8
    )


class RetrievalEvaluationRequest(BaseModel):
    question: str = Field(min_length=1)
    expected_filenames: list[str] = Field(
        min_length=1,
        max_length=20
    )
    limit: int = Field(default=5, ge=1, le=10)


# ==================================================
# 4. HOME AND HEALTH
# ==================================================

@app.get("/")
def home():
    return {
        "message": "RAG Engineering Platform is running",
        "version": "2.1.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health():
    try:
        client.get_collections()

        return {
            "status": "healthy",
            "qdrant": "connected",
        }

    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"Qdrant connection failed: {error}",
        )


# ==================================================
# 5. DOCUMENT UPLOAD
# ==================================================

@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Filename is missing.",
        )

    filename = os.path.basename(file.filename)
    extension = os.path.splitext(filename)[1].lower()

    if extension not in {".txt", ".pdf", ".docx"}:
        raise HTTPException(
            status_code=400,
            detail="Only TXT, PDF and DOCX files are supported.",
        )

    try:
        content = await file.read(MAX_FILE_SIZE + 1)

        if not content:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty.",
            )

        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Maximum file size is 10 MB.",
            )

        # Validate file content.
        if extension == ".pdf":
            if not content.startswith(b"%PDF-"):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid PDF file.",
                )

        elif extension == ".txt":
            try:
                content.decode("utf-8")
            except UnicodeDecodeError:
                raise HTTPException(
                    status_code=400,
                    detail="TXT file must use UTF-8 encoding.",
                )

        elif extension == ".docx":
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    files = archive.infolist()

                    if len(files) > 2000:
                        raise HTTPException(
                            status_code=400,
                            detail="DOCX contains too many internal files.",
                        )

                    total_size = sum(
                        item.file_size for item in files
                    )

                    if total_size > 50 * 1024 * 1024:
                        raise HTTPException(
                            status_code=400,
                            detail="DOCX extracted content exceeds 50 MB.",
                        )

                    required = {
                        "[Content_Types].xml",
                        "word/document.xml",
                    }

                    if not required.issubset(set(archive.namelist())):
                        raise HTTPException(
                            status_code=400,
                            detail="Invalid DOCX structure.",
                        )

            except zipfile.BadZipFile:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid DOCX file.",
                )

        # Extract document text.
        document_text = extract_text(
            file_bytes=content,
            filename=filename,
        )

        if not document_text.strip():
            raise HTTPException(
                status_code=400,
                detail="No readable text found in the document.",
            )

        document_hash = hashlib.sha256(content).hexdigest()

        stored_path = get_user_file_path(
            document_hash,
            filename,
            current_user.id,
        )

        # Check duplicates for this user only.
        if document_already_exists(
            document_hash,
            document_text,
            current_user.id,
        ):

            # Restore original file if it is missing.
            if not os.path.isfile(stored_path):
                save_original_file(content, stored_path)

            # Update metadata on matching existing chunks.
            existing_points = get_document_points(
                filename,
                current_user.id,
            )

            point_ids = [
                point.id for point in existing_points
            ]

            if point_ids:
                client.set_payload(
                    collection_name=COLLECTION_NAME,
                    payload={
                        "document_hash": document_hash,
                        "file_type": extension.lstrip("."),
                        "user_id": current_user.id,
                    },
                    points=point_ids,
                    wait=True,
                )

            return {
                "message": "Duplicate document detected. Original file saved.",
                "filename": filename,
                "duplicate": True,
                "stored": True,
                "document_hash": document_hash,
            }

        # Split into chunks.
        chunks = chunk_text(document_text)

        if not chunks:
            raise HTTPException(
                status_code=400,
                detail="No text chunks were created.",
            )

        # Generate embeddings.
        embeddings = generate_embeddings(chunks)

        if len(embeddings) != len(chunks):
            raise RuntimeError(
                "Embedding count does not match chunk count."
            )

        points = []

        for index, (chunk, embedding) in enumerate(
            zip(chunks, embeddings)
        ):
            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload={
                        "filename": filename,
                        "text": chunk,
                        "chunk_index": index,
                        "document_hash": document_hash,
                        "file_type": extension.lstrip("."),
                        "user_id": current_user.id,
                    },
                )
            )

        # Save to this user's folder, never the shared root.
        save_original_file(content, stored_path)

        try:
            client.upsert(
                collection_name=COLLECTION_NAME,
                points=points,
                wait=True,
            )

        except Exception:
            if os.path.isfile(stored_path):
                os.remove(stored_path)
            raise

        return {
            "message": "Document uploaded successfully",
            "filename": filename,
            "file_type": extension.lstrip("."),
            "duplicate": False,
            "chunks_created": len(chunks),
            "vectors_stored": len(points),
            "document_hash": document_hash,
        }

    except HTTPException:
        raise

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except RuntimeError as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Document upload failed: {error}",
        )


# ==================================================
# 6. SEMANTIC SEARCH
# ==================================================

@app.post("/search")
def search_documents(
    request: SearchRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        matches = retrieve_relevant_chunks(
            question=request.query,
            user_id=current_user.id,
            limit=request.limit,
        )

        results = []
        for point in matches:
            payload = point.payload or {}
            results.append({
                "filename": payload.get("filename", "unknown"),
                "file_type": payload.get("file_type", "unknown"),
                "document_hash": payload.get("document_hash"),
                "text": payload.get("text", ""),
                "chunk_index": payload.get("chunk_index"),
                "score": point.score,
            })

        return {
            "query": request.query,
            "results_found": len(results),
            "results": results,
            "similarity_threshold": SIMILARITY_THRESHOLD,
            "retrieval_limit": min(
                max(int(request.limit), 1),
                MAX_RETRIEVAL_CANDIDATES,
            ),
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {error}",
        )


@app.post("/evaluate-retrieval")
def evaluate_retrieval(
    request: RetrievalEvaluationRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        relevant_points = retrieve_relevant_chunks(
            question=request.question,
            user_id=current_user.id,
            limit=request.limit,
        )

        # Normalize expected filenames.
        expected = {
            name.strip().casefold()
            for name in request.expected_filenames
            if name.strip()
        }

        if not expected:
            raise HTTPException(
                status_code=400,
                detail="Provide at least one expected filename."
            )

        # Keep one result per unique document.
        retrieved_documents = []
        seen = set()

        for point in relevant_points:
            payload = point.payload or {}
            filename = payload.get("filename")

            if not isinstance(filename, str) or not filename.strip():
                continue

            normalized = filename.strip().casefold()

            if normalized in seen:
                continue

            seen.add(normalized)
            retrieved_documents.append({
                "filename": filename,
                "score": round(float(point.score), 4),
                "relevant": normalized in expected,
            })

        retrieved_names = {
            item["filename"].strip().casefold()
            for item in retrieved_documents
        }

        relevant_retrieved = [
            item for item in retrieved_documents
            if item["relevant"]
        ]

        # Document-level precision and recall.
        precision = (
            len(relevant_retrieved) / len(retrieved_documents)
            if retrieved_documents else 0.0
        )
        recall = len(expected.intersection(retrieved_names)) / len(expected)

        # Reciprocal rank of the first relevant document.
        reciprocal_rank = 0.0

        for rank, item in enumerate(
            retrieved_documents,
            start=1
        ):
            if item["relevant"]:
                reciprocal_rank = 1.0 / rank
                break

        missing_documents = sorted(expected - retrieved_names)

        return {
            "question": request.question,
            "metrics": {
                "precision_at_k": round(precision, 4),
                "recall_at_k": round(recall, 4),
                "mean_reciprocal_rank": round(
                    reciprocal_rank, 4
                ),
            },
            "expected_document_count": len(expected),
            "retrieved_document_count": len(retrieved_documents),
            "relevant_documents_found": len(relevant_retrieved),
            "missing_expected_documents": missing_documents,
            "retrieved_documents": retrieved_documents,
            "evaluation_note": (
                "Metrics are document-level and use the supplied "
                "expected filenames as ground truth."
            ),
        }

    except HTTPException:
        raise

    except RuntimeError as error:
        raise HTTPException(
            status_code=502,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Retrieval evaluation failed: {error}",
        )


# ==================================================
# 7. AI CHAT
# ==================================================

def resolve_followup_question(
    question: str,
    history: list[dict[str, str]],
) -> str:
    if not history:
        return question

    safe_history = []

    for message in history[-8:]:
        role = message.get("role", "")
        content = message.get("content", "")

        if not isinstance(role, str) or role not in ("user", "assistant"):
            continue
        if not isinstance(content, str):
            continue

        content = content.strip()

        if not content:
            continue

        safe_history.append({
            "role": role,
            "content": content[:1500],
        })

    if not safe_history:
        return question

    history_text = "\n".join(
        f"{message['role']}: {message['content']}"
        for message in safe_history
    )

    prompt = f"""
Convert the user's latest question into a standalone
search query that can be understood without conversation history.

Use conversation history ONLY to resolve references such as:
"it", "that policy", "what about sick leave", or "how many days".

Do not answer the question.
Do not add facts.
Do not assume information that is not in the conversation.
Preserve the user's intended meaning.

CONVERSATION HISTORY:
{history_text}

LATEST QUESTION:
{question}

Return ONLY the standalone question.
"""

    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ],
        "think": False,
        "stream": False,
        "options": {
            "temperature": 0,
            "num_predict": 100,
            "num_ctx": 4096
        }
    }

    ollama_request = Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urlopen(ollama_request, timeout=90) as response:
            result = json.loads(
                response.read().decode("utf-8")
            )

        if not isinstance(result, dict):
            logger.warning(
                "Follow-up query resolution returned an invalid response."
            )
            return question

        message = result.get("message", {})
        rewritten = (
            message.get("content", "").strip()
            if isinstance(message, dict)
            and isinstance(message.get("content", ""), str)
            else ""
        )

        if not rewritten:
            logger.warning(
                "Follow-up query resolution returned an empty query."
            )
            return question

        return rewritten[:500]

    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        logger.warning(
            "Follow-up query resolution failed; using the original question: %s",
            error,
        )
        return question


@app.post("/chat")
def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        search_question = resolve_followup_question(
            question=request.question,
            history=request.history,
        )

        relevant_points = retrieve_relevant_chunks(
            question=search_question,
            user_id=current_user.id,
            limit=request.limit,
        )

        if not relevant_points:
            return {
                "question": request.question,
                "answer": (
                    "This information is not available in your "
                    "uploaded documents."
                ),
                "sources": [],
                "message": "No relevant document chunks found.",
                "similarity_threshold": SIMILARITY_THRESHOLD,
            }

        context_parts = []
        sources = []
        seen_sources = set()

        for index, point in enumerate(relevant_points, start=1):
            payload = point.payload or {}
            text_value = payload.get("text", "").strip()

            if not text_value:
                continue

            filename = payload.get(
                "filename",
                "Unknown document"
            )

            file_type = payload.get(
                "file_type",
                "unknown"
            )

            document_hash = payload.get("document_hash")
            chunk_index = payload.get("chunk_index")

            # Give each evidence chunk a clear reference.
            source_reference = f"S{index}"

            context_parts.append(
                f"""
[{source_reference}]
Source filename: {filename}
Chunk index: {chunk_index}

Document content:
{text_value}
"""
            )

            # Keep each document chunk only once in the
            # returned source list.
            source_key = (
                document_hash,
                filename,
                chunk_index,
            )

            if source_key in seen_sources:
                continue

            seen_sources.add(source_key)

            excerpt = text_value[:300]

            if len(text_value) > 300:
                excerpt += "..."

            sources.append({
                "source_id": source_reference,
                "filename": filename,
                "file_type": file_type,
                "document_hash": document_hash,
                "chunk_index": chunk_index,
                "score": round(float(point.score), 4),
                "excerpt": excerpt,
            })

        if not context_parts:
            return {
                "question": request.question,
                "answer": (
                    "This information is not available in your "
                    "uploaded documents."
                ),
                "sources": [],
                "message": "No usable document content was found.",
            }

        context = "\n\n".join(context_parts)

        answer_question = (
            f"Original user question: {request.question}\n\n"
            f"Standalone interpretation: {search_question}"
        )

        answer = generate_answer(
            question=answer_question,
            context=context,
        )

        return {
            "question": request.question,
            "answer": answer,
            "search_question": search_question,
            "sources": sources,
            "source_count": len(sources),
            "similarity_threshold": SIMILARITY_THRESHOLD,
        }

    except RuntimeError as error:
        raise HTTPException(
            status_code=502,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Chat failed: {error}",
        )
# ==================================================
# 8. LIST DOCUMENTS
# ==================================================

@app.get("/documents")
def list_documents(
    current_user: User = Depends(get_current_user),
):
    try:
        offset = None
        documents = {}

        while True:
            points, next_offset = client.scroll(
                collection_name=COLLECTION_NAME,
                scroll_filter=user_filter(current_user.id),
                limit=100,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )

            for point in points:
                payload = point.payload or {}
                filename = payload.get("filename", "unknown")
                document_hash = payload.get("document_hash")
                document_key = (
                    document_hash
                    if document_hash
                    else f"legacy:{filename}"
                )

                if document_key not in documents:
                    documents[document_key] = {
                        "document_hash": document_hash,
                        "filename": filename,
                        "file_type": payload.get("file_type", "unknown"),
                        "chunks": 0,
                        "file_size_bytes": payload.get("file_size_bytes"),
                        "uploaded_at": payload.get("uploaded_at"),
                    }

                documents[document_key]["chunks"] += 1

            if next_offset is None:
                break

            offset = next_offset

        return {
            "total_documents": len(documents),
            "documents": list(documents.values()),
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Document listing failed: {error}",
        )


# ==================================================
# 9. PREVIEW DOCUMENT
# ==================================================

@app.get("/documents/{document_hash}/preview")
def preview_document(
    document_hash: str,
    current_user: User = Depends(get_current_user),
):
    try:
        points = get_document_points_by_hash(
            document_hash,
            current_user.id,
        )

        if not points:
            raise HTTPException(
                status_code=404,
                detail="Document not found.",
            )

        payload = points[0].payload or {}
        filename = payload.get("filename")

        if not filename:
            raise HTTPException(
                status_code=404,
                detail="Document filename is unavailable.",
            )

        extension = os.path.splitext(filename)[1].lower()

        preview_types = {
            ".pdf": "application/pdf",
            ".txt": "text/plain",
        }

        if extension not in preview_types:
            raise HTTPException(
                status_code=400,
                detail="Preview is available only for PDF and TXT.",
            )

        stored_path = get_user_file_path(
            document_hash,
            filename,
            current_user.id,
        )

        if not os.path.isfile(stored_path):
            raise HTTPException(
                status_code=404,
                detail="Original file not found in storage.",
            )

        return FileResponse(
            path=stored_path,
            media_type=preview_types[extension],
            content_disposition_type="inline",
        )

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Preview failed: {error}",
        )


# ==================================================
# 10. DOWNLOAD DOCUMENT
# ==================================================

@app.get("/documents/{document_hash}/download")
def download_document(
    document_hash: str,
    current_user: User = Depends(get_current_user),
):
    try:
        points = get_document_points_by_hash(
            document_hash,
            current_user.id,
        )

        if not points:
            raise HTTPException(
                status_code=404,
                detail="Document not found.",
            )

        payload = points[0].payload or {}
        filename = payload.get("filename")

        if not filename:
            raise HTTPException(
                status_code=404,
                detail="Document filename is unavailable.",
            )

        extension = os.path.splitext(filename)[1].lower()

        if extension not in {".txt", ".pdf", ".docx"}:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type.",
            )

        stored_path = get_user_file_path(
            document_hash,
            filename,
            current_user.id,
        )

        if not os.path.isfile(stored_path):
            raise HTTPException(
                status_code=404,
                detail="Original file not found in storage.",
            )

        return FileResponse(
            path=stored_path,
            filename=filename,
            media_type="application/octet-stream",
        )

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Download failed: {error}",
        )


# ==================================================
# 11. DELETE DOCUMENT
# ==================================================

@app.delete("/documents/{document_hash}")
def delete_document(
    document_hash: str,
    current_user: User = Depends(get_current_user),
):
    try:
        points = get_document_points_by_hash(
            document_hash,
            current_user.id,
        )

        if not points:
            raise HTTPException(
                status_code=404,
                detail="Document not found.",
            )

        payload = points[0].payload or {}
        filename = payload.get("filename")

        if not filename:
            raise HTTPException(
                status_code=404,
                detail="Document filename is unavailable.",
            )

        client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=FilterSelector(
                filter=document_hash_filter(
                    document_hash,
                    current_user.id,
                )
            ),
            wait=True,
        )

        stored_path = get_user_file_path(
            document_hash,
            filename,
            current_user.id,
        )

        if os.path.isfile(stored_path):
            os.remove(stored_path)

        return {
            "message": "Document deleted successfully",
            "filename": filename,
            "document_hash": document_hash,
            "chunks_deleted": len(points),
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Document deletion failed: {error}",
        )


# ==================================================
# 12. DOCUMENT ANALYTICS
# ==================================================

@app.get("/analytics")
def document_analytics(
    current_user: User = Depends(get_current_user),
):

    try:
        offset = None
        documents = {}
        file_type_stats = {}
        total_chunks = 0

        while True:
            points, next_offset = client.scroll(
                collection_name=COLLECTION_NAME,
                scroll_filter=user_filter(current_user.id),
                limit=100,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )

            for point in points:
                payload = point.payload or {}

                filename = payload.get("filename", "unknown")
                file_type = payload.get("file_type", "unknown")
                document_hash = payload.get("document_hash")

                total_chunks += 1

                if filename not in documents:
                    file_size_bytes = None
                    uploaded_at = None

                    if document_hash:
                        stored_path = get_user_file_path(
                            document_hash,
                            filename,
                            current_user.id,
                        )

                        if os.path.isfile(stored_path):
                            file_size_bytes = os.path.getsize(
                                stored_path
                            )

                            uploaded_at = datetime.fromtimestamp(
                                os.path.getmtime(stored_path),
                                tz=timezone.utc,
                            ).isoformat()

                    documents[filename] = {
                        "filename": filename,
                        "file_type": file_type,
                        "chunks": 0,
                        "file_size_bytes": file_size_bytes,
                        "uploaded_at": uploaded_at,
                    }

                documents[filename]["chunks"] += 1

                if file_type not in file_type_stats:
                    file_type_stats[file_type] = {
                        "documents": set(),
                        "chunks": 0,
                    }

                file_type_stats[file_type]["documents"].add(
                    filename
                )

                file_type_stats[file_type]["chunks"] += 1

            if next_offset is None:
                break

            offset = next_offset

        distribution = {
            file_type: {
                "documents": len(stats["documents"]),
                "chunks": stats["chunks"],
            }
            for file_type, stats in file_type_stats.items()
        }

        return {
            "total_documents": len(documents),
            "total_chunks": total_chunks,
            "total_vectors": total_chunks,
            "file_type_distribution": distribution,
            "documents": list(documents.values()),
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Analytics failed: {error}",
        )


# ==================================================
# 13. APPLICATION STARTUP
# ==================================================

@app.on_event("startup")
def startup_event():
    ensure_collection()


class ChatConversationCreate(BaseModel):
    title: str = Field(default="New Chat", min_length=1, max_length=255)


class ChatMessageCreate(BaseModel):
    role: str
    content: str
    sources: list = Field(default_factory=list)


@app.get("/chat/conversations")
def get_chat_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversations = (
        db.query(ChatConversation)
        .filter(ChatConversation.user_id == current_user.id)
        .order_by(ChatConversation.updated_at.desc())
        .all()
    )

    return {
        "conversations": [
            {
                "id": chat.id,
                "title": chat.title,
                "created_at": chat.created_at,
                "updated_at": chat.updated_at,
            }
            for chat in conversations
        ]
    }


@app.post("/chat/conversations")
def create_chat_conversation(
    payload: ChatConversationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = ChatConversation(
        user_id=current_user.id,
        title=payload.title,
    )

    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    return {
        "message": "Conversation created successfully",
        "conversation": {
            "id": conversation.id,
            "title": conversation.title,
            "created_at": conversation.created_at,
        },
    }

@app.post("/chat/conversations/{conversation_id}/messages")
def save_chat_message(
    conversation_id: int,
    payload: ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = (
        db.query(ChatConversation)
        .filter(
            ChatConversation.id == conversation_id,
            ChatConversation.user_id == current_user.id,
        )
        .first()
    )

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    if payload.role not in {"user", "assistant"}:
        raise HTTPException(
            status_code=400,
            detail="Role must be user or assistant",
        )

    message = ChatMessage(
        conversation_id=conversation_id,
        role=payload.role,
        content=payload.content,
        sources=payload.sources or [],
    )
    db.add(message)
    conversation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(message)

    return {
        "message": "Chat message saved successfully",
        "data": {
            "id": message.id,
            "conversation_id": message.conversation_id,
            "role": message.role,
            "content": message.content,
            "created_at": message.created_at,
        },
    }


@app.get("/chat/conversations/{conversation_id}/messages")
def get_chat_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = (
        db.query(ChatConversation)
        .filter(
            ChatConversation.id == conversation_id,
            ChatConversation.user_id == current_user.id,
        )
        .first()
    )

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        .all()
    )

    return {
        "conversation_id": conversation_id,
        "messages": [
            {
                "id": message.id,
                "role": message.role,
                "content": message.content,
                "sources": message.sources or [],
                "created_at": message.created_at,
            }
            for message in messages
        ],
    }


@app.delete("/chat/conversations/{conversation_id}")
def delete_chat_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = (
        db.query(ChatConversation)
        .filter(
            ChatConversation.id == conversation_id,
            ChatConversation.user_id == current_user.id,
        )
        .first()
    )

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    db.delete(conversation)
    db.commit()

    return {
        "message": "Conversation deleted successfully"
    }


class ChatConversationUpdate(BaseModel):
    title: str


@app.patch("/chat/conversations/{conversation_id}")
def update_chat_conversation(
    conversation_id: int,
    payload: ChatConversationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=400,
            detail="Conversation title cannot be empty",
        )

    conversation = (
        db.query(ChatConversation)
        .filter(
            ChatConversation.id == conversation_id,
            ChatConversation.user_id == current_user.id,
        )
        .first()
    )

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    conversation.title = title[:100]
    conversation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conversation)

    return {
        "message": "Conversation updated successfully",
        "conversation": {
            "id": conversation.id,
            "title": conversation.title,
            "updated_at": conversation.updated_at,
        },
    }


class ChatMessageUpdate(BaseModel):
    content: str


@app.put("/chat/conversations/{conversation_id}/messages/{message_id}")
def update_chat_message(
    conversation_id: int,
    message_id: int,
    payload: ChatMessageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = (
        db.query(ChatConversation)
        .filter(
            ChatConversation.id == conversation_id,
            ChatConversation.user_id == current_user.id,
        )
        .first()
    )

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    message = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.id == message_id,
            ChatMessage.conversation_id == conversation_id,
        )
        .first()
    )

    if not message or message.role != "user":
        raise HTTPException(status_code=404, detail="User message not found")

    message.content = payload.content.strip()
    message.sources = []
    db.query(ChatMessage).filter(
        ChatMessage.conversation_id == conversation_id,
        ChatMessage.id > message.id,
    ).delete(synchronize_session=False)
    conversation.updated_at = datetime.utcnow()

    db.commit()

    return {"message": "Question updated successfully"}
