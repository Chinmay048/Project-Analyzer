import React, { useEffect, useState } from 'react';
import type { CriticalPath, PertAnalysis, SummaryInfo } from '../types/cpm';
import { SparklesIcon } from './Icons';
import './SummaryStrip.css';

interface SummaryStripProps {
  summary: SummaryInfo;
  timed: boolean;
  criticalPaths: CriticalPath[];
  pertAnalysis: PertAnalysis | null;
  activePathIndex: number | null;
  onSelectCriticalPath: (index: number | null) => void;
}

// Hook to animate number count-up smoothly
function useCountUp(target: number | undefined | null, durationMs = 600) {
  const [displayValue, setDisplayValue] = useState<number | string>(target ?? 0);

  useEffect(() => {
    let animationFrameId: number;
    const targetNum = target === undefined || target === null ? 0 : Number(target);
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || isNaN(targetNum)) {
      animationFrameId = requestAnimationFrame(() => setDisplayValue(target ?? 0));
      return () => cancelAnimationFrame(animationFrameId);
    }

    const start = 0;
    const startTime = performance.now();

    const update = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (targetNum - start) * eased;

      if (Number.isInteger(targetNum)) {
        setDisplayValue(Math.round(current));
      } else {
        setDisplayValue(Number(current.toFixed(2)));
      }

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(update);
      } else {
        setDisplayValue(target ?? 0);
      }
    };

    animationFrameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrameId);
  }, [target, durationMs]);

  return displayValue;
}

export const SummaryStrip: React.FC<SummaryStripProps> = ({
  summary,
  timed,
  criticalPaths,
  pertAnalysis,
  activePathIndex,
  onSelectCriticalPath,
}) => {
  const hasMultipleCritical = (summary.critical_path_count || 0) > 1;
  const animatedDuration = useCountUp(summary.project_duration);

  return (
    <div className="summary-strip-container">
      {/* Metric Cards Grid */}
      <div className="metrics-grid">
        {/* Hero: Project Duration */}
        {timed && (
          <div className="hero-metric-card apple-card">
            <div className="metric-label-row">
              <span className="metric-label">Project Duration</span>
              {hasMultipleCritical && (
                <span className="badge badge-warning">
                  {summary.critical_path_count} Critical Paths
                </span>
              )}
            </div>
            <div className="hero-duration-number tabular">
              {animatedDuration}
              <span style={{ fontSize: 'var(--text-title3)', fontWeight: 600, color: 'var(--text-secondary)', marginLeft: '6px' }}>
                days
              </span>
            </div>
            <div className="hero-subtext">
              <span>Earliest project completion time</span>
            </div>
          </div>
        )}

        {/* Total Events / Nodes */}
        <div className="secondary-stat-card apple-card">
          <div className="metric-label-row">
            <span className="metric-label">Events (Nodes)</span>
          </div>
          <div className="stat-number tabular">{summary.events}</div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
            Network milestones
          </div>
        </div>

        {/* Total Activities */}
        <div className="secondary-stat-card apple-card">
          <div className="metric-label-row">
            <span className="metric-label">Activities</span>
          </div>
          <div className="stat-number tabular">{summary.activities}</div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
            Real work packages
          </div>
        </div>

        {/* Dummy Arrows */}
        <div className="secondary-stat-card apple-card">
          <div className="metric-label-row">
            <span className="metric-label">Dummy Arrows</span>
          </div>
          <div className="stat-number tabular">{summary.dummies}</div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
            Logical precedence links
          </div>
        </div>

        {/* PERT Statistics if present */}
        {pertAnalysis && (
          <div className="secondary-stat-card apple-card">
            <div className="metric-label-row">
              <span className="metric-label">Expected Duration (μ)</span>
              <span className="badge badge-accent">PERT</span>
            </div>
            <div className="stat-number pert-stat-accent tabular">
              {pertAnalysis.expected_duration}
            </div>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }} className="tabular">
              σ² = {pertAnalysis.variance} • σ = {pertAnalysis.std_dev}
            </div>
          </div>
        )}
      </div>

      {/* Critical Paths Pill List */}
      {timed && criticalPaths && criticalPaths.length > 0 && (
        <div className="apple-card critical-paths-card">
          <div className="critical-paths-header">
            <div className="critical-paths-title-row">
              <span style={{ fontSize: 'var(--text-base)', fontWeight: 700 }}>Critical Paths</span>
              {hasMultipleCritical && (
                <span className="badge badge-warning">
                  {summary.critical_path_count ?? criticalPaths.length} Total
                </span>
              )}
            </div>
            {activePathIndex !== null && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onSelectCriticalPath(null)}
                style={{ fontSize: 'var(--text-2xs)', padding: '4px 10px', minHeight: '26px' }}
              >
                Clear Selection
              </button>
            )}
          </div>

          <div className="critical-paths-list" role="list" aria-label="Critical Paths">
            {criticalPaths.map((cp, idx) => {
              const isSelected = activePathIndex === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`critical-path-button ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectCriticalPath(isSelected ? null : idx)}
                  role="listitem"
                  aria-pressed={isSelected}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="critical-path-tag">
                      Path {idx + 1}
                    </span>
                    <span className="critical-path-route">
                      {cp.label}
                    </span>
                  </div>

                  <span className="badge badge-critical tabular">
                    Length {cp.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* PERT Probability Queries Results */}
      {pertAnalysis && pertAnalysis.queries && pertAnalysis.queries.length > 0 && (
        <div className="apple-card critical-paths-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SparklesIcon size={16} style={{ color: 'var(--accent)' }} />
            <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 700 }}>PERT Probability Estimates</h4>
          </div>

          <div className="pert-queries-grid">
            {pertAnalysis.queries.map((q, qIdx) => (
              <div key={qIdx} className="pert-query-card">
                <div className="pert-query-label">{q.label}</div>
                <div className="pert-query-mono">
                  {q.target_time !== undefined && (
                    <div>Target Time: <strong>{q.target_time}</strong></div>
                  )}
                  {q.z_table != null ? (
                    <div>Z Score: <strong>{q.z_table}</strong></div>
                  ) : (
                    <div>Z Score: <strong>N/A (σ = 0)</strong></div>
                  )}
                  {(q.p_le != null || q.p_le_table != null) && (
                    <div style={{ marginTop: '4px' }}>
                      P(T ≤ {q.target_time}):{' '}
                      <strong style={{ color: 'var(--accent)' }}>
                        {((q.p_le ?? q.p_le_table!) * 100).toFixed(2)}%
                      </strong>
                      {q.p_le_table != null && q.p_le != null && (
                        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', marginLeft: '6px' }}>
                          (table: {(q.p_le_table * 100).toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
