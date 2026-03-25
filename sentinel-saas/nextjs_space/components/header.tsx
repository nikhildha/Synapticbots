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
      <header className="fixed top-[38px] left-0 right-0 z-50" style={{ background: '#FFFFFF', borderBottom: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href={session ? '/dashboard' : '/'} className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <Shield className="w-7 h-7 text-[var(--color-primary)]" />
              <div>
                <span className="text-2xl font-bold" style={{ color: '#1A1A1A' }}>Synaptic</span>
                <div style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#F0B90B', marginTop: '-2px' }}>AI · Crypto · Bots</div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-6">
              {session ? (
                <>
                  <Link href="/dashboard" className="text-[15px] font-medium transition-colors" style={{ color: '#4B5563' }} onMouseEnter={e => (e.currentTarget.style.color='#F0B90B')} onMouseLeave={e => (e.currentTarget.style.color='#4B5563')}>
                    Cockpit
                  </Link>
                  <Link href="/bots" className="text-[15px] font-medium transition-colors" style={{ color: '#4B5563' }} onMouseEnter={e => (e.currentTarget.style.color='#F0B90B')} onMouseLeave={e => (e.currentTarget.style.color='#4B5563')}>
                    Deploy
                  </Link>
                  <Link href="/trades" className="text-[15px] font-medium transition-colors" style={{ color: '#4B5563' }} onMouseEnter={e => (e.currentTarget.style.color='#F0B90B')} onMouseLeave={e => (e.currentTarget.style.color='#4B5563')}>
                    Trade Book
                  </Link>

                  <Link href="/account" className="text-[15px] font-medium transition-colors" style={{ color: '#4B5563' }} onMouseEnter={e => (e.currentTarget.style.color='#F0B90B')} onMouseLeave={e => (e.currentTarget.style.color='#4B5563')}>
                    Account
                  </Link>
                  {/* Alpha — standalone quant engine, do not merge with main engine */}
                  <Link href="/alpha" className="text-[15px] font-semibold" style={{ color: '#F0B90B', fontWeight: 800 }}>
                    α Alpha
                  </Link>
                  {(session.user as any)?.role === 'admin' && (
                    <Link href="/admin" style={{ color: '#F0B90B', fontSize: '15px', fontWeight: 600 }}>
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
                          background: '#F0B90B', color: '#1A1A1A',
                          fontSize: '10px', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: '0 3px',
                        }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                      )}
                    </button>
                  )}
                  {session && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                        {(session.user as any)?.name || 'User'} {((session.user as any)?.role === 'admin') ? '(Admin)' : ''}
                      </span>
                      <button
                        onClick={handleSignOut}
                        style={{ padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #F0B90B', background: 'transparent', color: '#1A1A1A', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Logout"
                      >
                        <LogOut size={14} /> Logout
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
                    Trade Book
                  </Link>

                  <Link href="/account" className="block text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                    Account
                  </Link>
                  <Link href="/alpha" className="block font-semibold transition-colors" style={{ color: '#F0B90B' }}>
                    α Alpha
                  </Link>
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