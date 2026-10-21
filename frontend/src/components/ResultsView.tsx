import React, { useState, useEffect } from 'react';
import type { SolveResponse } from '../types/cpm';
import { SummaryStrip } from './SummaryStrip';
import { NetworkDiagram } from './NetworkDiagram';
import { ActivityTable } from './ActivityTable';
import { StepTimeline } from './StepTimeline';
import { CrashingCard } from './CrashingCard';
import { WarningIcon } from './Icons';
import './ResultsView.css';

interface ResultsViewProps {
  response: SolveResponse;
}

export const ResultsView: React.FC<ResultsViewProps> = ({ response }) => {
  const [prevResponse, setPrevResponse] = useState(response);
  const [activePathIndex, setActivePathIndex] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<'summary' | 'diagram' | 'table' | 'crashing' | 'steps'>('summary');
  const [highlightedStepElements, setHighlightedStepElements] = useState<{
    nodes?: number[];
    edges?: string[];
    type?: 'forward' | 'backward' | 'critical' | 'all';
  } | null>(null);

  if (prevResponse !== response) {
    setPrevResponse(response);
    setActivePathIndex(null);
    setHighlightedStepElements(null);
  }

  const activePathActivities =
    activePathIndex !== null && response.critical_paths[activePathIndex]
      ? response.critical_paths[activePathIndex].activities
      : null;

  // Scroll spy for sticky section nav
  useEffect(() => {
    const handleScroll = () => {
      const sections: Array<{ id: string; name: 'summary' | 'diagram' | 'table' | 'crashing' | 'steps' }> = [
        { id: 'summary-section', name: 'summary' },
        { id: 'diagram-section', name: 'diagram' },
        { id: 'table-section', name: 'table' },
        { id: 'crashing-section', name: 'crashing' },
        { id: 'steps-section', name: 'steps' },
      ];

      const scrollPos = window.scrollY + 140;
      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i].id);
        if (el && el.offsetTop <= scrollPos) {
          setActiveSection(sections[i].name);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const headerOffset = 90;
    const elementPosition = el.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
  };

  return (
    <div className="results-wrapper">
      {/* Sticky In-Page Section Nav Pill */}
      <div className="results-section-nav-wrapper">
        <nav className="results-section-nav" aria-label="Results navigation">
          <button
            type="button"
            className={`results-nav-item ${activeSection === 'summary' ? 'is-active' : ''}`}
            onClick={() => scrollToSection('summary-section')}
          >
            Summary
          </button>
          <button
            type="button"
            className={`results-nav-item ${activeSection === 'diagram' ? 'is-active' : ''}`}
            onClick={() => scrollToSection('diagram-section')}
          >
            Diagram
          </button>
          <button
            type="button"
            className={`results-nav-item ${activeSection === 'table' ? 'is-active' : ''}`}
            onClick={() => scrollToSection('table-section')}
          >
            Schedule Table
          </button>
          {response.crashing && (
            <button
              type="button"
              className={`results-nav-item ${activeSection === 'crashing' ? 'is-active' : ''}`}
              onClick={() => scrollToSection('crashing-section')}
            >
              Crashing
            </button>
          )}
          {response.steps && response.steps.length > 0 && (
            <button
              type="button"
              className={`results-nav-item ${activeSection === 'steps' ? 'is-active' : ''}`}
              onClick={() => scrollToSection('steps-section')}
            >
              Steps
            </button>
          )}
        </nav>
      </div>

      {/* Warnings List Banner */}
      {response.warnings && response.warnings.length > 0 && (
        <div
          role="region"
          aria-label="Solver Warnings"
          className="results-warning-banner section-reveal section-reveal-1"
        >
          <WarningIcon size={20} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h4 className="results-warning-title">
              Notice / Assumptions Made:
            </h4>
            <ul className="results-warning-list">
              {response.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 1. Summary Strip & Critical Paths */}
      <div id="summary-section" className="section-reveal section-reveal-2">
        <SummaryStrip
          summary={response.summary}
          timed={response.timed}
          criticalPaths={response.critical_paths || []}
          pertAnalysis={response.pert_analysis}
          activePathIndex={activePathIndex}
          onSelectCriticalPath={setActivePathIndex}
        />
      </div>

      {/* 2. Interactive SVG Network Diagram */}
      {response.graph && (
        <div className="section-reveal section-reveal-3">
          <NetworkDiagram
            key={`diagram-${response.graph.nodes.length}-${response.graph.edges.length}-${response.graph.edges.map((e) => e.name).join('-')}-${response.timed ? 't' : 'u'}`}
            graph={response.graph}
            timed={response.timed}
            activities={response.activities}
            activeCriticalPath={activePathActivities}
            highlightedStepElements={highlightedStepElements}
          />
        </div>
      )}

      {/* 3. Activity Schedule & Float Table */}
      {response.activities && response.activities.length > 0 && (
        <div className="section-reveal section-reveal-4">
          <ActivityTable activities={response.activities} timed={response.timed} />
        </div>
      )}

      {/* 4. Crashing Analysis */}
      {response.crashing && (
        <div className="section-reveal section-reveal-5">
          <CrashingCard crashing={response.crashing} />
        </div>
      )}

      {/* 5. Step-by-Step Mathematical Solution Timeline */}
      {response.steps && response.steps.length > 0 && (
        <div className="section-reveal section-reveal-6">
          <StepTimeline
            steps={response.steps}
            onHighlightDiagram={setHighlightedStepElements}
          />
        </div>
      )}
    </div>
  );
};
