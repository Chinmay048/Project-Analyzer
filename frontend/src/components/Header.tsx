import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { HealthResponse, SampleQuestions } from '../types/cpm';
import { getHealth, getSamples } from '../api';
import {
  AoaLogoGlyph,
  SettingsIcon,
  ChevronDownIcon,
  RefreshIcon,
  BookOpenIcon,
} from './Icons';
import './Header.css';

interface HeaderProps {
  apiUrl?: string;
  onApiUrlChange?: (url: string) => void;
  accessKey?: string;
  onAccessKeyChange?: (key: string) => void;
  anthropicKey?: string;
  onAnthropicKeyChange?: (key: string) => void;
  theme: 'system' | 'light' | 'dark';
  onThemeChange: (theme: 'system' | 'light' | 'dark') => void;
  onSelectSample: (key: string, sample: any) => void;
}

export const Header: React.FC<HeaderProps> = ({
  apiUrl = '',
  accessKey = '',
  theme,
  onThemeChange,
  onSelectSample,
}) => {
  const [samples, setSamples] = useState<SampleQuestions>({});
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSamplesDropdown, setShowSamplesDropdown] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const settingsRef = useRef<HTMLDivElement>(null);
  const samplesRef = useRef<HTMLDivElement>(null);
  const sampleItemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Scroll listener for header elevation border/shadow
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fetch health and samples
  const checkHealthAndSamples = useCallback(async () => {
    setHealthLoading(true);
    try {
      const h = await getHealth(apiUrl);
      setHealth(h);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }

    setSamplesLoading(true);
    try {
      const s = await getSamples(apiUrl, accessKey);
      setSamples(s);
    } catch (err) {
      console.error('Failed to load samples:', err);
    } finally {
      setSamplesLoading(false);
    }
  }, [apiUrl, accessKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkHealthAndSamples();
    }, 0);
    return () => clearTimeout(timer);
  }, [checkHealthAndSamples]);

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
      if (samplesRef.current && !samplesRef.current.contains(e.target as Node)) {
        setShowSamplesDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sampleEntries = Object.entries(samples);

  // Group samples logically
  const groupedSamples = [
    {
      group: 'Standard CPM & Single Time',
      items: sampleEntries.filter(([k]) => k.includes('q1') || k.includes('q6') || (!k.includes('q2') && !k.includes('q3') && !k.includes('q4') && !k.includes('q5'))),
    },
    {
      group: 'PERT (3-Time Estimates & Probability)',
      items: sampleEntries.filter(([k]) => k.includes('q3') || k.includes('q4')),
    },
    {
      group: 'Nodes Mode & Event Numbering',
      items: sampleEntries.filter(([k]) => k.includes('q2') || k.includes('q5')),
    },
  ].filter((g) => g.items.length > 0);

  // Keyboard navigation inside samples dropdown
  const handleKeyDownSamples = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (index + 1) % sampleItemsRef.current.length;
      sampleItemsRef.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (index - 1 + sampleItemsRef.current.length) % sampleItemsRef.current.length;
      sampleItemsRef.current[prev]?.focus();
    } else if (e.key === 'Escape') {
      setShowSamplesDropdown(false);
    }
  };

  const hasVision = Boolean(
    health?.gemini || health?.anthropic || health?.vision_key_configured
  );

  let flatIndex = 0;

  return (
    <header className={`frosted-header ${isScrolled ? 'scrolled' : ''}`}>
      {/* Brand logo & title */}
      <div className="header-brand">
        <AoaLogoGlyph size={28} />
        <div className="header-title-group">
          <span className="header-title-text header-title-full">CPM / PERT Arrow Solver</span>
          <span className="header-title-text header-title-short">CPM Solver</span>
          <span className="badge badge-neutral header-badge-chip">AOA Network</span>
        </div>
      </div>

      {/* Actions */}
      <div className="header-actions">
        {/* Samples Dropdown */}
        <div style={{ position: 'relative' }} ref={samplesRef}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowSamplesDropdown(!showSamplesDropdown)}
            aria-expanded={showSamplesDropdown}
            aria-label="Course Guide Samples"
            title="Load course guide sample questions"
          >
            <BookOpenIcon size={15} style={{ color: 'var(--accent)' }} />
            <span className="samples-btn-text">Samples</span>
            <ChevronDownIcon size={14} className="samples-btn-chevron" style={{ opacity: 0.6 }} />
          </button>

          {showSamplesDropdown && (
            <div className="popover-panel samples-popover" role="menu">
              <div className="samples-header-label">Course Guide Questions</div>
              {samplesLoading && sampleEntries.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                  Loading sample problems...
                </div>
              ) : (
                groupedSamples.map((group) => (
                  <div key={group.group}>
                    <div className="samples-group-title">{group.group}</div>
                    {group.items.map(([key, s]) => {
                      const curIdx = flatIndex++;
                      const isPert = (s.activities || []).some((a: any) => a.optimistic != null);
                      const isNodes = (s.activities || []).some((a: any) => a.start_node != null);
                      const typeLabel = isPert ? 'PERT' : isNodes ? 'Nodes' : 'CPM';

                      return (
                        <button
                          key={key}
                          ref={(el) => { sampleItemsRef.current[curIdx] = el; }}
                          type="button"
                          className="sample-menu-item"
                          onClick={() => {
                            onSelectSample(key, s);
                            setShowSamplesDropdown(false);
                          }}
                          onKeyDown={(e) => handleKeyDownSamples(e, curIdx)}
                          role="menuitem"
                        >
                          <div className="sample-menu-item-row">
                            <span className="sample-menu-title">{s.title || key}</span>
                            <span className="badge badge-accent" style={{ fontSize: '10px', height: '18px', padding: '1px 5px' }}>
                              {typeLabel}
                            </span>
                          </div>
                          <span className="sample-menu-desc">
                            {s.activities?.length || 0} activities {s.round_te ? '• Te rounded' : ''} {s.target_delta ? `• Δ ${s.target_delta}` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Server Connection status */}
        <div
          className={`header-status-pill ${health ? 'online' : 'offline'}`}
          title={health ? `Server connected (${hasVision ? 'Vision AI ready' : 'Vision key needed'})` : 'Server unreachable (Start uvicorn on :8000)'}
        >
          <span
            className={`status-indicator-dot ${health ? 'online' : 'offline'} ${healthLoading ? 'status-dot-connecting' : ''}`}
          />
          <span className="status-pill-text">{health ? 'API Ready' : 'Offline'}</span>
        </div>

        {/* Settings button & popover */}
        <div style={{ position: 'relative' }} ref={settingsRef}>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Application Settings"
            aria-expanded={showSettings}
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>

          {showSettings && (
            <div className="popover-panel settings-popover">
              <div className="settings-header">
                <h4 className="settings-title">Settings</h4>
                <button
                  type="button"
                  className="btn-icon"
                  style={{ width: '28px', height: '28px' }}
                  onClick={checkHealthAndSamples}
                  title="Refresh connection"
                  aria-label="Refresh connection"
                >
                  <RefreshIcon size={14} className={healthLoading ? 'status-dot-connecting' : ''} />
                </button>
              </div>

              <div className="settings-field-group">
                {/* Theme Selector */}
                <div>
                  <span className="settings-field-label">Appearance</span>
                  <div className="segmented-control" style={{ width: '100%', display: 'flex' }}>
                    {(['system', 'light', 'dark'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`segmented-button ${theme === t ? 'active' : ''}`}
                        onClick={() => onThemeChange(t)}
                        style={{ textTransform: 'capitalize' }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
