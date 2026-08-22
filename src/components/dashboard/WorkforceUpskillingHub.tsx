'use client';

import React from 'react';

export default function WorkforceUpskillingHub({ workspaceId }: { workspaceId: string }) {
  const trainingModules = [
    { id: 'TM-01', title: 'Invoice Discrepancy Adjudication', completion: 82, agentsAssigned: 3, humans: 1 },
    { id: 'TM-02', title: 'Medical Claim Pre-Authorization', completion: 45, agentsAssigned: 5, humans: 2 },
    { id: 'TM-03', title: 'Vendor Contract Risk Extraction', completion: 100, agentsAssigned: 2, humans: 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center space-x-2">
            <span>Workforce Enablement & SOP Hub</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">Manage active learning modules, Standard Operating Procedures, and HITL metrics for {workspaceId}.</p>
        </div>
        <button className="px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 rounded-lg text-sm font-semibold transition-colors">
          + Create New SOP Node
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Training Modules */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4">Active HITL Training Modules</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Module Name</th>
                  <th className="pb-3 px-4">Completion</th>
                  <th className="pb-3 px-4">Agents Assigned</th>
                  <th className="pb-3 px-4">Human Supervisors</th>
                  <th className="pb-3 pl-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {trainingModules.map((mod) => (
                  <tr key={mod.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-mono text-slate-500">{mod.id}</span>
                        <span className="font-medium text-slate-200">{mod.title}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <div className="w-full bg-slate-800 rounded-full h-2 min-w-[60px]">
                          <div 
                            className={`h-2 rounded-full ${mod.completion === 100 ? 'bg-emerald-400' : 'bg-cyan-500'}`}
                            style={{ width: `${mod.completion}%` }}
                          ></div>
                        </div>
                        <span className="text-xs font-mono text-slate-400">{mod.completion}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-bold text-xs">
                        {mod.agentsAssigned}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold text-xs">
                        {mod.humans}
                      </span>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <button className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
                        Review SOP
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Stats Sidebar */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white mb-4">Workforce Telemetry</h3>
            
            <div className="space-y-4">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Human Decision Avg Latency</p>
                <p className="text-xl font-mono text-white">45.2s <span className="text-xs text-emerald-400">-2.1s</span></p>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Agent Decision Avg Latency</p>
                <p className="text-xl font-mono text-cyan-400">1.8s</p>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Agent Confidence Accuracy</p>
                <p className="text-xl font-mono text-white">94.3%</p>
              </div>
            </div>
          </div>
          <button className="w-full mt-6 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-white transition-colors">
            Generate Performance Report
          </button>
        </div>
      </div>
    </div>
  );
}
