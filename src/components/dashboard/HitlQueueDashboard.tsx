'use client';

import React, { useState } from 'react';

interface PendingGate {
  id: string;
  graphExecutionId: string;
  agentRole: string;
  triggerReason: string;
  confidenceScore: number;
  requiredRole: string;
  createdAt: string;
  reasoningSummary: {
    primaryCause: string;
    triggerDescription: string;
    riskFactors: string[];
  };
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
}

export default function HitlQueueDashboard({ workspaceId }: { workspaceId: string }) {
  const [gates, setGates] = useState<PendingGate[]>([
    {
      id: 'gate_7a89f2',
      graphExecutionId: 'exec_dag_9901',
      agentRole: 'InsuranceClaimsAssessor',
      triggerReason: 'financial_threshold_exceeded',
      confidenceScore: 0.64,
      requiredRole: 'ai_administrator',
      createdAt: '2026-03-29T10:14:22Z',
      reasoningSummary: {
        primaryCause: 'Claim payout calculation ($14,500.00) exceeds automatic approval threshold ($10,000.00).',
        triggerDescription: 'Agent computed settlement based on clause 4B with a 0.64 confidence score.',
        riskFactors: [
          'High financial liability ($14,500.00)',
          'Extracted medical report missing secondary doctor signature verification',
        ]
      },
      inputPayload: { claimId: 'CLM-2026-8812', policyType: 'Commercial Auto' },
      outputPayload: { recommendedPayoutUsd: 14500.00, approvalStatus: 'PENDING_HUMAN_SIGN_OFF' }
    },
    {
      id: 'gate_3b110e',
      graphExecutionId: 'exec_dag_9904',
      agentRole: 'ERPInventoryPurchaser',
      triggerReason: 'low_confidence_score',
      confidenceScore: 0.52,
      requiredRole: 'agent_operator',
      createdAt: '2026-03-29T10:22:05Z',
      reasoningSummary: {
        primaryCause: 'Vendor SKU mapping returned ambiguous match across two SAP supply catalogs.',
        triggerDescription: 'Confidence score (0.52) fell below the minimum required boundary (0.70).',
        riskFactors: [
          'Duplicate SKU match found: SKU-8891-A vs SKU-8891-B',
          'Potential ordering delay if wrong supplier selected'
        ]
      },
      inputPayload: { reorderItem: 'Industrial Gasket Type C', targetQuantity: 500 },
      outputPayload: { selectedVendorId: 'VEND_SAP_88', estimatedCost: 3200.00 }
    }
  ]);

  const [selectedGate, setSelectedGate] = useState<PendingGate | null>(gates[0] || null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideText, setOverrideText] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  const handleResolve = (action: 'approve' | 'reject' | 'escalate') => {
    if (!selectedGate) return;
    setIsResolving(true);

    setTimeout(() => {
      setGates((prev) => prev.filter((g) => g.id !== selectedGate.id));
      const remaining = gates.filter((g) => g.id !== selectedGate.id);
      setSelectedGate(remaining[0] || null);
      setIsResolving(false);
      // Removed the ugly alert to keep the UI clean. In a real app this would be a toast notification.
    }, 600);
  };

  const handleOverrideSubmit = () => {
    if (!selectedGate) return;
    setIsResolving(true);

    setTimeout(() => {
      setGates((prev) => prev.filter((g) => g.id !== selectedGate.id));
      const remaining = gates.filter((g) => g.id !== selectedGate.id);
      setSelectedGate(remaining[0] || null);
      setOverrideModalOpen(false);
      setIsResolving(false);
    }, 600);
  };

  // Basic syntax highlighter for JSON
  const renderHighlightedJson = (obj: any) => {
    const jsonStr = JSON.stringify(obj, null, 2);
    // Extremely basic regex to style keys vs string values vs numbers
    return (
      <span dangerouslySetInnerHTML={{
        __html: jsonStr
          .replace(/"([^"]+)":/g, '<span class="text-cyan-300">"$1"</span>:') // Keys
          .replace(/: "([^"]+)"/g, ': <span class="text-emerald-300">"$1"</span>') // Strings
          .replace(/: ([0-9.]+)/g, ': <span class="text-amber-300">$1</span>') // Numbers
      }} />
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Pending Queue List */}
      <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col h-[800px]">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <span>Pending Escalations</span>
              <span className="bg-amber-500/20 text-amber-400 text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-amber-500/30 tracking-wider">
                {gates.length} In Queue
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Workspace: {workspaceId}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
          {gates.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <p className="text-sm font-medium text-slate-300">No pending HITL gates!</p>
              <p className="text-xs text-slate-500 mt-1">Autonomous worker agents running within confidence thresholds.</p>
            </div>
          ) : (
            gates.map((gate) => {
              const isSelected = selectedGate?.id === gate.id;
              return (
                <div
                  key={gate.id}
                  onClick={() => setSelectedGate(gate)}
                  className={`p-4 rounded-xl border relative cursor-pointer transition-all duration-300 ${
                    isSelected
                      ? 'bg-slate-800 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)] scale-[1.02] z-10'
                      : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-cyan-400 rounded-r shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono font-bold text-slate-200">{gate.agentRole}</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(gate.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                    {gate.reasoningSummary.primaryCause}
                  </p>

                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-slate-500">Confidence:</span>
                      <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
                        gate.confidenceScore < 0.6 ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {(gate.confidenceScore * 100).toFixed(0)}%
                      </span>
                    </div>

                    <span className="text-slate-500 font-mono">
                      Role: <span className="text-slate-300">{gate.requiredRole}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Detail & Action Inspector */}
      <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col h-[800px] relative overflow-hidden">
        {/* Subtle background glow */}
        {selectedGate && (
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
        )}

        {selectedGate ? (
          <div className="flex flex-col h-full relative z-10 animate-in fade-in zoom-in-95 duration-300">
            {/* Header Details */}
            <div className="border-b border-slate-800 pb-5 mb-5 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold uppercase tracking-widest flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></span>
                  <span>Trigger: {selectedGate.triggerReason.replace(/_/g, ' ')}</span>
                </span>
                <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                  Gate ID: {selectedGate.id}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-1">
                {selectedGate.agentRole} Execution Gate
              </h3>
              <p className="text-[11px] text-slate-400 flex items-center space-x-2">
                <span>Execution Graph:</span>
                <span className="font-mono text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded">{selectedGate.graphExecutionId}</span>
              </p>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar">
              {/* Transparent Reasoning Report Box */}
              <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800 rounded-xl overflow-hidden shadow-inner">
                <div className="bg-slate-800/40 px-4 py-2.5 border-b border-slate-800 flex items-center space-x-2">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <h4 className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">
                    Transparent AI Reasoning Report
                  </h4>
                </div>
                
                <div className="p-4">
                  <div className="mb-4">
                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Primary Cause</p>
                    <p className="text-sm text-slate-200 leading-relaxed font-medium">{selectedGate.reasoningSummary.primaryCause}</p>
                  </div>
                  
                  <div className="mb-4">
                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Technical Trigger Description</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed font-mono">{selectedGate.reasoningSummary.triggerDescription}</p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-2">Identified Risk Factors</p>
                    <ul className="space-y-1.5">
                      {selectedGate.reasoningSummary.riskFactors.map((rf, idx) => (
                        <li key={idx} className="flex items-start space-x-2 text-[11px] text-amber-300/90">
                          <svg className="w-3.5 h-3.5 text-amber-500/70 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                          <span>{rf}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Input/Output Payload Viewer */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 flex items-center space-x-1.5">
                     <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>
                     <span>Input Context</span>
                   </label>
                   <div className="bg-[#0d1117] border border-slate-800 rounded-lg p-3 overflow-x-auto">
                     <pre className="text-[10px] font-mono leading-relaxed">
                        {renderHighlightedJson(selectedGate.inputPayload)}
                     </pre>
                   </div>
                </div>
                <div>
                   <label className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest block mb-2 flex items-center space-x-1.5">
                     <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                     <span>Proposed Output (Pending)</span>
                   </label>
                   <div className="bg-[#0d1117] border border-cyan-900/50 rounded-lg p-3 overflow-x-auto shadow-[inset_0_0_10px_rgba(6,182,212,0.05)]">
                     <pre className="text-[10px] font-mono leading-relaxed">
                        {renderHighlightedJson(selectedGate.outputPayload)}
                     </pre>
                   </div>
                </div>
              </div>
            </div>

            {/* Interactive Control Panel Actions (Sticky Bottom) */}
            <div className="pt-5 mt-2 border-t border-slate-800 flex flex-wrap gap-3 items-center justify-end flex-shrink-0 bg-slate-900">
              <button
                disabled={isResolving}
                onClick={() => handleResolve('escalate')}
                className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center space-x-2"
              >
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>
                <span>Escalate</span>
              </button>

              <button
                disabled={isResolving}
                onClick={() => handleResolve('reject')}
                className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                <span>Reject</span>
              </button>

              <button
                disabled={isResolving}
                onClick={() => {
                  setOverrideText(JSON.stringify(selectedGate.outputPayload, null, 2));
                  setOverrideModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                <span>Modify & Override</span>
              </button>

              <button
                disabled={isResolving}
                onClick={() => handleResolve('approve')}
                className="px-5 py-2.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition flex items-center space-x-2 ml-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                <span>Approve & Resume DAG</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-500">
            <svg className="w-16 h-16 opacity-20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
            <p className="text-sm font-medium text-slate-400">No gate selected</p>
            <p className="text-[11px] mt-1">Select a pending gate from the queue to inspect reasoning logs.</p>
          </div>
        )}
      </div>

      {/* Override Parameter Modal */}
      {overrideModalOpen && selectedGate && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-white mb-1 flex items-center space-x-2">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              <span>Override Task Payload</span>
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              Directly adjust output JSON before resuming worker DAG execution. Ensure strict schema adherence.
            </p>

            <div className="bg-[#0d1117] rounded-lg border border-slate-800 overflow-hidden shadow-inner">
              <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-800 text-[10px] font-mono text-slate-500 uppercase tracking-wider flex justify-between items-center">
                <span>outputPayload.json</span>
                <span className="text-indigo-400">Editable</span>
              </div>
              <textarea
                value={overrideText}
                onChange={(e) => setOverrideText(e.target.value)}
                rows={10}
                className="w-full bg-transparent p-4 font-mono text-[11px] text-cyan-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none leading-relaxed"
                spellCheck={false}
              />
            </div>

            <div className="flex items-center justify-end space-x-3 mt-6">
              <button
                onClick={() => setOverrideModalOpen(false)}
                className="px-5 py-2.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleOverrideSubmit}
                className="px-5 py-2.5 rounded-lg text-xs font-bold bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)] transition"
              >
                Apply Override & Resume
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
