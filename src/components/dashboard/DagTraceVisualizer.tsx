'use client';

import React, { useState } from 'react';

interface DagNode {
  id: string;
  agentRole: string;
  model: string;
  status: 'completed' | 'running' | 'waiting_hitl' | 'failed';
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
  dependencies: string[];
  outputSnippet: string;
}

export default function DagTraceVisualizer({ workspaceId }: { workspaceId: string }) {
  const [selectedNode, setSelectedNode] = useState<DagNode | null>(null);

  const dagNodes: DagNode[] = [
    {
      id: 'task_01',
      agentRole: 'DecompositionOrchestrator',
      model: 'gemini-3.5-flash-lite',
      status: 'completed',
      latencyMs: 310,
      tokensUsed: 1420,
      costUsd: 0.000213,
      dependencies: [],
      outputSnippet: 'Deconstructed abstract query into 3 worker agent DAG steps.'
    },
    {
      id: 'task_02',
      agentRole: 'SAPDataExtractor',
      model: 'gemini-3.7-flash',
      status: 'completed',
      latencyMs: 820,
      tokensUsed: 4200,
      costUsd: 0.002100,
      dependencies: ['task_01'],
      outputSnippet: 'Extracted 142 line items from SAP ERP tables.'
    },
    {
      id: 'task_03',
      agentRole: 'DeepFinancialAuditor',
      model: 'gemini-3.1-pro-preview',
      status: 'waiting_hitl',
      latencyMs: 1450,
      tokensUsed: 12400,
      costUsd: 0.037200,
      dependencies: ['task_02'],
      outputSnippet: 'Computed potential $14,500 compliance deviation. Triggered HITL.'
    },
    {
      id: 'task_04',
      agentRole: 'ERPWritebackWorker',
      model: 'gemini-3.7-flash',
      status: 'running',
      latencyMs: 0,
      tokensUsed: 0,
      costUsd: 0,
      dependencies: ['task_03'],
      outputSnippet: 'Awaiting HITL gate clearance before SAP writeback...'
    }
  ];

  const getStatusBadge = (status: DagNode['status']) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">COMPLETED</span>;
      case 'running':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 animate-pulse">EXECUTING</span>;
      case 'waiting_hitl':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">HALTED (HITL)</span>;
      case 'failed':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-500/10 text-rose-400 border border-rose-500/30">FAILED</span>;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
        <div>
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <span>DAG Execution Graph Visualizer</span>
            <span className="text-xs text-cyan-400 font-mono bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
              Graph ID: exec_dag_9901
            </span>
          </h2>
          <p className="text-xs text-slate-400">Real-time stateful multi-agent execution tracing & model tier routing for {workspaceId}</p>
        </div>

        <div className="flex items-center space-x-4 text-xs font-mono">
          <div>
            <span className="text-slate-400">Total Latency: </span>
            <span className="text-slate-200 font-bold">2.58s</span>
          </div>
          <div>
            <span className="text-slate-400">Execution Cost: </span>
            <span className="text-cyan-400 font-bold">$0.039513</span>
          </div>
        </div>
      </div>

      {/* DAG Node Workflow Map with SVG Connectors */}
      <div className="relative mb-8 pt-4">
        {/* Decorative SVG Connectors (Simulated for fixed 4-grid) */}
        <div className="absolute inset-0 pointer-events-none hidden md:block">
          <svg className="w-full h-full" style={{ zIndex: 0 }}>
            <path d="M 12% 50% L 38% 50%" stroke="rgba(14, 165, 233, 0.3)" strokeWidth="2" fill="none" strokeDasharray="4 4" className="animate-pulse" />
            <path d="M 38% 50% L 62% 50%" stroke="rgba(14, 165, 233, 0.3)" strokeWidth="2" fill="none" strokeDasharray="4 4" className="animate-pulse" />
            <path d="M 62% 50% L 88% 50%" stroke="rgba(245, 158, 11, 0.3)" strokeWidth="2" fill="none" strokeDasharray="4 4" />
          </svg>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative z-10">
          {dagNodes.map((node, index) => {
            const isSelected = selectedNode?.id === node.id;
            return (
              <div
                key={node.id}
                onClick={() => setSelectedNode(node)}
                className={`p-4 rounded-xl border relative cursor-pointer transition-all duration-300 ${
                  isSelected
                    ? 'bg-slate-800 border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.15)] scale-105'
                    : 'bg-slate-950/80 backdrop-blur-md border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono text-slate-500">Step {index + 1}</span>
                  {getStatusBadge(node.status)}
                </div>

                <h3 className="text-sm font-bold text-slate-100 mb-1">{node.agentRole}</h3>
                <span className="text-[10px] font-mono text-cyan-400 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-800 block w-fit mb-4">
                  {node.model}
                </span>

                <div className="text-[10px] text-slate-400 space-y-1.5 pt-3 border-t border-slate-800/80">
                  <div className="flex justify-between items-center">
                    <span>Latency:</span>
                    <span className="font-mono text-slate-300 font-medium">{node.latencyMs > 0 ? `${node.latencyMs}ms` : '--'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Token Cost:</span>
                    <span className="font-mono text-slate-300 font-medium">${node.costUsd.toFixed(6)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Node Output Inspector */}
      {selectedNode ? (
        <div className="bg-slate-950/80 backdrop-blur border border-slate-800 rounded-xl p-5 mt-2 transform transition-all animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
            <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center space-x-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
              <span>Node Inspector — [{selectedNode.agentRole}]</span>
            </h4>
            <span className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded">Dependencies: {selectedNode.dependencies.join(', ') || 'None'}</span>
          </div>

          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-transparent rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
            <p className="text-xs text-slate-300 font-mono bg-slate-900 p-4 rounded-lg border border-slate-800 mb-4 leading-relaxed">
              {selectedNode.outputSnippet}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">Tokens Consumed</span>
              <span className="font-mono text-slate-200 text-sm">{selectedNode.tokensUsed.toLocaleString()} <span className="text-[10px] text-slate-500">tks</span></span>
            </div>
            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">Model Router Tier</span>
              <span className="font-mono text-cyan-400 text-sm">{selectedNode.model}</span>
            </div>
            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">Calculated Cost</span>
              <span className="font-mono text-emerald-400 text-sm">${selectedNode.costUsd.toFixed(6)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800 border-dashed">
          Click any DAG node above to inspect its execution output and telemetry data.
        </div>
      )}
    </div>
  );
}
