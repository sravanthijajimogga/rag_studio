import React, { useState } from "react";
import { loginUser, registerUser } from "./auth";
import { Layers3, ArrowRight, Eye, EyeOff } from "lucide-react";
import "./AuthPage.css";

export default function AuthPage({ onSuccess, onBack }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "register") {
        await registerUser({ username, email, password });
        setMessage("Account created! You can now log in.");
        setMode("login");
        setPassword("");
      } else {
        const result = await loginUser({ email, password });
        onSuccess(result.user);
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <button className="auth-brand" onClick={onBack}>
          <span><Layers3 size={22} /></span>
          RAG Studio
        </button>

        <div className="auth-heading">
          <span className="auth-eyebrow">YOUR KNOWLEDGE WORKSPACE</span>
          <h1>
            {mode === "login" ? "Welcome back." : "Create your account."}
          </h1>
          <p>
            {mode === "login"
              ? "Sign in to access your knowledge workspace."
              : "Start building your searchable knowledge base."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "register" && (
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                minLength={3}
                maxLength={50}
                required
              />
            </label>
          )}

          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            Password
            <div className="auth-password">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={mode === "register" ? 8 : undefined}
                maxLength={128}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-success">{message}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Sign in"
                : "Create account"}
            <ArrowRight size={17} />
          </button>
        </form>

        <div className="auth-switch">
          {mode === "login" ? (
            <>
              Don't have an account?
              <button onClick={() => {
                setMode("register");
                setError("");
                setMessage("");
              }}>
                Create account
              </button>
            </>
          ) : (
            <>
              Already registered?
              <button onClick={() => {
                setMode("login");
                setError("");
                setMessage("");
              }}>
                Sign in
              </button>
            </>
          )}
        </div>

        <button className="auth-back" onClick={onBack}>
          Back to home
        </button>
      </section>
    </main>
  );
}