
from io import BytesIO
from pathlib import Path

import pymupdf
import pytesseract

from PIL import Image
from pypdf import PdfReader
from docx import Document


def extract_pdf_text(file_bytes: bytes) -> str:
    """
    Extract selectable PDF text first.
    If the PDF is scanned, use OCR.
    """

    # First attempt: normal PDF text extraction
    reader = PdfReader(BytesIO(file_bytes))

    extracted_pages = []

    for page in reader.pages:
        page_text = page.extract_text() or ""
        extracted_pages.append(page_text)

    extracted_text = "\n\n".join(extracted_pages)

    # Use normal extraction when sufficient text exists
    if len(extracted_text.strip()) >= 30:
        return extracted_text

    # Second attempt: OCR for scanned PDFs
    pdf_document = pymupdf.open(
        stream=file_bytes,
        filetype="pdf"
    )

    ocr_pages = []

    for page_number, page in enumerate(pdf_document):

        # Convert PDF page into an image
        pixmap = page.get_pixmap(
            dpi=200,
            colorspace=pymupdf.csRGB,
            alpha=False
        )

        image = Image.frombytes(
            "RGB",
            [pixmap.width, pixmap.height],
            pixmap.samples
        )

        # Extract text using Tesseract
        page_text = pytesseract.image_to_string(
            image,
            lang="eng"
        )

        if page_text.strip():
            ocr_pages.append(page_text)

    pdf_document.close()

    ocr_text = "\n\n".join(ocr_pages)

    if not ocr_text.strip():
        raise ValueError(
            "No readable text found in PDF, even after OCR."
        )

    return ocr_text


def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    Extract text from TXT, PDF and DOCX documents.
    """

    extension = Path(filename).suffix.lower()

    # TXT FILE
    if extension == ".txt":

        text = file_bytes.decode("utf-8-sig")

    # PDF FILE
    elif extension == ".pdf":

        text = extract_pdf_text(file_bytes)

    # DOCX FILE
    elif extension == ".docx":

        document = Document(BytesIO(file_bytes))

        paragraphs = [
            paragraph.text
            for paragraph in document.paragraphs
            if paragraph.text.strip()
        ]

        text = "\n\n".join(paragraphs)

    else:

        raise ValueError(
            "Unsupported format. Use TXT, PDF or DOCX."
        )

    if not text.strip():

        raise ValueError(
            "No readable text found in the document."
        )

    return text
