import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Fingerprint,
  ShieldCheck,
  KeyRound,
  ArrowRight,
  LogOut,
  Trophy,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { HandDrawnFilter } from '../../components/HandDrawnFilter';
import { WobblyCard } from '../../components/WobblyCard';
import { WobblyButton } from '../../components/WobblyButton';
import {
  checkStaffPasskeySession,
  registerStaffPasskey,
  signInWithStaffPasskey,
  signOutStaff,
} from './supabase';

interface PasskeyAuthGateProps {
  children: React.ReactNode;
  pageTitle?: string;
  hideSessionIndicator?: boolean;
}

export function PasskeyAuthGate({ children, pageTitle, hideSessionIndicator = false }: PasskeyAuthGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [registerEmail, setRegisterEmail] = useState('staff@kosen.local');
  const [enrollmentSecret, setEnrollmentSecret] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);

  // Check Supabase Auth session on mount
  useEffect(() => {
    let mounted = true;
    checkStaffPasskeySession().then((info) => {
      if (!mounted) return;
      setIsAuthenticated(info.isAuthenticated);
      setUserEmail(info.email);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSignInWithPasskey = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const res = await signInWithStaffPasskey();
      if (res.success) {
        setIsAuthenticated(true);
        setUserEmail(res.user?.email || 'staff@kosen.local');
      } else {
        setAuthError(res.error || 'パスキー認証に失敗しました。');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleRegisterPasskey = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!enrollmentSecret.trim()) {
      setAuthError('スタッフ登録用シークレットキーを入力してください。部外者は登録できません。');
      return;
    }
    setIsAuthenticating(true);
    setAuthError(null);
    setRegisterSuccess(null);
    try {
      const res = await registerStaffPasskey(registerEmail.trim(), enrollmentSecret.trim());
      if (res.success) {
        setRegisterSuccess('パスキーの登録が完了しました！次回到来時も生体認証だけで解錠できます。');
        setShowRegister(false);
        setEnrollmentSecret('');
        // Automatically sign in or re-check
        const check = await checkStaffPasskeySession();
        if (check.isAuthenticated) {
          setIsAuthenticated(true);
          setUserEmail(check.email);
        }
      } else {
        setAuthError(res.error || 'パスキーの登録に失敗しました。');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    await signOutStaff();
    setIsAuthenticated(false);
    setUserEmail(null);
  };

  // While checking initial session
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center p-6">
        <HandDrawnFilter />
        <div className="w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-bold text-sm">パスキー認証状態を確認しています...</p>
      </div>
    );
  }

  // If authenticated, render protected page content with a small persistent staff badge
  if (isAuthenticated) {
    return (
      <div className="relative min-h-screen">
        {/* Floating Staff Session Indicator */}
        {!hideSessionIndicator && <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2 bg-[var(--card)]/90 backdrop-blur-md px-3 py-1.5 rounded-full border-2 border-[var(--stroke)] shadow-md text-[11px] font-bold">
          <span className="w-2 h-2 rounded-full bg-[var(--warm-success)] animate-pulse" />
          <span>🔐 パスキー認証済み ({userEmail || 'スタッフ'})</span>
          <button
            onClick={handleSignOut}
            className="ml-1 opacity-70 hover:opacity-100 hover:text-[var(--warm-error)] cursor-pointer"
            title="パスキーセッションをログアウト"
          >
            <LogOut size={12} />
          </button>
        </div>}
        {children}
      </div>
    );
  }

  // Not authenticated: Display dedicated Passkey Lock Screen
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center p-4 sm:p-8 font-sans select-none">
      <HandDrawnFilter />

      <WobblyCard className="max-w-md w-full p-6 sm:p-8 space-y-6 text-center animate-in zoom-in-95">
        <div className="inline-flex p-4 rounded-3xl bg-[var(--card)] border-2 border-[var(--stroke)] text-[var(--accent)] shadow-sm">
          <Fingerprint size={48} className="animate-pulse" />
        </div>

        <div className="space-y-1.5">
          <span className="px-3 py-1 rounded-full bg-[var(--warm-badge)] text-[11px] font-bold">
            高専祭 展示システム セキュリティ保護
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            パスキー（WebAuthn）認証
          </h1>
          <p className="text-xs opacity-75 leading-relaxed">
            この画面（{pageTitle || '体験ブース / 管理 / IDE'}
            ）はスタッフ専用です。パスワードではなく、生体認証（指紋・Face ID）またはセキュリティキーでロックを解除してください。
          </p>
        </div>

        {authError && (
          <div className="p-3 rounded-2xl bg-[var(--error-bg)] border border-[var(--warm-error)] text-xs text-[var(--warm-error)] font-bold flex items-center gap-2 text-left">
            <AlertCircle size={16} className="shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        {registerSuccess && (
          <div className="p-3 rounded-2xl bg-[#e8f5e9] border border-[var(--warm-success)] text-xs text-[var(--warm-success)] font-bold flex items-center gap-2 text-left">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{registerSuccess}</span>
          </div>
        )}

        {/* Primary Action: Sign in with Passkey */}
        <div className="space-y-3 pt-2">
          <WobblyButton
            variant="primary"
            size="lg"
            disabled={isAuthenticating}
            onClick={handleSignInWithPasskey}
            className="w-full py-4 text-base font-extrabold flex items-center justify-center gap-2.5 shadow-md"
          >
            <Fingerprint size={22} />
            <span>
              {isAuthenticating ? 'パスキー認証中...' : 'パスキーでロック解除'}
            </span>
          </WobblyButton>

          <p className="text-[11px] opacity-65">
            ※Supabase Auth サーバー側で暗号学的に署名が直接検証されます。
          </p>
        </div>

        {/* Accordion: First-time Staff Passkey Enrollment */}
        <div className="pt-3 border-t border-[var(--stroke)]/20 text-xs text-left">
          <button
            type="button"
            onClick={() => setShowRegister(!showRegister)}
            className="text-[var(--accent)] font-bold underline cursor-pointer flex items-center gap-1"
          >
            <KeyRound size={13} />
            <span>初めてこの端末を使う場合（パスキーを新規登録）</span>
          </button>

          {showRegister && (
            <div className="mt-3 p-3.5 rounded-2xl bg-[var(--card)] border border-[var(--stroke)]/40 space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-bold">
                  スタッフ端末の新規パスキー登録（初回のみ）
                </p>
                <p className="text-[11px] opacity-75 leading-relaxed">
                  部外者による不正登録を防止するため、スタッフ登録用シークレットが必要です。登録後はパスコード不要で Touch ID / Face ID だけで解錠できるようになります。
                </p>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold opacity-80">
                  スタッフ登録シークレットキー:
                </label>
                <input
                  type="password"
                  value={enrollmentSecret}
                  onChange={(e) => setEnrollmentSecret(e.target.value)}
                  placeholder="スタッフ用登録キーを入力..."
                  className="w-full px-3 py-1.5 rounded-xl border border-[var(--stroke)] bg-[var(--background)] text-xs font-mono"
                />
              </div>

              <WobblyButton
                type="button"
                variant="secondary"
                size="sm"
                disabled={isAuthenticating || !enrollmentSecret.trim()}
                onClick={handleRegisterPasskey}
                className="w-full py-2.5 font-bold flex items-center justify-center gap-2"
              >
                <Sparkles size={14} />
                <span>{isAuthenticating ? '登録処理中...' : 'この端末にスタッフパスキーを登録'}</span>
              </WobblyButton>
            </div>
          )}
        </div>

        {/* Exit link to public gallery */}
        <div className="pt-2 border-t border-[var(--stroke)]/20">
          <Link
            to="/gallery"
            className="text-xs font-bold text-[var(--accent)] flex items-center justify-center gap-1 hover:underline"
          >
            <Trophy size={14} />
            <span>みんなのゲーム公開ページへ（一般来場者はこちら）</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </WobblyCard>
    </div>
  );
}
