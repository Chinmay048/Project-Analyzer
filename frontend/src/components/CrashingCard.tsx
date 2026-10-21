import React from 'react';
import type { CrashingResult } from '../types/cpm';
import { WarningIcon } from './Icons';
import './CrashingCard.css';

interface CrashingCardProps {
  crashing: CrashingResult;
}

export const CrashingCard: React.FC<CrashingCardProps> = ({ crashing }) => {
  return (
    <div className="crashing-card" id="crashing-section">
      <div className="crashing-header">
        <h3 className="crashing-title">Project Crashing</h3>
        <p className="crashing-subtitle">{crashing.message}</p>
      </div>

      {!crashing.feasible && (
        <div className="crashing-infeasible-banner">
          <WarningIcon size={18} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <div>
            <strong>Crashing Target Infeasible:</strong> {crashing.message}
          </div>
        </div>
      )}

      {/* Crashing Metrics Summary */}
      <div className="crashing-metrics-grid">
        <div className="crashing-metric-tile">
          <span className="crashing-metric-label">Final Project Duration</span>
          <div className="crashing-metric-value highlight">
            {crashing.final_duration}
          </div>
        </div>

        <div className="crashing-metric-tile">
          <span className="crashing-metric-label">Total Added Crash Cost</span>
          <div className="crashing-metric-value">
            +${crashing.crash_cost}
          </div>
        </div>

        <div className="crashing-metric-tile">
          <span className="crashing-metric-label">Iterations Performed</span>
          <div className="crashing-metric-value">
            {crashing.iterations.length}
          </div>
        </div>
      </div>

      {/* Slopes Table */}
      {crashing.slopes && crashing.slopes.length > 0 && (
        <div>
          <h4 className="crashing-section-title">Cost Slopes</h4>
          <div className="table-scroll-container" style={{ maxHeight: '340px' }}>
            <table className="schedule-data-table">
              <thead>
                <tr>
                  <th className="sticky-col-first">Activity</th>
                  <th>Normal Time</th>
                  <th>Crash Time</th>
                  <th>Normal Cost</th>
                  <th>Crash Cost</th>
                  <th>Cost Slope</th>
                </tr>
              </thead>
              <tbody>
                {crashing.slopes.map((s, idx) => (
                  <tr key={idx}>
                    <td className="sticky-col-first" style={{ fontWeight: 600 }}>{s.activity}</td>
                    <td>{s.normal_time ?? '–'}</td>
                    <td>{s.crash_time ?? '–'}</td>
                    <td>{s.normal_cost !== undefined ? `$${s.normal_cost}` : '–'}</td>
                    <td>{s.crash_cost !== undefined ? `$${s.crash_cost}` : '–'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      ${s.slope} / unit
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Iterations Breakdown */}
      {crashing.iterations && crashing.iterations.length > 0 && (
        <div>
          <h4 className="crashing-section-title">Crashing Step-by-Step Cuts</h4>
          <div className="table-scroll-container" style={{ maxHeight: '340px' }}>
            <table className="schedule-data-table">
              <thead>
                <tr>
                  <th className="sticky-col-first">Step</th>
                  <th>Crashed Activity/Cut</th>
                  <th>Reduction (by)</th>
                  <th>Duration Before → After</th>
                  <th>Step Cost</th>
                </tr>
              </thead>
              <tbody>
                {crashing.iterations.map((it) => (
                  <tr key={it.step}>
                    <td className="sticky-col-first" style={{ fontWeight: 700 }}>#{it.step}</td>
                    <td style={{ fontWeight: 600 }}>{it.crashed.join(', ')}</td>
                    <td>{it.by} units</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {it.duration_before} → <strong>{it.duration_after}</strong>
                    </td>
                    <td style={{ fontWeight: 600 }}>+${it.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
