'use client';

import React from 'react';

export default function BioRoiCommercialization({ workspaceId }: { workspaceId: string }) {
  // Mock Data
  const metrics = {
    deflectedHumanHours: 1420,
    costPerHumanHour: 85,
    apiComputeCost: 412.50,
    uptimeSla: 99.998,
    activeAgents: 12,
  };

  const totalDeflectedCost = metrics.deflectedHumanHours * metrics.costPerHumanHour;
  const netRoi = totalDeflectedCost - metrics.apiComputeCost;
  const roiPercentage = ((netRoi / metrics.apiComputeCost) * 100).toFixed(0);

  // Mock historical data for the chart (last 7 days)
  const chartData = [4500, 5200, 4800, 6100, 5900, 7200, 8400];
  const maxChartValue = Math.max(...chartData);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center space-x-2">
            <span>BIO ROI & SLA Billing Portal</span>
            <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2 py-0.5 rounded border border-emerald-500/30 font-mono">
              Workspace: {workspaceId}
            </span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">Real-time commercialization metrics and deflected labor cost analytics.</p>
        </div>
        <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm font-semibold text-white transition-colors">
          Download Invoice PDF
        </button>
      </div>

      {/* Top Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-12 h-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          </div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Gross Deflected Cost</p>
          <p className="text-2xl font-bold text-white font-mono">${totalDeflectedCost.toLocaleString()}</p>
          <p className="text-xs text-emerald-400 mt-2 flex items-center">
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>
            +14.2% vs last month
          </p>
        </div>

        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-12 h-12 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">API Compute Cost (FinOps)</p>
          <p className="text-2xl font-bold text-white font-mono">${metrics.apiComputeCost.toFixed(2)}</p>
          <p className="text-xs text-rose-400 mt-2 flex items-center">
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
            -2.4% vs last month (Optimized)
          </p>
        </div>

        <div className="bg-slate-900/80 backdrop-blur border border-cyan-500/30 rounded-xl p-5 shadow-[0_0_15px_rgba(6,182,212,0.1)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-12 h-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1">Net ROI Achieved</p>
          <p className="text-2xl font-bold text-white font-mono">${netRoi.toLocaleString()}</p>
          <p className="text-xs text-cyan-400 mt-2 font-bold">
            +{roiPercentage}% Return on Compute
          </p>
        </div>

        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          </div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">SLA Uptime Tracker</p>
          <p className="text-2xl font-bold text-white font-mono">{metrics.uptimeSla}%</p>
          <p className="text-xs text-slate-400 mt-2">
            Target: 99.99% (Tier 1)
          </p>
        </div>
      </div>

      {/* Chart Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-sm font-bold text-white mb-6">Net Savings Growth (Last 7 Days)</h3>
        
        <div className="relative h-64 w-full flex items-end justify-between space-x-2 pt-8">
          {/* Y-Axis Labels (Approximate) */}
          <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-[10px] text-slate-500 font-mono pb-6">
            <span>${maxChartValue.toLocaleString()}</span>
            <span>${(maxChartValue / 2).toLocaleString()}</span>
            <span>$0</span>
          </div>

          {/* Bars */}
          <div className="flex-1 flex items-end justify-between space-x-2 pl-12 h-full border-b border-slate-800 pb-2 relative">
            {chartData.map((val, i) => {
              const heightPercent = (val / maxChartValue) * 100;
              return (
                <div key={i} className="relative w-full flex flex-col items-center group">
                  {/* Tooltip */}
                  <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-slate-800 text-cyan-400 text-[10px] font-bold px-2 py-1 rounded border border-slate-700 transition-opacity z-10 font-mono">
                    ${val.toLocaleString()}
                  </div>
                  {/* Bar */}
                  <div 
                    className="w-full bg-gradient-to-t from-cyan-900/50 to-cyan-500/80 rounded-t-sm border-t border-cyan-400/50 hover:to-cyan-400 transition-all duration-300"
                    style={{ height: `${heightPercent}%` }}
                  ></div>
                  {/* X-Axis Label */}
                  <span className="absolute -bottom-6 text-[10px] text-slate-500 font-mono">Day {i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
