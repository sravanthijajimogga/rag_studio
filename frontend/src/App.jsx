
import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LandingPage from "./LandingPage";
import AuthPage from "./AuthPage";
import {
  apiFetch,
  apiUpload,
  getCurrentUser,
  logoutUser
} from "./auth";
import {
  LayoutDashboard,
  Files,
  MessageSquare,
  Search,
  Settings,
  Plus,
  FileText,
  Database,
  Layers,
  Zap,
  Activity,
  ArrowUpRight,
  Bot,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Upload,
  Copy,
  Trash2,
  Download,
  HardDrive
} from "lucide-react";

import "./App.css";

function App() {
  const [documentSearch, setDocumentSearch] = useState("");
const [documentTypeFilter, setDocumentTypeFilter] = useState("all");
const [documentSort, setDocumentSort] = useState("newest");
  const [searchQuery, setSearchQuery] = useState("");
const [searchResults, setSearchResults] = useState([]);
const [searchLoading, setSearchLoading] = useState(false);
const [authView, setAuthView] = useState("landing");
const [currentUser, setCurrentUser] = useState(null);
const [checkingSession, setCheckingSession] = useState(true);
const [searchError, setSearchError] = useState("");
const [searchedQuery, setSearchedQuery] = useState("");
  // Navigation
  const [activePage, setActivePage] = useState("Dashboard");
  // Analytics
  const [analytics, setAnalytics] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Document upload
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // AI Chat
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const chatEndRef = useRef(null);
  const chatAbortControllerRef = useRef(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [failedQuestion, setFailedQuestion] = useState("");
  const [editingMessageIndex, setEditingMessageIndex] = useState(null);
  const [editedQuestion, setEditedQuestion] = useState("");
// Chat History
const [conversations, setConversations] = useState([]);
const [chatHistorySearch, setChatHistorySearch] = useState("");
const [currentConversationId, setCurrentConversationId] = useState(null);
const [historyLoading, setHistoryLoading] = useState(false);
  function handleLoginSuccess(user) {
    setCurrentUser(user);
    setAuthView("app");
    setActivePage("Dashboard");
  }

  function handleLogout() {
    logoutUser();
    setCurrentUser(null);
    setAnalytics(null);
    setAuthView("landing");
    setActivePage("Dashboard");
    setChatMessages([]);
    setSearchResults([]);
  }

  // Load saved conversations for the logged-in user
async function fetchConversations() {
  setHistoryLoading(true);

  try {
    const response = await apiFetch("/api/chat/conversations");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Unable to load chat history");
    }

    setConversations(
      Array.isArray(data.conversations) ? data.conversations : []
    );
  } catch (err) {
    console.error("Chat history error:", err);
  } finally {
    setHistoryLoading(false);
  }
}

// Open an existing conversation and load its messages
async function openConversation(conversationId) {
  setHistoryLoading(true);
  setChatError("");
  setChatMessages([]);
  setCurrentConversationId(conversationId);

  try {
    const response = await apiFetch(
      `/api/chat/conversations/${conversationId}/messages`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Unable to load conversation");
    }

    setChatMessages(
      (data.messages || []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sources: message.sources || [],
      }))
    );

    setActivePage("AI Chat");
  } catch (err) {
    setChatError(err.message || "Unable to open conversation");
  } finally {
    setHistoryLoading(false);
  }
}

function startNewChat() {
  setCurrentConversationId(null);
  setChatMessages([]);
  setChatQuestion("");
  setChatError("");
  setActivePage("AI Chat");
}

async function handleDeleteConversation(conversationId) {
  const confirmed = window.confirm(
    "Are you sure you want to delete this conversation?"
  );

  if (!confirmed) return;

  try {
    const response = await apiFetch(
      `/api/chat/conversations/${conversationId}`,
      { method: "DELETE" }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Unable to delete conversation");
    }

    setConversations((previous) =>
      previous.filter((chat) => chat.id !== conversationId)
    );

    if (currentConversationId === conversationId) {
      startNewChat();
    }
  } catch (error) {
    setChatError(error.message);
  }
}

async function handleRenameConversation(conversation) {
  const newTitle = window.prompt(
    "Enter a new conversation title:",
    conversation.title
  );

  if (newTitle === null) return;

  const title = newTitle.trim();

  if (!title) {
    alert("Conversation title cannot be empty.");
    return;
  }

  try {
    const response = await apiFetch(
      `/api/chat/conversations/${conversation.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Unable to rename conversation");
    }

    setConversations((previous) =>
      previous.map((chat) =>
        chat.id === conversation.id
          ? { ...chat, title: data.conversation.title }
          : chat
      )
    );
  } catch (error) {
    setChatError(error.message);
  }
}

async function handleCopyResponse(content) {
  try {
    await navigator.clipboard.writeText(content);
    alert("AI response copied successfully!");
  } catch (error) {
    console.error("Copy failed:", error);
    setChatError("Unable to copy response. Please try again.");
  }
}

function startEditingMessage(index, content) {
  setEditingMessageIndex(index);
  setEditedQuestion(content);
}

async function handleRegenerate(messageIndex) {
  const message = chatMessages[messageIndex];

  if (!message?.question || chatLoading) return;

  const question = message.question;

  // Remove the old answer and everything after it
  setChatMessages((previous) => previous.slice(0, messageIndex));

  // Submit the original question directly
  await submitChatQuestion(question);
}

async function handleEditAndResend(messageIndex) {
  const newQuestion = editedQuestion.trim();

  if (!newQuestion || chatLoading || !currentConversationId) return;

  const oldMessage = chatMessages[messageIndex];

  if (!oldMessage || oldMessage.role !== "user") return;

  setChatLoading(true);
  setChatError("");

  try {
    // Update the existing question and remove outdated messages
    const updateResponse = await apiFetch(
      `/api/chat/conversations/${currentConversationId}/messages/${oldMessage.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newQuestion }),
      }
    );

    const updateData = await updateResponse.json();

    if (!updateResponse.ok) {
      throw new Error(updateData.detail || "Unable to update question");
    }

    // Keep only messages before the edited question
    setChatMessages((previous) => [
      ...previous.slice(0, messageIndex),
      {
        ...oldMessage,
        content: newQuestion,
        sources: [],
      },
    ]);

    setEditingMessageIndex(null);
    setEditedQuestion("");

    // Generate a new answer without creating another user message
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: newQuestion,
        limit: 5,
        history: chatMessages
          .slice(-8)
          .map((message) => ({
            role: message.role,
            content: message.content,
          })),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || "Unable to regenerate answer");
    }

    const answer =
      result.answer ||
      result.response ||
      result.message ||
      result.result ||
      "No answer returned.";

    const answerText =
      typeof answer === "string"
        ? answer
        : JSON.stringify(answer, null, 2);

    const sources = Array.isArray(result.sources) ? result.sources : [];

    // Save the new assistant response
    const saveResponse = await apiFetch(
      `/api/chat/conversations/${currentConversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "assistant",
          content: answerText,
          sources,
        }),
      }
    );

    const saveData = await saveResponse.json();

    if (!saveResponse.ok) {
      throw new Error(saveData.detail || "Unable to save new answer");
    }

    setChatMessages((previous) => [
      ...previous,
      {
        role: "assistant",
        content: answerText,
        sources,
        question: newQuestion,
      },
    ]);

    await fetchConversations();
  } catch (error) {
    setChatError(error.message || "Unable to edit question");
  } finally {
    setChatLoading(false);
  }
}

function exportConversation(conversation) {
  const content = chatMessages
    .map((message) => {
      const role = message.role === "user" ? "You" : "RAG Assistant";

      const sources =
        message.sources?.length > 0
          ? "\nSources:\n" +
            message.sources
              .map((source) => `- ${source.filename || "Unknown document"}`)
              .join("\n")
          : "";

      return `${role}:\n${message.content}${sources}`;
    })
    .join("\n\n--------------------\n\n");

  const file = new Blob(
    [
      `RAG Studio Conversation\n${conversation.title}\n\n${content}`,
    ],
    { type: "text/plain;charset=utf-8" }
  );

  const url = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${conversation.title.replace(/[^a-z0-9]/gi, "_")}.txt`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

  // Fetch live analytics
async function fetchAnalytics() {
  setLoading(true);
  setError("");

  try {
    // Fetch analytics and document metadata separately
    const [analyticsResponse, documentsResponse] = await Promise.all([
      apiFetch("/api/analytics"),
      apiFetch("/api/documents")
    ]);

    const analyticsData = await analyticsResponse.json();
    const documentsData = await documentsResponse.json();

    if (!analyticsResponse.ok) {
      throw new Error(
        analyticsData.detail || "Unable to load analytics"
      );
    }

    if (!documentsResponse.ok) {
      throw new Error(
        documentsData.detail || "Unable to load documents"
      );
    }

    setAnalytics(analyticsData);

    setDocuments(
      Array.isArray(documentsData.documents)
        ? documentsData.documents
        : []
    );

  } catch (err) {
    setError(err.message || "Unable to connect to backend");
  } finally {
    setLoading(false);
  }
}


 useEffect(() => {
  let active = true;

  async function checkSession() {
    try {
      const user = await getCurrentUser();

      if (!active) return;

      if (user) {
        setCurrentUser(user);
        setAuthView("app");
      } else {
        setAuthView("landing");
      }
    } catch {
      if (active) {
        logoutUser();
        setAuthView("landing");
      }
    } finally {
      if (active) setCheckingSession(false);
    }
  }

  checkSession();

  return () => {
    active = false;
  };
}, []);

useEffect(() => {
  if (authView === "app" && currentUser) {
    fetchAnalytics();
  }
},
 [authView, currentUser]);
 useEffect(() => {
  if (authView === "app" && currentUser && activePage === "AI Chat") {
    fetchConversations();
  }
}, [authView, currentUser, activePage]);

useEffect(() => {
  chatEndRef.current?.scrollIntoView({
    behavior: "smooth",
    block: "end",
  });
}, [chatMessages, chatLoading]);

// Upload document
const handleFileDrop = (event) => {
  event.preventDefault();
  setIsDragging(false);

  if (uploading) return;

  const file = event.dataTransfer.files?.[0];

  if (!file) return;

  setSelectedFile(file);
  setUploadMessage("");
};

const handleDragOver = (event) => {
  event.preventDefault();

  if (!uploading) {
    setIsDragging(true);
  }
};

async function handleUpload() {
  if (!selectedFile || uploading) return;

  const allowedExtensions = [".txt", ".pdf", ".docx"];
  const fileName = selectedFile.name.toLowerCase();
  const maxSize = 10 * 1024 * 1024;

  if (!allowedExtensions.some((ext) => fileName.endsWith(ext))) {
    setUploadMessage("Only TXT, PDF and DOCX files are supported.");
    return;
  }

  if (selectedFile.size === 0) {
    setUploadMessage("The selected file is empty.");
    return;
  }

  if (selectedFile.size > maxSize) {
    setUploadMessage("Maximum file size is 10 MB.");
    return;
  }

  const formData = new FormData();
  formData.append("file", selectedFile);

  setUploading(true);
  setUploadProgress(0);
  setUploadMessage("");

  try {
    const response = await apiUpload(
      "/api/upload",
      formData,
      (percentage) => setUploadProgress(percentage)
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : "Document upload failed"
      );
    }

    if (result.duplicate) {
      setUploadMessage("This document already exists.");
    } else {
      setUploadMessage(
        result.message || "Document uploaded successfully!"
      );
    }

    setSelectedFile(null);

    const fileInput = document.getElementById("document-upload");

    if (fileInput) {
      fileInput.value = "";
    }

    await fetchAnalytics();

  } catch (err) {
    setUploadMessage(`Upload failed: ${err.message}`);
  } finally {
    setUploading(false);
    setUploadProgress(0);
  }
}

  const handleDeleteDocument = async (documentHash) => {
    if (!window.confirm("Are you sure you want to delete this document?")) {
      return;
    }

    try {
      const response = await apiFetch(
        `/api/documents/${encodeURIComponent(documentHash)}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Unable to delete document");
      }

      alert("Document deleted successfully!");

      await fetchAnalytics();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleDownload = async (documentHash) => {
    try {
      const response = await apiFetch(
        `/api/documents/${encodeURIComponent(documentHash)}/download`
      );

      if (!response.ok) {
        throw new Error("Unable to download document");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "document";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message);
    }
  };

  const handlePreview = async (documentHash) => {
    try {
      const response = await apiFetch(
        `/api/documents/${encodeURIComponent(documentHash)}/preview`
      );

      if (!response.ok) {
        throw new Error("Unable to preview document");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (error) {
      alert(error.message);
    }
  };

function generateChatTitle(question) {
  const cleaned = question
    .replace(/[?!.,]/g, "")
    .trim();

  const words = cleaned.split(/\s+/).slice(0, 7);

  return words
    .map((word) =>
      word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

  // Send question to RAG backend

const stopGenerating = () => {
  if (chatAbortControllerRef.current) {
    chatAbortControllerRef.current.abort();
  }
};

const retryFailedQuestion = () => {
  if (!failedQuestion.trim() || chatLoading) return;

  const question = failedQuestion;

  setFailedQuestion("");
  setChatError("");

  submitChatQuestion(question);
};

async function handleChat(event) {
  if (event) event.preventDefault();

  const question = chatQuestion.trim();

  if (!question || chatLoading) return;

  setChatQuestion("");
  await submitChatQuestion(question);
}

async function submitChatQuestion(question) {
  if (!question?.trim() || chatLoading) return;

  setChatLoading(true);
  setChatError("");
  setFailedQuestion("");

  let controller = null;

  try {
    let conversationId = currentConversationId;

    // Create a conversation if this is a new chat
    if (!conversationId) {
      const createResponse = await apiFetch(
        "/api/chat/conversations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: generateChatTitle(question),
          }),
        }
      );

      const created = await createResponse.json();

      if (!createResponse.ok) {
        throw new Error(
          created.detail || "Could not create conversation"
        );
      }

      conversationId = created.conversation.id;
      setCurrentConversationId(conversationId);
      await fetchConversations();
    }

    // Display the user's question
    setChatMessages((previous) => [
      ...previous,
      { role: "user", content: question },
    ]);

    // Save the user's question
    const saveUserResponse = await apiFetch(
      `/api/chat/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "user",
          content: question,
        }),
      }
    );

    const savedUser = await saveUserResponse.json();

    if (!saveUserResponse.ok) {
      throw new Error(
        savedUser.detail || "Could not save your question"
      );
    }

    setChatMessages((previous) =>
      previous.map((message, index) =>
        index === previous.length - 1
          ? { ...message, id: savedUser.data.id }
          : message
      )
    );

    // Start cancellable AI request
    controller = new AbortController();
    chatAbortControllerRef.current = controller;

    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        limit: 5,
        history: chatMessages
          .slice(-8)
          .map((message) => ({
            role: message.role,
            content: message.content,
          })),
      }),
      signal: controller.signal,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || "Chat request failed");
    }

    const answer =
      result.answer ||
      result.response ||
      result.message ||
      result.result ||
      "No answer returned.";

    const answerText =
      typeof answer === "string"
        ? answer
        : JSON.stringify(answer, null, 2);

    const sources = Array.isArray(result.sources)
      ? result.sources
      : [];

    // Save the AI response
    const saveAssistantResponse = await apiFetch(
      `/api/chat/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "assistant",
          content: answerText,
          sources,
        }),
      }
    );

    const savedAssistant = await saveAssistantResponse.json();

    if (!saveAssistantResponse.ok) {
      throw new Error(
        savedAssistant.detail ||
        "Could not save the AI response"
      );
    }

    // Display answer and citations
    setChatMessages((previous) => [
      ...previous,
      {
        role: "assistant",
        content: answerText,
        sources,
        question,
        id: savedAssistant.data.id,
      },
    ]);

    await fetchConversations();

  } catch (err) {
    if (err.name === "AbortError") {
      setChatError("Generation stopped.");
    } else {
      console.error("Chat error:", err);
      setChatError(
        err.message || "Unable to get an answer. Please try again."
      );

      setFailedQuestion(question);
    }
  } finally {
    if (chatAbortControllerRef.current === controller) {
      chatAbortControllerRef.current = null;
    }

    setChatLoading(false);
  }
}


  // Search indexed documents using the FastAPI /search endpoint
  async function handleSearch(event) {
    event.preventDefault();

    const query = searchQuery.trim();
    if (!query || searchLoading) return;

    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);
    setSearchedQuery(query);

    try {
      const response = await apiFetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 5 }),
      });

      const data = await response.json();
      if (!response.ok) {
        const detail = typeof data.detail === "string" ? data.detail : "Search request failed.";
        throw new Error(detail);
      }

      setSearchResults(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setSearchError(err.message || "Unable to search documents.");
    } finally {
      setSearchLoading(false);
    }
  }

  // Navigation items
  const navigation = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Documents", icon: Files },
    { name: "AI Chat", icon: MessageSquare },
    { name: "Search", icon: Search }
  ];

  const totalStorageBytes = documents.reduce(
    (total, doc) => total + (Number(doc.file_size_bytes) || 0),
    0
  );

  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1
    );

    return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
  };

  const fileTypeCounts = documents.reduce((counts, doc) => {
    const type = (doc.file_type || "unknown").toLowerCase();
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});

  const recentDocuments = [...documents]
    .sort(
      (a, b) =>
        new Date(b.uploaded_at || 0) -
        new Date(a.uploaded_at || 0)
    )
    .slice(0, 5);

  // Live dashboard statistics
  const stats = [
    {
      title: "Total Documents",
      value: loading ? "..." : analytics?.total_documents ?? 0,
      icon: Files,
      change: "Indexed documents"
    },
    {
      title: "Total Chunks",
      value: loading ? "..." : analytics?.total_chunks ?? 0,
      icon: Layers,
      change: "Processed chunks"
    },
    {
      title: "Vector Embeddings",
      value: loading ? "..." : analytics?.total_vectors ?? 0,
      icon: Database,
      change: "384 dimensions"
    },
    {
      title: "Storage Used",
      value: loading ? "..." : formatBytes(totalStorageBytes),
      icon: HardDrive,
      change: "Uploaded documents"
    },
    {
      title: "AI Model",
      value: "Qwen",
      icon: Bot,
      change: "Local language model"
    }
  ];

 
const filteredDocuments = [...documents]
  .filter((doc) =>
    doc.filename.toLowerCase().includes(documentSearch.toLowerCase())
  )
  .filter((doc) =>
    documentTypeFilter === "all"
      ? true
      : doc.file_type?.toLowerCase() === documentTypeFilter
  )
  .sort((a, b) => {
    switch (documentSort) {
      case "oldest":
        return (a.uploaded_at || 0) - (b.uploaded_at || 0);

      case "name":
        return a.filename.localeCompare(b.filename);

      case "largest":
        return (b.file_size_bytes || 0) - (a.file_size_bytes || 0);

      case "newest":
      default:
        return (b.uploaded_at || 0) - (a.uploaded_at || 0);
    }
  });
  function getFileType(filename) {
    return filename.split(".").pop()?.toUpperCase() || "FILE";
  }
  function formatFileSize(bytes) {
  if (bytes == null) return "Unavailable";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUploadDate(timestamp) {
  if (!timestamp) return "Unavailable";

  const date =
    typeof timestamp === "number"
      ? new Date(timestamp * 1000)
      : new Date(timestamp);

  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleString();
}

function formatChatDate(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const filteredConversations = conversations.filter((conversation) =>
  conversation.title
    .toLowerCase()
    .includes(chatHistorySearch.toLowerCase())
);

  // Render only after all hooks have been called on every render.
  if (checkingSession) {
  return (
    <div className="auth-page">
      <p>Checking your session...</p>
    </div>
  );
}

if (authView === "landing") {
  return (
    <LandingPage
      onEnter={() => setAuthView("login")}
    />
  );
}

if (authView === "login" || authView === "register") {
  return (
    <AuthPage
      onSuccess={handleLoginSuccess}
      onBack={() => setAuthView("landing")}
    />
  );
}

if (!currentUser) {
  return null;
}
  return (
    <div className="app-layout">

      {/* SIDEBAR */}
      <aside className="sidebar">

        <div className="brand">
          <div className="brand-icon">
            <Bot size={23} />
          </div>

          <div>
            <h2>RAG Studio</h2>
            <span>AI Knowledge Platform</span>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav>
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.name}
                className={`nav-item ${
                  activePage === item.name ? "active" : ""
                }`}
                onClick={() => setActivePage(item.name)}
              >
                <Icon size={19} />
                {item.name}
              </button>
            );
          })}
        </nav>

        <div className="nav-label system-label">SYSTEM</div>

        <button className="nav-item">
          <Settings size={19} />
          Settings
        </button>

        <div className="sidebar-bottom">
          <div className="status-dot"></div>

          <div>
            <strong>RAG Studio</strong>
            <span>Knowledge platform</span>
          </div>
        </div>

      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">

        {/* TOP BAR */}
        <header className="topbar">

          <div>
            <span className="breadcrumb">Workspace /</span>
            <strong>{activePage}</strong>
          </div>

          <div className="topbar-right">
            <span className="online-status">
              <span />
              {error ? "Backend unavailable" : "API connection"}
            </span>

           <div className="topbar-user">
  <div className="avatar">
    {currentUser.username?.slice(0, 2).toUpperCase() || "RS"}
  </div>

  <span>{currentUser.username}</span>

  <button
    className="text-button"
    onClick={handleLogout}
  >
    Logout
  </button>
</div>
          </div>

        </header>

        <section className="page-content">

          {/* DASHBOARD PAGE */}
          {activePage === "Dashboard" && (
            <>
              <div
                className={`upload-drop-zone ${isDragging ? "drag-active" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
              >
                <div className="welcome-row">
                  <div>
                    <div className="eyebrow">YOUR AI WORKSPACE</div>

                    <h1>Welcome to RAG Studio</h1>

                    <p>
                      Manage your knowledge base and explore your
                      AI-powered documents.
                    </p>
                  </div>

                  <div className="upload-controls">
                    <label
                      className="file-input-label"
                      htmlFor="document-upload"
                    >
                      <Upload size={17} />
                      Choose file
                    </label>

                    <input
                      id="document-upload"
                      type="file"
                      accept=".txt,.pdf,.docx"
                      disabled={uploading}
                      onChange={(event) => {
                        setSelectedFile(event.target.files?.[0] || null);
                        setUploadMessage("");
                      }}
                    />

                    <button
                      className="primary-button"
                      type="button"
                      onClick={handleUpload}
                      disabled={uploading || !selectedFile}
                    >
                      <Plus size={18} />
                      {uploading ? "Uploading..." : "Upload document"}
                    </button>
                  </div>
                </div>

                <div className="drop-hint">
                  <Upload size={16} />
                  Drag and drop a document here, or choose a file
                  <span>TXT, PDF, DOCX · Maximum 10 MB</span>
                </div>

                {selectedFile && (
                  <p className="selected-file">
                    Selected: {selectedFile.name}
                    {" · "}
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                )}

                {uploading && (
                  <div className="upload-progress-section">
                    <div className="upload-progress-heading">
                      <span>Uploading document...</span>
                      <strong>{uploadProgress}%</strong>
                    </div>

                    <div
                      className="upload-progress-track"
                      role="progressbar"
                      aria-valuenow={uploadProgress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="upload-progress-fill"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {uploadMessage && (
                  <div
                    className="upload-message"
                    role="status"
                  >
                    {uploadMessage}
                  </div>
                )}
              </div>

              {error && (
                <div className="error-message">
                  <AlertCircle size={18} />
                  Unable to load analytics: {error}

                  <button onClick={fetchAnalytics}>
                    Retry
                  </button>
                </div>
              )}

              {/* STATISTICS */}
              <div className="stats-grid">

                {stats.map((stat) => {
                  const Icon = stat.icon;

                  return (
                    <div className="stat-card" key={stat.title}>

                      <div className="stat-top">
                        <span>{stat.title}</span>

                        <div className="stat-icon">
                          <Icon size={19} />
                        </div>
                      </div>

                      <h2>{stat.value}</h2>

                      <span className="stat-description">
                        {stat.change}
                      </span>

                    </div>
                  );
                })}

              </div>

              <div className="dashboard-details-grid">

                <section className="dashboard-panel">
                  <h3>Document Types</h3>
                  <p className="panel-subtitle">
                    Distribution of uploaded documents
                  </p>

                  {Object.keys(fileTypeCounts).length === 0 ? (
                    <p>No documents uploaded yet.</p>
                  ) : (
                    Object.entries(fileTypeCounts).map(([type, count]) => {
                      const percentage =
                        documents.length > 0
                          ? (count / documents.length) * 100
                          : 0;

                      return (
                        <div className="file-type-row" key={type}>
                          <div className="file-type-heading">
                            <span>{type.toUpperCase()}</span>
                            <strong>{count}</strong>
                          </div>

                          <div className="file-type-track">
                            <div
                              className="file-type-fill"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </section>

                <section className="dashboard-panel">
                  <h3>Recent Uploads</h3>
                  <p className="panel-subtitle">
                    Your five latest documents
                  </p>

                  {recentDocuments.length === 0 ? (
                    <p>No recent uploads.</p>
                  ) : (
                    recentDocuments.map((doc, index) => (
                      <div
                        className="recent-document-row"
                        key={doc.document_hash || `${doc.filename}-${index}`}
                      >
                        <FileText size={18} />

                        <div className="recent-document-info">
                          <strong>{doc.filename}</strong>
                          <span>
                            {formatBytes(Number(doc.file_size_bytes) || 0)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </section>

              </div>

              {/* DASHBOARD PANELS */}
              <div className="dashboard-panels">

                {/* RECENT DOCUMENTS */}
                <section className="panel documents-panel">

                  <div className="panel-heading">
                    <div>
                      <h3>Recent documents</h3>
                      <p>Your latest indexed documents</p>
                    </div>

                    <button
                      className="text-button"
                      onClick={() => setActivePage("Documents")}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>

                  <div className="document-toolbar">
                    <input
                      type="search"
                      placeholder="Search documents..."
                      value={documentSearch}
                      onChange={(event) => setDocumentSearch(event.target.value)}
                    />

                    <select
                      value={documentTypeFilter}
                      onChange={(event) => setDocumentTypeFilter(event.target.value)}
                    >
                      <option value="all">All file types</option>
                      <option value="pdf">PDF</option>
                      <option value="txt">TXT</option>
                      <option value="docx">DOCX</option>
                    </select>

                    <select
                      value={documentSort}
                      onChange={(event) => setDocumentSort(event.target.value)}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="name">Name A–Z</option>
                      <option value="largest">Largest first</option>
                    </select>
                  </div>

                  <p className="document-results-count">
                    Showing {Math.min(filteredDocuments.length, 3)} of {filteredDocuments.length} matching documents
                  </p>

                  <div className="document-list">
                    {loading ? (
                      <p>Loading documents...</p>
                    ) : filteredDocuments.length === 0 ? (
                      <p>No documents found. Upload your first document.</p>
                    ) : (
                      filteredDocuments.slice(0, 3).map((doc) => (
                        <div
                          className="document-row"
                          key={`${doc.document_hash || doc.filename}-${doc.filename}`}
                        >
                          <div className="document-icon">
                            <FileText size={22} />
                          </div>

                          <div className="document-info">
                            <strong>{doc.filename}</strong>
                            <span>
                              {(doc.file_type || getFileType(doc.filename)).toUpperCase()} document
                            </span>
                          </div>

                          <div className="document-actions">
                            <span className="chunk-count">
                              {doc.chunks} chunks
                            </span>

                            <button
                              className="preview-document-button"
                              disabled={!doc.document_hash}
                              onClick={() => handlePreview(doc.document_hash)}
                              title="Preview document"
                            >
                              <FileText size={15} />
                              Preview
                            </button>

                            <button
                              className="download-document-button"
                              disabled={!doc.document_hash}
                              onClick={() => handleDownload(doc.document_hash)}
                              title="Download original document"
                            >
                              <Download size={15} />
                              Download
                            </button>

                            <button
                              className="delete-document-button"
                              disabled={!doc.document_hash}
                              onClick={() => handleDeleteDocument(doc.document_hash)}
                              title="Delete document"
                            >
                              <Trash2 size={15} />
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* PLATFORM STATUS — UNDER DOCUMENTS */}
                <section className="panel activity-panel">

                  <div className="panel-heading">
                    <div>
                      <h3>Platform status</h3>
                      <p>Infrastructure overview</p>
                    </div>

                    <Activity size={19} className="activity-icon" />
                  </div>

                  <div className="service-grid">
                    {[
                      ["FastAPI", "Backend API"],
                      ["Qdrant", "Vector database"],
                      ["Ollama", "AI generation"],
                      ["Sentence Transformers", "Embedding engine"]
                    ].map(([name, description]) => (
                      <div className="service-row" key={name}>
                        <div>
                          <strong>{name}</strong>
                          <span>{description}</span>
                        </div>

                        <span className="service-status">
                          <CheckCircle2 size={14} />
                          Configured
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="model-card">
                    <Zap size={19} />
                    <div>
                      <strong>Qwen 3.5 · 4B</strong>
                      <span>Local language model</span>
                    </div>
                  </div>
                </section>
              </div>

              {/* QUICK ACTIONS */}
              <section className="quick-actions">

                <div>
                  <h3>Explore your knowledge base</h3>

                  <p>
                    Ask questions or search through your indexed documents.
                  </p>
                </div>

                <button onClick={() => setActivePage("AI Chat")}>
                  <MessageSquare size={17} />
                  Start AI chat
                </button>

                <button
                  className="secondary-action"
                  onClick={() => setActivePage("Search")}
                >
                  <Search size={17} />
                  Search documents
                </button>

                <button
                  className="secondary-action"
                  onClick={fetchAnalytics}
                  disabled={loading}
                >
                  <RefreshCw size={17} />
                  {loading ? "Refreshing..." : "Refresh data"}
                </button>

              </section>
            </>
          )}

          {/* DOCUMENTS PAGE */}
          {activePage === "Documents" && (
            <section className="panel documents-page">

              <div className="panel-heading">
                <div>
                  <h3>Document Library</h3>
                  <p>
                    Manage your uploaded and indexed documents
                  </p>
                </div>

                <button
                  className="text-button"
                  onClick={fetchAnalytics}
                  disabled={loading}
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>

              {/* Document statistics */}
              <div className="library-summary">
                <div>
                  <strong>{documents.length}</strong>
                  <span>Total documents</span>
                </div>

                <div>
                  <strong>
                    {documents.reduce(
                      (total, doc) => total + (Number(doc.chunks) || 0),
                      0
                    )}
                  </strong>
                  <span>Indexed chunks</span>
                </div>

                <div>
                  <strong>{formatBytes(totalStorageBytes)}</strong>
                  <span>Storage used</span>
                </div>
              </div>

              {/* Search and filters */}
              <div className="document-toolbar library-toolbar">

                <input
                  type="search"
                  placeholder="Search by document name..."
                  value={documentSearch}
                  onChange={(event) =>
                    setDocumentSearch(event.target.value)
                  }
                />

                <select
                  value={documentTypeFilter}
                  onChange={(event) =>
                    setDocumentTypeFilter(event.target.value)
                  }
                >
                  <option value="all">All file types</option>
                  <option value="pdf">PDF</option>
                  <option value="txt">TXT</option>
                  <option value="docx">DOCX</option>
                </select>

                <select
                  value={documentSort}
                  onChange={(event) =>
                    setDocumentSort(event.target.value)
                  }
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name">Name A–Z</option>
                  <option value="largest">Largest first</option>
                </select>

              </div>

              <div className="library-results-heading">
                <strong>All Documents</strong>

                <span>
                  {filteredDocuments.length} matching documents
                </span>
              </div>

              {/* Document list */}
              <div className="document-list">

                {loading ? (
                  <p className="library-empty">
                    Loading documents...
                  </p>
                ) : filteredDocuments.length === 0 ? (
                  <div className="library-empty">
                    <FileText size={32} />
                    <h3>No documents found</h3>
                    <p>
                      Try another search or upload a new document.
                    </p>
                  </div>
                ) : (
                  filteredDocuments.map((doc, index) => {
                    const fileType = (
                      doc.file_type || getFileType(doc.filename)
                    ).toLowerCase();

                    return (
                      <div
                        className="document-row library-document-row"
                        key={
                          doc.document_hash ||
                          `${doc.filename}-${index}`
                        }
                      >

                        <div className={`document-icon file-${fileType}`}>
                        <FileText size={22} />
                        </div>

                        <div className="document-info">

                          <strong>{doc.filename}</strong>

                          <span className="file-type-badge">
                            {fileType.toUpperCase()}
                          </span>

                          <div className="document-metadata">

                            <span>
                              <Database size={14} />
                              {formatFileSize(doc.file_size_bytes)}
                            </span>

                            <span>
                              <Layers size={14} />
                              {doc.chunks || 0} chunks
                            </span>

                            <span>
                              <Activity size={14} />
                              {formatUploadDate(doc.uploaded_at)}
                            </span>

                          </div>
                        </div>

                        <div className="document-actions">

                          <button
                            className="preview-document-button"
                            disabled={!doc.document_hash}
                            onClick={() =>
                              handlePreview(doc.document_hash)
                            }
                            title="Preview document"
                          >
                            <FileText size={15} />
                            Preview
                          </button>

                          <button
                            className="download-document-button"
                            disabled={!doc.document_hash}
                            onClick={() =>
                              handleDownload(doc.document_hash)
                            }
                            title="Download document"
                          >
                            <Download size={15} />
                            Download
                          </button>

                          <button
                            className="delete-document-button"
                            disabled={!doc.document_hash}
                            onClick={() =>
                              handleDeleteDocument(doc.document_hash)
                            }
                            title="Delete document"
                          >
                            <Trash2 size={15} />
                            Delete
                          </button>

                        </div>

                      </div>
                    );
                  })
                )}

              </div>
            </section>
          )}

          {/* AI CHAT PAGE */}
          {activePage === "AI Chat" && (
            <section className="panel chat-panel">

<aside className="chat-history-sidebar">
  <div className="chat-history-heading">
    <h3>Chat History</h3>

    <button
      type="button"
      className="new-chat-button"
      onClick={startNewChat}
    >
      <Plus size={16} />
      New Chat
    </button>
  </div>

  <input
    type="search"
    className="chat-history-search"
    placeholder="Search conversations..."
    value={chatHistorySearch}
    onChange={(event) => setChatHistorySearch(event.target.value)}
  />

  {historyLoading ? (
    <p>Loading conversations...</p>
  ) : filteredConversations.length === 0 ? (
    <p className="chat-history-empty">
      {chatHistorySearch
        ? "No matching conversations found"
        : "No previous conversations"}
    </p>
  ) : (
    <div className="chat-history-list">
      {filteredConversations.map((conversation) => (
        <div className="chat-history-row" key={conversation.id}>
          <button
            type="button"
            className={`chat-history-item ${
              currentConversationId === conversation.id ? "active" : ""
            }`}
            onClick={() => openConversation(conversation.id)}
          >
            <MessageSquare size={16} />
            <div className="chat-history-details">
              <span>{conversation.title}</span>
              <small>{formatChatDate(conversation.updated_at)}</small>
            </div>
          </button>

          <button
            type="button"
            className="export-chat-button"
            title="Export conversation"
            onClick={() => {
              if (currentConversationId === conversation.id) {
                exportConversation(conversation);
              } else {
                openConversation(conversation.id);
              }
            }}
          >
            <Download size={15} />
          </button>

          <button
            type="button"
            className="rename-chat-button"
            title="Rename conversation"
            onClick={() => handleRenameConversation(conversation)}
          >
            <Settings size={15} />
          </button>

          <button
            type="button"
            className="delete-chat-button"
            title="Delete conversation"
            onClick={() => handleDeleteConversation(conversation.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  )}
</aside>

              <div className="panel-heading">
                <div>
                  <h3>AI Chat</h3>
                  <p>Ask questions about your indexed documents.</p>
                </div>
                <MessageSquare size={24} />
              </div>

              <div className="chat-messages">
                {chatMessages.length === 0 ? (
                  <div className="chat-empty">
                    <Bot size={34} />
                    <h3>Ask your documents</h3>
                    <p>Your answers will be grounded in your knowledge base.</p>
                  </div>
                ) : (
                  chatMessages.map((message, index) => (
                    <div
                      className={`chat-message ${message.role}`}
                      key={`${message.role}-${index}`}
                    >
                      <strong>
                        {message.role === "user" ? "You" : "RAG Assistant"}
                      </strong>
                      <div className="chat-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      {message.role === "user" && (
                        <button
                          type="button"
                          className="edit-question-button"
                          onClick={() => startEditingMessage(index, message.content)}
                        >
                          <Settings size={15} />
                          Edit question
                        </button>
                      )}
                      {editingMessageIndex === index && (
                        <div className="edit-question-area">
                          <textarea
                            value={editedQuestion}
                            onChange={(event) => setEditedQuestion(event.target.value)}
                            rows={3}
                          />

                          <button
                            type="button"
                            onClick={() => handleEditAndResend(index)}
                            disabled={chatLoading || !editedQuestion.trim()}
                          >
                            Save edit
                          </button>

                          <button
                            type="button"
                            onClick={() => setEditingMessageIndex(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {message.role === "assistant" && (
                        <button
                          type="button"
                          className="copy-response-button"
                          onClick={() => handleCopyResponse(message.content)}
                        >
                          <Copy size={15} />
                          Copy response
                        </button>
                      )}
                      {message.role === "assistant" && (
                        <button
                          type="button"
                          className="regenerate-response-button"
                          onClick={() => handleRegenerate(index)}
                          disabled={chatLoading}
                        >
                          <RefreshCw size={15} />
                          Regenerate
                        </button>
                      )}
                      {message.sources?.length > 0 && (
                        <div className="chat-sources">
                          <strong>
                            Sources ({message.sources.length})
                          </strong>
                          {message.sources.map((source, sourceIndex) => (
                            <button
                              type="button"
                              className="chat-source-link"
                              key={`${source.document_hash || source.filename}-${source.chunk_index ?? sourceIndex}`}
                              onClick={() => {
                                if (source.document_hash) {
                                  handlePreview(source.document_hash);
                                }
                              }}
                              disabled={!source.document_hash}
                              title={
                                source.document_hash
                                  ? "Open source document"
                                  : "Document preview unavailable"
                              }
                            >
                              <FileText size={14} />

                              <span>
                                {source.filename || "Unknown document"}
                                {source.chunk_index != null &&
                                  ` · Chunk ${source.chunk_index}`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}

                {chatError && (
                  <div className="chat-error-box">
                    <p>{chatError}</p>

                    {failedQuestion && (
                      <button
                        type="button"
                        className="retry-chat-button"
                        onClick={retryFailedQuestion}
                        disabled={chatLoading}
                      >
                        <RefreshCw size={15} />
                        Retry answer
                      </button>
                    )}
                  </div>
                )}

                {chatLoading && (
                  <div className="chat-message assistant-message typing-message">
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                      <p>AI is thinking...</p>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form
                className="chat-input-area"
                onSubmit={handleChat}
              >

                <input
                  type="text"
                  placeholder="Ask something about your documents..."
                  value={chatQuestion}
                  onChange={(event) =>
                    setChatQuestion(event.target.value)
                  }
                  disabled={chatLoading}
                />

                {chatLoading ? (
                  <button
                    type="button"
                    className="stop-generating-button"
                    onClick={stopGenerating}
                  >
                    Stop generating
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                  >
                    Send
                  </button>
                )}

              </form>

              <button
                className="text-button"
                onClick={() => {
                  setChatMessages([]);
                  setChatError("");
                }}
                disabled={chatLoading || chatMessages.length === 0}
              >
                <Trash2 size={15} />
                Clear chat
              </button>
            </section>
          )}

          {/* SEMANTIC SEARCH PAGE */}
          {activePage === "Search" && (
            <section className="panel search-page">
              <div className="panel-heading">
                <div>
                  <h3>Semantic Search</h3>
                  <p>Find relevant information across your indexed documents.</p>
                </div>
                <Search size={24} />
              </div>

              <form className="semantic-search-form" onSubmit={handleSearch}>
                <input
                  type="search"
                  placeholder="Search your documents..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-label="Search indexed documents"
                />
                <button
                  type="submit"
                  className="primary-button"
                  disabled={searchLoading || !searchQuery.trim()}
                >
                  <Search size={17} />
                  {searchLoading ? "Searching..." : "Search"}
                </button>
              </form>

              {searchError && (
                <div className="error-message">
                  <AlertCircle size={17} />
                  {searchError}
                </div>
              )}

              {searchLoading && (
                <p className="search-status">Searching your knowledge base...</p>
              )}

              {!searchLoading && searchedQuery && !searchError && (
                <div className="search-results-heading">
                  <h3>Search Results</h3>
                  <p>Found {searchResults.length} matching chunks for “{searchedQuery}”.</p>
                </div>
              )}

              {!searchLoading && searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((result, index) => (
                    <article
                      className="search-result-card"
                      key={`${result.document_hash || result.filename}-${result.chunk_index ?? index}`}
                    >
                      <div className="result-top">
                        <div>
                          <h4>{result.filename || "Unknown document"}</h4>
                          <span className="file-type">
                            {(result.file_type || "document").toUpperCase()} · Chunk {result.chunk_index ?? 0}
                          </span>
                        </div>
                        {Number.isFinite(Number(result.score)) && (
                          <span className="similarity-score">
                            {(Number(result.score) * 100).toFixed(1)}% match
                          </span>
                        )}
                      </div>
                      <p className="result-text">{result.text || "No text was returned for this result."}</p>
                    </article>
                  ))}
                </div>
              )}

              {!searchLoading && searchedQuery && !searchError && searchResults.length === 0 && (
                <p className="search-status">No matching documents found. Try different keywords.</p>
              )}

              <button
                type="button"
                className="text-button"
                onClick={() => setActivePage("AI Chat")}
              >
                <MessageSquare size={17} />
                Ask AI instead
              </button>
            </section>
          )}

          {/* FOOTER */}
          <footer>
            RAG Studio <span>·</span> Built with React, FastAPI, Qdrant and Ollama
          </footer>

        </section>

      </main>

    </div>
  );
}

export default App;
