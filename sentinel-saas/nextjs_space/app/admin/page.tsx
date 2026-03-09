'use client';

import AdminDashboard from './admin-client';
import React from 'react';

class AdminErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean; error: string }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: '' };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error: error.message };
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '40px', textAlign: 'center', color: '#fff' }}>
                    <h2 style={{ color: '#EF4444', marginBottom: '16px' }}>⚠️ Admin Panel Error</h2>
                    <p style={{ color: '#9CA3AF', marginBottom: '12px' }}>{this.state.error}</p>
                    <button
                        onClick={() => { this.setState({ hasError: false, error: '' }); window.location.reload(); }}
                        style={{ padding: '8px 24px', borderRadius: '8px', background: '#3B82F6', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                        Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function AdminPage() {
    return (
        <AdminErrorBoundary>
            <AdminDashboard />
        </AdminErrorBoundary>
    );
}
