'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Shield, Menu, X, LogOut, Bell } from 'lucide-react';
import { ThemeSwitcher } from './theme-switcher';
import { NotificationDrawer } from './notification-drawer';

export function Header() {
  const { data: session, status } = useSession() || {};
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Poll unread count every 30s
  useEffect(() => {
    if (!session) return;
    const fetchCount = async () => {
      try {
        const r = await fetch('/api/notifications');
        if (r.ok) {
          const d = await r.json();
          setUnreadCount((d.notifications || []).length);
        }
      } catch { /* silent */ }
    };
    fetchCount();
    const t = setInterval(fetchCount, 30000);
    return () => clearInterval(t);
  }, [session]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    window.location.href = '/login';
  };

  return (
    <>
      <header className="fixed top-[38px] left-0 right-0 z-50 bg-[var(--color-surface)]/80 backdrop-blur-md border-b border-[var(--color-surface-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href={session ? '/dashboard' : '/'} className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <Shield className="w-7 h-7 text-[var(--color-primary)]" />
              <div>
                <span className="text-2xl font-bold" style={{ color: '#00E5FF', textShadow: '0 0 12px rgba(0,229,255,0.4)' }}>Synaptic</span>
                <div style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#F0B90B', marginTop: '-2px', animation: 'blink 2.5s ease-in-out infinite' }}>AI · Crypto · Bots</div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-6">
              {session ? (
                <>
                  <Link href="/dashboard" className="text-[17px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Cockpit
                  </Link>
                  <Link href="/bots" className="text-[17px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Deploy
                  </Link>
                  <Link href="/trades" className="text-[17px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Paper Trade
                  </Link>
                  <Link href="/live" className="text-[17px] font-semibold flex items-center gap-1.5 transition-colors" style={{ color: '#EF4444', textShadow: '0 0 8px rgba(239,68,68,0.35)' }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#EF4444', boxShadow: '0 0 6px #EF4444', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    Live Trade
                  </Link>
                  {/* Alpha — disabled, coming soon */}
                  <span className="text-[17px] font-semibold" style={{ color: '#6B7280', cursor: 'not-allowed', opacity: 0.45 }} title="Coming soon">
                    α Alpha
                  </span>
                  {(session.user as any)?.role === 'admin' && (
                    <Link href="/admin" className="text-amber-400 hover:text-amber-300 transition-colors">
                      Admin
                    </Link>
                  )}
                  {/* Bell icon */}
                  {session && (
                    <button
                      onClick={() => { setDrawerOpen(true); setUnreadCount(0); }}
                      style={{
                        position: 'relative', background: 'none', border: 'none',
                        cursor: 'pointer', color: '#6B7280', padding: '4px',
                        display: 'flex', alignItems: 'center',
                      }}
                      aria-label="Notifications"
                    >
                      <Bell size={20} />
                      {unreadCount > 0 && (
                        <span style={{
                          position: 'absolute', top: -2, right: -2,
                          minWidth: 16, height: 16, borderRadius: 10,
                          background: '#00E5FF', color: '#050A14',
                          fontSize: '10px', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: '0 3px',
                        }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                      )}
                    </button>
                  )}
                  {session && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
                      <Link
                        href="/account"
                        style={{
                          fontSize: '13px', fontWeight: 600, color: '#00E5FF',
                          textDecoration: 'none', cursor: 'pointer',
                          transition: 'opacity 0.2s',
                        }}
                        title="Account Settings"
                      >
                        {(session.user as any)?.name || 'User'} {((session.user as any)?.role === 'admin') ? '(Admin)' : ''}
                      </Link>
                      <button
                        onClick={handleSignOut}
                        className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 rounded-lg transition-all"
                        title="Logout"
                      >
                        <LogOut size={18} />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Link href="/pricing" className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Pricing
                  </Link>
                  <Link href="/login" className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Login
                  </Link>
                  <Link href="/signup" className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors">
                    Sign Up
                  </Link>
                </>
              )}
            </nav>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-[var(--color-text)]">
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 space-y-3">
              {session ? (
                <>
                  <Link href="/dashboard" className="block text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Cockpit
                  </Link>
                  <Link href="/bots" className="block text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Deploy
                  </Link>
                  <Link href="/trades" className="block text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Paper Trade
                  </Link>
                  <Link href="/live" className="block font-semibold transition-colors" style={{ color: '#EF4444' }}>
                    ● Live Trade
                  </Link>

                  <Link href="/account" className="block font-semibold transition-colors" style={{ color: '#00E5FF' }}>
                    {(session.user as any)?.name || 'Account'}
                  </Link>
                  <span className="block font-semibold" style={{ color: '#6B7280', opacity: 0.45 }}>
                    α Alpha (soon)
                  </span>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-4 py-2 bg-[var(--color-danger)] text-white rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link href="/pricing" className="block text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Pricing
                  </Link>
                  <Link href="/login" className="block text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Login
                  </Link>
                  <Link href="/signup" className="block px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors text-center">
                    Sign Up
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <NotificationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}