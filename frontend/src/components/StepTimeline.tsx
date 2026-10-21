import React, { useState } from 'react';
import type { SolutionStep } from '../types/cpm';
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon } from './Icons';
import './StepTimeline.css';

interface StepTimelineProps {
  steps: SolutionStep[];
  onHighlightDiagram?: (highlight: {
    nodes?: number[];
    edges?: string[];
    type?: 'forward' | 'backward' | 'critical' | 'all';
  } | null) => void;
}

export const StepTimeline: React.FC<StepTimelineProps> = ({ steps, onHighlightDiagram }) => {
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    steps.forEach((s) => {
      init[s.n] = true;
    });
    return init;
  });

  const [copied, setCopied] = useState(false);
  const [activeHoverStep, setActiveHoverStep] = useState<number | null>(null);

  const toggleStep = (n: number) => {
    setExpandedSteps((prev) => ({ ...prev, [n]: !prev[n] }));
  };

  const expandAll = () => {
    const update: Record<number, boolean> = {};
    steps.forEach((s) => {
      update[s.n] = true;
    });
    setExpandedSteps(update);
  };

  const collapseAll = () => {
    setExpandedSteps({});
  };

  const allExpanded = steps.every((s) => expandedSteps[s.n]);

  const copySolutionAsText = async () => {
    const textParts = steps.map((s) => {
      let part = `Step ${s.n}: ${s.title}\n`;
      if (s.lines && s.lines.length > 0) {
        part += s.lines.join('\n') + '\n';
      }
      if (s.table && s.table.headers && s.table.rows) {
        part += '\n' + s.table.headers.join(' | ') + '\n';
        part += s.table.headers.map(() => '---').join(' | ') + '\n';
        part += s.table.rows.map((row) => row.join(' | ')).join('\n') + '\n';
      }
      return part;
    });

    const fullText = textParts.join('\n' + '='.repeat(40) + '\n\n');
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleMouseEnterStep = (s: SolutionStep) => {
    setActiveHoverStep(s.n);
    if (!onHighlightDiagram) return;
    const lower = s.title.toLowerCase();
    if (lower.includes('earliest') || lower.includes('forward')) {
      onHighlightDiagram({ type: 'forward' });
    } else if (lower.includes('latest') || lower.includes('backward')) {
      onHighlightDiagram({ type: 'backward' });
    } else if (lower.includes('critical')) {
      onHighlightDiagram({ type: 'critical' });
    } else {
      onHighlightDiagram(null);
    }
  };

  const handleMouseLeaveStep = () => {
    setActiveHoverStep(null);
    if (onHighlightDiagram) onHighlightDiagram(null);
  };

  return (
    <div className="step-timeline-card" id="steps-section">
      {/* Sticky Quick-Action Bar */}
      <div className="step-sticky-bar">
        <h3 className="step-sticky-title">Step-by-Step Solution</h3>

        <div className="step-sticky-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={allExpanded ? collapseAll : expandAll}
            style={{ fontSize: 'var(--text-xs)', padding: '5px 12px', minHeight: '30px' }}
          >
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={copySolutionAsText}
            style={{ fontSize: 'var(--text-xs)', padding: '5px 12px', minHeight: '30px' }}
            title="Copy full step-by-step mathematical derivation"
          >
            {copied ? (
              <>
                <CheckIcon size={14} style={{ color: 'var(--success)' }} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <CopyIcon size={14} />
                <span>Copy Steps</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="timeline-container">
        {/* Continuous Rail Line */}
        <div className="timeline-rail" />

        {steps.map((step) => {
          const isExpanded = !!expandedSteps[step.n];
          const isActive = activeHoverStep === step.n;

          return (
            <div
              key={step.n}
              className={`timeline-item ${isActive ? 'is-active' : ''}`}
              onMouseEnter={() => handleMouseEnterStep(step)}
              onMouseLeave={handleMouseLeaveStep}
            >
              {/* Numbered Node on Rail */}
              <div className="timeline-node" aria-hidden="true">
                {step.n}
              </div>

              {/* Step Card Box */}
              <div className="timeline-step-box">
                <button
                  type="button"
                  className={`timeline-step-header ${isExpanded ? 'is-open' : ''}`}
                  onClick={() => toggleStep(step.n)}
                >
                  <div className="timeline-step-title">
                    <span>{step.title}</span>
                  </div>

                  <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
                    {isExpanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                  </span>
                </button>

                {isExpanded && (
                  <div className="timeline-step-content">
                    {step.lines && step.lines.length > 0 && (
                      <div className="timeline-formula-block">
                        {step.lines.map((line, idx) => (
                          <div key={idx} style={{ marginBottom: idx < step.lines.length - 1 ? '4px' : 0 }}>
                            {line}
                          </div>
                        ))}
                      </div>
                    )}

                    {step.table && step.table.headers && step.table.rows && (
                      <div className="table-scroll-container" style={{ maxHeight: '280px' }}>
                        <table className="schedule-data-table">
                          <thead>
                            <tr>
                              {step.table.headers.map((h, idx) => (
                                <th key={idx}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {step.table.rows.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx}>{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
