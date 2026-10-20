import { useState } from "react";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile
} from "firebase/auth";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { auth } from "./firebase";

function getAuthErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email. Try signing in instead.",
    "auth/invalid-credential": "The email or password is incorrect. Please try again.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/network-request-failed": "A network error interrupted sign-in. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts were made. Wait a little while, then try again.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/user-disabled": "This account has been disabled. Contact support.",
    "auth/user-not-found": "No account was found for this email.",
    "auth/wrong-password": "The email or password is incorrect. Please try again.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups and try again.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/unauthorized-domain": "This domain is not authorized for Firebase sign-in. Add it in Firebase Console."
  };
  return messages[error.code] || "Authentication failed. Check your connection and try again.";
}

export default function AuthScreen() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isRegistering && !name.trim()) {
      setError("Enter your name to create an account.");
      return;
    }
    if (password.length < 6) {
      setError("Your password must contain at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      await setPersistence(auth, browserLocalPersistence);
      if (isRegistering) {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (authError) {
      setError(`Firebase Authentication error: ${getAuthErrorMessage(authError)}`);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setError("");
    setBusy(true);
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (authError) {
      setError(`Firebase Authentication error: ${getAuthErrorMessage(authError)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-heading">
        <a className="brand auth-brand" href="/" aria-label="AlgoPath DSA Tracker">
          <span className="brand-mark"><LockKeyhole size={20} /></span>
          <span>algo<span className="brand-accent">path</span><small>DSA WORKSPACE</small></span>
        </a>
        <div className="auth-intro">
          <div className="eyebrow"><span className="eyebrow-line" /> YOUR DSA JOURNEY</div>
          <h1 id="auth-heading">{isRegistering ? "Create your account." : "Welcome back."}</h1>
          <p>Sign in to keep your DSA progress safely synced across devices.</p>
        </div>

        <button className="google-sign-in" type="button" onClick={signInWithGoogle} disabled={busy}>
          <span className="google-g" aria-hidden="true">G</span>
          Continue with Google
        </button>
        <div className="auth-divider"><span>or use your email</span></div>

        <form className="auth-form" onSubmit={submit}>
          {isRegistering && <label className="auth-field">
            <span>Your name</span>
            <span className="auth-input-wrap"><UserRound size={16} /><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></span>
          </label>}
          <label className="auth-field">
            <span>Email address</span>
            <span className="auth-input-wrap"><Mail size={16} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span>
          </label>
          <label className="auth-field">
            <span>Password</span>
            <span className="auth-input-wrap"><LockKeyhole size={16} /><input type={showPassword ? "text" : "password"} autoComplete={isRegistering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? <><LoaderCircle size={16} className="auth-spinner" /> Please wait…</> : isRegistering ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="auth-switch">
          {isRegistering ? "Already have an account?" : "New to AlgoPath?"}
          <button type="button" onClick={() => { setError(""); setIsRegistering((registering) => !registering); }}>
            {isRegistering ? "Sign in" : "Create an account"}
          </button>
        </p>
      </section>
    </main>
  );
}
