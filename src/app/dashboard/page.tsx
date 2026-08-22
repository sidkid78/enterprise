'use client';

import React, { useState } from 'react';
import HitlQueueDashboard from '@/components/dashboard/HitlQueueDashboard';
import DagTraceVisualizer from '@/components/dashboard/DagTraceVisualizer';
import WorkforceUpskillingHub from '@/components/dashboard/WorkforceUpskillingHub';
import BioRoiCommercialization from '@/components/dashboard/BioRoiCommercialization';

export default function EnterpriseDashboardPage() {
  const [activeTab, setActiveTab] = useState<'hitl' | 'dag' | 'upskilling' | 'bio'>('hitl');
  const [workspaceId, setWorkspaceId] = useState<string>('ws_ent_9832_prod');
  const [stats, setStats] = useState({
    pendingHitlCount: 3,
    activeDagRuns: 2,
    totalDeflectedCostUsd: 142850.00,
    slaUptimePercentage: 99.98,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Enterprise Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-cyan-500/20">
              Æ
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-lg text-white tracking-tight">Enterprise AgentOps</h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-full uppercase tracking-wider">
                  2026 SLA Tier 1
                </span>
              </div>
              <p className="text-xs text-slate-400">Multi-Agent Orchestration & Governance Control Plane</p>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="hidden lg:flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></div>
              <span className="text-xs text-slate-400">SLA Uptime:</span>
              <span className="text-xs font-mono font-semibold text-emerald-400">{stats.slaUptimePercentage}%</span>
            </div>
            <div className="h-4 w-px bg-slate-800"></div>
            <div className="text-xs">
              <span className="text-slate-400">Deflected Cost: </span>
              <span className="font-mono font-bold text-cyan-400">${stats.totalDeflectedCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="h-4 w-px bg-slate-800"></div>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400">Active Tenant:</span>
              <select 
                value={workspaceId} 
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-xs rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="ws_ent_9832_prod">Acme Corp Enterprise</option>
                <option value="ws_global_fintech">GlobalFinTech SLA</option>
                <option value="ws_health_care_plus">HealthCare Plus (HIPAA)</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <div className="border-b border-slate-800 mb-8">
          <nav className="flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('hitl')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-colors ${
                activeTab === 'hitl'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <span>HITL Decision Queue</span>
              {stats.pendingHitlCount > 0 && (
                <span className="ml-2 bg-amber-500/20 text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-500/40">
                  {stats.pendingHitlCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('dag')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-colors ${
                activeTab === 'dag'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/>
              </svg>
              <span>DAG Execution Visualizer</span>
              <span className="ml-1 bg-cyan-500/10 text-cyan-400 text-xs px-2 py-0.5 rounded-full border border-cyan-500/30">
                {stats.activeDagRuns} Live
              </span>
            </button>

            <button
              onClick={() => setActiveTab('upskilling')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-colors ${
                activeTab === 'upskilling'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
              </svg>
              <span>Workforce Enablement & SOPs</span>
            </button>

            <button
              onClick={() => setActiveTab('bio')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-colors ${
                activeTab === 'bio'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
              </svg>
              <span>BIO ROI & SLA Billing</span>
            </button>
          </nav>
        </div>

        {/* Dynamic Tab Views */}
        {activeTab === 'hitl' && <HitlQueueDashboard workspaceId={workspaceId} />}
        {activeTab === 'dag' && <DagTraceVisualizer workspaceId={workspaceId} />}
        {activeTab === 'upskilling' && <WorkforceUpskillingHub workspaceId={workspaceId} />}
        {activeTab === 'bio' && <BioRoiCommercialization workspaceId={workspaceId} />}
      </main>
    </div>
  );
}
